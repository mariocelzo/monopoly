'use strict';

/*
 * Persistenza delle partite: conserva fuori dalla memoria del processo lo
 * stato di ogni stanza, così una partita in corso sopravvive a un riavvio.
 * Spenta di default: si accende solo impostando una variabile d'ambiente
 * (REDIS_URL oppure PERSIST_FILE, vedi server/.env.example e la tabella nel
 * README). Senza nessuna delle due questo modulo è un no-op completo: nessun
 * file creato, NESSUNA connessione di rete aperta, nessuna I/O in più rispetto
 * a prima. È una scelta voluta e non negoziabile: chi sviluppa in locale, e
 * chiunque lanci smoke-test.js o invariant-test.js, non deve avere niente da
 * installare né da far girare.
 *
 * DUE ARCHIVI, PERCHÉ. Il primo, su file, nasceva per proteggere da un crash o
 * da un riavvio "sul posto". Non bastava: in produzione il progetto gira su
 * Render piano gratuito, dove il filesystem è EFFIMERO — viene ricreato da zero
 * a ogni deploy e a ogni riavvio dell'istanza. Il file quindi copre il caso
 * raro (il crash) e manca quello frequente (il deploy), che con un progetto in
 * continua modifica è l'evento che uccide le partite quasi ogni volta. Per
 * risolverlo serve un archivio ESTERNO al container, che il deploy non tocchi:
 * da qui il secondo archivio, su Redis, raggiunto via URL.
 *
 * PRECEDENZA. Se sono impostate entrambe le variabili vince REDIS_URL, e lo si
 * logga all'avvio: è l'archivio più forte dei due (sopravvive anche al deploy),
 * e il caso "le ho impostate tutte e due" nasce quasi sempre da un file che era
 * rimasto in configurazione da prima. Il file resta comunque utile per chi gira
 * su un host con un disco vero, o per provare la persistenza in locale senza
 * alzare un Redis.
 *
 * QUALUNQUE REDIS. Il codice non sa e non deve sapere chi ospita l'archivio:
 * parla solo un URL standard (`redis://` o `rediss://` per il TLS) e comandi
 * standard (SCAN, MGET, SET, DEL). Va bene un Upstash gratuito, un Redis di
 * Render, un container `docker run redis` in locale. Nessuna SDK proprietaria,
 * nessuna variabile con un nome di fornitore dentro.
 *
 * L'ARCHIVIO NON DEVE POTER ROMPERE LA PARTITA. Adesso fra il gioco e il
 * salvataggio c'è di mezzo la rete, che è lenta e cade. Perciò: il salvataggio
 * resta differito e accorpato (vedi DEBOUNCE_MS), la scrittura vera parte
 * "sullo sfondo" e nessuno la aspetta, ogni errore viene catturato e loggato
 * (con parsimonia, vedi warnRado) e mai propagato ai chiamanti, e persino la
 * lettura all'avvio ha un tetto di tempo oltre il quale si rinuncia e si parte
 * vuoti. Se Redis è irraggiungibile si continua a giocare in memoria: si perde
 * la rete di sicurezza, non la partita.
 *
 * L'interfaccia resta quella di prima — `load / save / remove / flushNow` —
 * perché rooms.js e server.js non devono sapere cosa c'è dietro. L'unica cosa
 * che è dovuta cambiare è che `load` e `flushNow` ora tornano una Promise:
 * un'attesa di rete non si può fingere sincrona, e fingerla (busy-wait, deasync)
 * sarebbe molto peggio del piccolo `await` in chi chiama.
 *
 * Il motore (gameEngine.js) resta completamente estraneo a tutto questo: non ha
 * idea che la persistenza esista, non fa I/O, non ha `await`. È rooms.js (via
 * server.js, dove già si ribroadcasta lo stato a ogni cambiamento) a leggere da
 * fuori i campi di un'istanza di GameEngine e a passarli qui per il
 * salvataggio, e a ricostruirne una nuova a partire da qui al riavvio.
 */

const fs = require('fs');
const path = require('path');

// Cambia solo se cambia la FORMA di ciò che salviamo (per esempio un campo
// nuovo che GameEngine si aspetta di trovare sempre valorizzato). Un
// salvataggio con versione diversa da questa si scarta invece di tentare una
// ricostruzione parziale che potrebbe rompersi a metà partita in modi
// imprevedibili: meglio perdere quella stanza che avere un motore in uno
// stato inconsistente.
const SCHEMA_VERSION = 1;

// Ogni mossa di gioco cambia lo stato della stanza. Se si scrivesse
// nell'archivio a ogni mossa, ogni azione (anche solo tirare i dadi) pagherebbe
// un giro di I/O — su Redis un giro di RETE — prima che il gioco vada avanti:
// si sentirebbe. Si accorpano invece le modifiche ravvicinate con un semplice
// debounce: la scrittura vera parte solo dopo un momento di quiete di
// DEBOUNCE_MS, così una sequenza di mosse rapide (un intero turno, un'asta con
// vari rilanci) produce una sola scrittura invece di una per mossa. Vale doppio
// con Redis: meno round-trip e, sui piani gratuiti che contano i comandi, meno
// comandi consumati.
const DEBOUNCE_MS = 2000;

// Dopo una scrittura fallita non si riprova subito: se l'archivio è giù, un
// nuovo tentativo ogni DEBOUNCE_MS sarebbe solo rumore (e comandi buttati).
// Si aspetta di più e si riprova, all'infinito ma con calma: la partita nel
// frattempo continua tranquillamente in memoria.
const RETRY_MS = 10000;

// La lettura all'avvio è l'unico momento in cui qualcuno ASPETTA l'archivio
// (server.js non si mette in ascolto finché non è finita, vedi rooms.js:
// altrimenti un client potrebbe chiedere rejoin_room di una stanza che stiamo
// ancora ripescando). Un archivio lento o irraggiungibile non deve però tenere
// il server giù per sempre: oltre questo tetto si rinuncia e si parte vuoti.
const LOAD_TIMEOUT_MS = 5000;

// Stesso ragionamento allo spegnimento: si prova a salvare l'ultima finestra di
// debounce, ma senza restare appesi. Render manda SIGTERM e dopo poco uccide il
// processo comunque; meglio perdere le ultime mosse che bloccare il deploy.
const FLUSH_TIMEOUT_MS = 4000;

// Prefisso delle chiavi su Redis. Serve a due cose: ritrovare tutte e sole le
// nostre stanze con uno SCAN, e convivere senza pestarsi i piedi con altro che
// usasse la stessa istanza (i piani gratuiti hanno un solo database).
const KEY_PREFIX = 'monopoly:room:';

// Scadenza delle chiavi su Redis. Chi decide davvero quando una stanza muore è
// rooms.js (ROOM_TTL_MS, 3 ore di vuoto, poi sweep() chiama remove()); questo
// TTL è solo una rete di sicurezza contro le chiavi ORFANE — una stanza salvata
// da un processo che poi è stato ucciso prima di poterla cancellare resterebbe
// altrimenti nell'archivio per sempre. Volutamente più largo del TTL delle
// stanze, così non è mai lui a togliere di mezzo una partita ancora viva.
const KEY_TTL_S = 6 * 60 * 60;

// Un archivio irraggiungibile non produce un errore: ne produce uno ogni
// tentativo, per ore. Si logga il primo e poi al massimo uno ogni tanto, per
// tipo di problema: il registro serve a capire che c'è un guaio, non a
// riempirsi finché non si trova più nient'altro.
const LOG_QUIET_MS = 60 * 1000;

/**
 * Corsa fra una promessa e un tetto di tempo.
 *
 * Questo timer, a differenza di quello del debounce, NON va `unref`ato: se
 * l'archivio non risponde mai, è l'unica cosa rimasta a poter sbloccare chi
 * aspetta, e un timer `unref`ato in un processo che non ha altro da fare non
 * scatta proprio — Node esce e basta. Vive comunque pochi secondi e viene
 * annullato appena arriva una risposta.
 */
function conScadenza(promise, ms, cosa) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${cosa}: nessuna risposta entro ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/* ------------------------------------------------------------------------ *
 * Archivio su file
 * ------------------------------------------------------------------------ */

/**
 * Tutte le stanze in un solo file: lo stato di una partita pesa pochi KB, il
 * volume non è mai stato il problema. La scrittura è atomica — file temporaneo
 * e poi rename — così un crash proprio nell'istante della scrittura non lascia
 * un JSON tagliato a metà che poi farebbe fallire il prossimo avvio.
 */
function creaArchivioSuFile(file) {
  return {
    // Compare dentro frasi già fatte ("ripristinate 3 stanze da ...",
    // "salvataggio su ... fallito"): il percorso nudo ci sta in tutte.
    descrizione: file,

    async leggiTutto() {
      let raw;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch (err) {
        // File assente = situazione normale (primo avvio, o persistenza appena
        // attivata su un ambiente che non l'aveva mai usata): si parte vuoti,
        // senza nemmeno un log d'allarme. Tutto il resto è un guaio vero e
        // risale a chi chiama, che lo logga.
        if (err.code === 'ENOENT') return {};
        throw err;
      }
      return JSON.parse(raw);
    },

    // Il file contiene sempre TUTTO l'archivio, quindi l'elenco delle stanze
    // cambiate e di quelle tolte non serve: si riscrive lo specchio completo,
    // che è già aggiornato di suo (le stanze tolte non ci sono più dentro).
    async scrivi({ store }) {
      const dir = path.dirname(file);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, file);
    },

    async chiudi() {},
  };
}

/* ------------------------------------------------------------------------ *
 * Archivio su Redis
 * ------------------------------------------------------------------------ */

/**
 * Una chiave per stanza (`monopoly:room:ABCDE`) invece di un'unica chiave con
 * dentro tutto. Costa uno SCAN in più all'avvio e regala tre cose che contano
 * di più: si riscrive solo la stanza che è cambiata (non le altre cinque
 * ferme), due processi che girassero insieme durante un deploy non si
 * sovrascrivono a vicenda l'intero archivio, e ogni stanza può avere la sua
 * scadenza (vedi KEY_TTL_S).
 *
 * `creaClient` è iniettabile: in produzione è `createClient` di node-redis, nei
 * test è un finto client in memoria. È l'unico modo di verificare sul serio
 * l'accorpamento delle scritture, lo scarto dei dati corrotti e il
 * comportamento a rete rotta senza dipendere da un Redis vero acceso.
 */
function creaArchivioSuRedis(url, creaClient) {
  let connessione = null;
  // Il client vero, tenuto a parte dalla promessa di connessione: serve a
  // poterlo buttare giù anche mentre sta ANCORA tentando di connettersi (vedi
  // chiudi()), quando la promessa non si è ancora risolta e non si può
  // aspettarla.
  let client = null;
  let pronto = false;
  const ultimoLog = new Map();

  // Host senza credenziali, per i log: l'URL di Redis contiene la password in
  // chiaro e non deve mai finire su stdout, che su Render è consultabile.
  let host = 'Redis';
  try { host = `Redis (${new URL(url).host})`; } catch { /* URL strano: si resta sul generico */ }

  function warnRado(chiave, messaggio) {
    const ora = Date.now();
    if (ora - (ultimoLog.get(chiave) || 0) < LOG_QUIET_MS) return;
    ultimoLog.set(chiave, ora);
    console.warn(messaggio);
  }

  function apri() {
    if (connessione) return connessione;
    const tentativo = (async () => {
      client = creaClient({
        url,
        socket: {
          connectTimeout: 5000,
          // Riconnessione con attesa crescente ma con un tetto: se l'archivio
          // torna su, ci si riattacca da soli senza riavviare il server; se
          // resta giù, non si martella la rete ogni millisecondo.
          reconnectStrategy: (tentativi) => Math.min(200 * 2 ** tentativi, 15000),
        },
      });
      // OBBLIGATORIO: node-redis emette 'error' sull'istanza a ogni intoppo di
      // connessione. Un EventEmitter senza ascoltatore su 'error' fa TERMINARE
      // il processo Node — senza questa riga un Redis irraggiungibile non
      // degraderebbe il gioco, lo ABBATTEREBBE, che è l'opposto di quel che
      // deve fare un archivio opzionale.
      client.on('error', (err) => {
        warnRado('connessione', `[persistence] ${host} non raggiungibile (${err.message}): si continua in memoria.`);
      });
      // Attenzione: con una reconnectStrategy impostata node-redis RITENTA
      // anche la primissima connessione, quindi con l'archivio spento questa
      // riga non fallisce subito — resta in attesa. È voluto (appena Redis
      // torna su ci si attacca da soli, senza riavviare il server), e chi
      // aspetta davvero è solo l'avvio, che ha il suo tetto di tempo.
      await client.connect();
      pronto = true;
      return client;
    })();
    connessione = tentativo;
    // Una connessione fallita non deve restare "appiccicata": la si dimentica,
    // così il tentativo successivo riparte da un client nuovo e pulito.
    tentativo.catch(() => { if (connessione === tentativo) connessione = null; });
    return tentativo;
  }

  return {
    descrizione: host,

    async leggiTutto() {
      const client = await apri();
      const fuori = {};
      let cursore = '0';
      do {
        // SCAN e non KEYS: KEYS blocca il server Redis, e l'istanza potrebbe
        // non essere solo nostra.
        const risposta = await client.scan(cursore, { MATCH: `${KEY_PREFIX}*`, COUNT: 100 });
        cursore = risposta.cursor;
        const chiavi = risposta.keys || [];
        if (chiavi.length > 0) {
          const valori = await client.mGet(chiavi);
          chiavi.forEach((chiave, i) => {
            if (valori[i] == null) return; // scaduta fra lo SCAN e la MGET: pace
            fuori[chiave.slice(KEY_PREFIX.length)] = valori[i];
          });
        }
        // Il cursore torna come stringa o come numero a seconda del protocollo:
        // si confronta la forma testuale per non dipendere da quale dei due.
      } while (String(cursore) !== '0');
      return fuori;
    },

    // Qui si usa `istantanea` e non `store`: sono i valori congelati all'inizio
    // della scrittura, quelli che abbiamo dichiarato di star salvando. Il gioco
    // intanto va avanti e lo specchio cambia sotto, ma quello lo prenderà il
    // flush successivo.
    async scrivi({ istantanea, cambiate, tolte }) {
      const client = await apri();
      // I comandi lanciati nello stesso giro di event loop vengono impacchettati
      // da node-redis in un'unica pipeline: un solo round-trip di rete per
      // tutte le stanze cambiate, senza doverlo orchestrare a mano con MULTI.
      const comandi = [];
      for (const code of cambiate) {
        const entry = istantanea[code];
        if (!entry) continue; // tolta nel frattempo: la cancellazione ha ragione
        comandi.push(client.set(`${KEY_PREFIX}${code}`, JSON.stringify(entry), { EX: KEY_TTL_S }));
      }
      const daCancellare = [...tolte].map((code) => `${KEY_PREFIX}${code}`);
      if (daCancellare.length > 0) comandi.push(client.del(daCancellare));
      await Promise.all(comandi);
    },

    /**
     * Chiusura allo spegnimento. NON si aspetta la promessa di connessione: se
     * l'archivio è irraggiungibile quella promessa non si risolve mai (vedi
     * apri(): node-redis ritenta all'infinito) e aspettarla terrebbe il
     * processo in piedi finché la piattaforma non lo ammazza. È esattamente il
     * difetto che si è visto provando con un Redis spento: il server non
     * moriva più su SIGTERM.
     *
     * Quindi: se la connessione era davvero aperta si chiude con garbo (QUIT,
     * con un tetto di tempo), altrimenti si stacca la spina e via.
     */
    async chiudi() {
      const attuale = client;
      const eraPronto = pronto;
      connessione = null;
      client = null;
      pronto = false;
      if (!attuale) return;
      try {
        if (eraPronto) await conScadenza(attuale.quit(), 1000, 'chiusura');
        else attuale.destroy?.();
      } catch {
        // QUIT non riuscito o troppo lento: si stacca e basta. Chiudere male
        // una connessione mentre il processo sta morendo non è un problema.
        try { attuale.destroy?.(); } catch { /* già morta */ }
      }
    },
  };
}

/* ------------------------------------------------------------------------ *
 * Facciata comune
 * ------------------------------------------------------------------------ */

/**
 * Costruisce un'istanza di persistenza. In produzione se ne crea una sola, in
 * fondo al file, letta dalle variabili d'ambiente; i test ne creano quante ne
 * vogliono, isolate e con un client finto.
 */
function creaPersistenza({
  redisUrl = '',
  file = '',
  creaClientRedis = null,
  debounceMs = DEBOUNCE_MS,
  retryMs = RETRY_MS,
  loadTimeoutMs = LOAD_TIMEOUT_MS,
  flushTimeoutMs = FLUSH_TIMEOUT_MS,
} = {}) {
  // La presenza della variabile è l'interruttore: niente flag booleano
  // separato da tenere sincronizzato.
  let archivio = null;
  let tipo = 'spenta';

  if (redisUrl) {
    if (file) {
      console.warn('[persistence] impostate sia REDIS_URL sia PERSIST_FILE: vince REDIS_URL, il file viene ignorato.');
    }
    // `require` del client solo qui dentro: senza REDIS_URL il pacchetto non
    // viene nemmeno caricato, e chi gira i test o sviluppa in locale non paga
    // niente per una funzionalità che non ha acceso.
    const creaClient = creaClientRedis || require('redis').createClient;
    archivio = creaArchivioSuRedis(redisUrl, creaClient);
    tipo = 'redis';
  } else if (file) {
    archivio = creaArchivioSuFile(file);
    tipo = 'file';
  }

  const enabled = archivio !== null;

  // Specchio in memoria di quello che (una volta girato il flush) sta
  // nell'archivio: { [roomCode]: { v, savedAt, state } }. Evita di rileggere
  // da fuori a ogni save/remove: si legge una volta sola, all'avvio (load()).
  let store = {};
  // Cosa il prossimo flush deve propagare. Tenerne traccia per stanza, e non
  // con un solo booleano "sporco", è ciò che permette all'archivio su Redis di
  // riscrivere le sole stanze toccate.
  const cambiate = new Set();
  const tolte = new Set();

  let timerFlush = null;
  let flushInCorso = null;
  let daRifare = false;
  const ultimoLog = new Map();

  function warnRado(chiave, messaggio) {
    const ora = Date.now();
    if (ora - (ultimoLog.get(chiave) || 0) < LOG_QUIET_MS) return;
    ultimoLog.set(chiave, ora);
    console.warn(messaggio);
  }

  function programmaFlush(fraMs = debounceMs) {
    if (!enabled || timerFlush) return;
    timerFlush = setTimeout(() => { flush(); }, fraMs);
    timerFlush.unref?.(); // il timer di scrittura non deve tenere vivo il processo da solo
  }

  /**
   * Propaga all'archivio quello che si è accumulato. Non lancia mai: un
   * archivio che non risponde è un problema dell'archivio, non della partita.
   *
   * Due accortezze che sembrano dettagli e non lo sono:
   * - una sola scrittura per volta (`flushInCorso`). Senza, due scritture
   *   sovrapposte sulla stessa stanza potrebbero arrivare a Redis nell'ordine
   *   sbagliato e lasciare nell'archivio uno stato più VECCHIO di quello che
   *   c'era già;
   * - se una scrittura fallisce, le stanze coinvolte tornano nella coda invece
   *   di essere date per salvate, e si riprova più tardi (RETRY_MS). Un errore
   *   di rete passeggero non deve costare la partita.
   */
  async function flush() {
    if (timerFlush) { clearTimeout(timerFlush); timerFlush = null; }
    if (!enabled) return;
    if (flushInCorso) { daRifare = true; return flushInCorso; }
    if (cambiate.size === 0 && tolte.size === 0) return;

    const cambiateOra = new Set(cambiate); cambiate.clear();
    const tolteOra = new Set(tolte); tolte.clear();
    // Istantanea dei soli valori che stiamo scrivendo: se il gioco va avanti
    // durante l'attesa di rete, quello che finisce nell'archivio resta
    // coerente con le stanze che abbiamo dichiarato di star salvando.
    const istantanea = {};
    for (const code of cambiateOra) if (store[code]) istantanea[code] = store[code];

    let fallito = false;
    flushInCorso = (async () => {
      try {
        await archivio.scrivi({ store, istantanea, cambiate: cambiateOra, tolte: tolteOra });
      } catch (err) {
        fallito = true;
        for (const code of cambiateOra) if (code in store) cambiate.add(code);
        for (const code of tolteOra) tolte.add(code);
        warnRado(
          'scrittura',
          `[persistence] salvataggio su ${archivio.descrizione} fallito (${err.message}): la partita continua in memoria, riprovo fra poco.`
        );
        programmaFlush(retryMs);
      }
    })();

    try {
      await flushInCorso;
    } finally {
      flushInCorso = null;
    }
    // Modifiche arrivate mentre scrivevamo: si riparte subito, senza aspettare
    // un altro giro di debounce. Non però se la scrittura è appena fallita: in
    // quel caso comanda l'attesa più lunga del ritentativo già programmato,
    // altrimenti con l'archivio giù si tornerebbe a martellare senza sosta.
    if (daRifare) {
      daRifare = false;
      if (!fallito) await flush();
    }
  }

  /** Segna una stanza come non più esistente nell'archivio. */
  function dimentica(code) {
    delete store[code];
    cambiate.delete(code);
    tolte.add(code);
    programmaFlush();
  }

  /**
   * Legge l'archivio all'avvio del processo. Ritorna una mappa
   * { roomCode: state } pronta da usare per ricostruire le partite (vedi
   * RoomManager.restoreSaved in rooms.js).
   *
   * Non lancia mai, per scelta. Un archivio assente è la situazione normale
   * (primo avvio, o persistenza appena attivata): si parte vuoti, senza nemmeno
   * un log d'allarme. Un archivio irraggiungibile, un JSON corrotto, o singole
   * voci di uno schema che non riconosciamo NON devono impedire l'avvio del
   * server: si scarta quel che non torna, si logga il motivo, e si riparte come
   * se non ci fosse nulla di salvato. Meglio perdere delle partite che avere un
   * server che non parte più per colpa di due caratteri sbagliati o di un
   * servizio esterno giù.
   */
  async function load() {
    store = {};
    const ripristinate = {};
    if (!enabled) return ripristinate;

    let grezzo;
    try {
      grezzo = await conScadenza(archivio.leggiTutto(), loadTimeoutMs, 'lettura');
    } catch (err) {
      console.warn(`[persistence] lettura da ${archivio.descrizione} fallita (${err.message}): riparto senza stato salvato.`);
      return ripristinate;
    }

    for (const [code, valore] of Object.entries(grezzo || {})) {
      // Redis restituisce la stringa JSON di ogni stanza (una chiave per
      // stanza, quindi il danno di un valore corrotto è limitato a quella); il
      // file restituisce l'archivio già interpretato in blocco. Si accettano
      // entrambe le forme così la validazione qui sotto resta una sola.
      let entry = null;
      try {
        entry = typeof valore === 'string' ? JSON.parse(valore) : valore;
      } catch {
        entry = null;
      }
      // Controllo minimo di forma: versione riconosciuta e almeno l'array dei
      // giocatori presente. Non è una validazione esaustiva (non serve: se
      // qualcos'altro non torna, la ricostruzione in rooms.js la scarta comunque
      // col suo try/catch), solo un primo filtro contro i casi più ovvi.
      if (!entry || entry.v !== SCHEMA_VERSION || !entry.state || !Array.isArray(entry.state.players)) {
        console.warn(`[persistence] scarto la stanza ${code}: salvataggio corrotto, incompleto o di una versione non riconosciuta.`);
        // Toglierla anche dall'archivio: altrimenti la si ritenta, e la si
        // logga, a ogni avvio per sempre.
        dimentica(code);
        continue;
      }
      store[code] = entry;
      ripristinate[code] = entry.state;
    }

    const n = Object.keys(ripristinate).length;
    if (n > 0) console.log(`[persistence] ripristinate ${n === 1 ? 'una stanza' : `${n} stanze`} da ${archivio.descrizione}.`);
    return ripristinate;
  }

  /**
   * Segna una stanza come da salvare e ne accoda la scrittura (vedi
   * DEBOUNCE_MS). Resta SINCRONA e non aspetta niente: viene chiamata dal giro
   * di broadcast, dopo ogni mossa, e lì non si può pagare la rete.
   *
   * `game` è l'istanza di GameEngine così com'è, non il suo serialize(): quello
   * è pensato per il client e mostra volutamente meno di quanto serva per far
   * ripartire davvero la partita (mancano per esempio i mazzi delle carte e la
   * carta pescata non ancora letta). Si clona con un giro JSON invece di
   * elencare i campi a mano, così l'istantanea segue da sola ogni campo
   * dell'istanza — presente e futuro — senza dover tenere questo file
   * sincronizzato a mano ogni volta che gameEngine.js cambia.
   */
  function save(code, game) {
    if (!enabled) return;
    store[code] = { v: SCHEMA_VERSION, savedAt: Date.now(), state: JSON.parse(JSON.stringify(game)) };
    cambiate.add(code);
    tolte.delete(code);
    programmaFlush();
  }

  /** Toglie una stanza dall'archivio: tavolo chiuso o scaduto (vedi rooms.js). */
  function remove(code) {
    if (!enabled) return;
    if (!(code in store) && !cambiate.has(code)) return;
    dimentica(code);
  }

  /**
   * Forza subito la scrittura, saltando l'attesa del debounce, e chiude la
   * connessione. Usata allo spegnimento pulito del processo (SIGTERM — cioè
   * anche un deploy su Render — o SIGINT da Ctrl+C in locale) per non perdere
   * le mosse fatte nell'ultima finestra di debounce. Un `kill -9` non passa da
   * qui: in quel caso si perde al più quella finestra, per scelta (vedi il
   * commento su DEBOUNCE_MS).
   *
   * Ha un tetto di tempo: se l'archivio non risponde, si rinuncia e si lascia
   * morire il processo. Tenere in ostaggio uno spegnimento sperando in un
   * servizio esterno significherebbe farsi uccidere lo stesso, più tardi.
   */
  async function flushNow() {
    if (timerFlush) { clearTimeout(timerFlush); timerFlush = null; }
    if (!enabled) return;
    try {
      await conScadenza(flush(), flushTimeoutMs, 'salvataggio finale');
    } catch (err) {
      console.warn(`[persistence] salvataggio finale su ${archivio.descrizione} non riuscito (${err.message}).`);
    }
    try {
      await archivio.chiudi();
    } catch {
      // Una connessione che non si chiude bene, mentre il processo sta
      // morendo, non è un problema di nessuno.
    }
  }

  return {
    enabled,
    // 'redis' | 'file' | 'spenta'. Serve ai log d'avvio e ai test; nessuna
    // logica di gioco deve dipendere da questo valore.
    tipo,
    descrizione: () => (archivio ? archivio.descrizione : 'nessun archivio (solo memoria)'),
    load,
    save,
    remove,
    flushNow,
  };
}

// L'istanza vera, quella che usano rooms.js e server.js. Senza nessuna delle
// due variabili è un guscio vuoto che non fa niente.
const persistenza = creaPersistenza({
  redisUrl: process.env.REDIS_URL || '',
  file: process.env.PERSIST_FILE || '',
});

// Esposta per i test (persistence-test.js), che costruiscono istanze isolate
// con un client Redis finto e con tempi accorciati.
persistenza.creaPersistenza = creaPersistenza;

module.exports = persistenza;
