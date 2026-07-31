// Test della persistenza delle partite (server/src/persistence.js). Nessun
// framework: si lancia con `node persistence-test.js` dalla cartella server,
// come smoke-test.js e invariant-test.js.
//
// PERCHÉ UN FILE A PARTE E NON UNA SEZIONE DI smoke-test.js: là dentro è tutto
// sincrono, dalla prima riga all'ultima, e qui invece si aspettano dei debounce
// e delle finte risposte di rete. Mescolarli avrebbe voluto dire trasformare
// tutta quella suite in codice asincrono per una sola sezione.
//
// PERCHÉ UN CLIENT REDIS FINTO: l'archivio esterno vero (Upstash, un Redis su
// un host, un container) non c'è né in questa macchina né su GitHub Actions, e
// dipenderne significherebbe avere dei test che si possono lanciare solo a
// stelle allineate. Il finto client qui sotto rispetta esattamente la fetta di
// interfaccia che persistence.js usa — connect / on('error') / scan / mGet /
// set / del / quit — e in più sa fingere i guasti che contano: connessione
// rifiutata, connessione che non risponde mai, comandi che falliscono, comandi
// lenti. Sono proprio i casi che un Redis vero acceso e funzionante NON
// permetterebbe di provare.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { creaPersistenza } = require('./src/persistence');
const { GameEngine } = require('./src/gameEngine');

let passed = 0;
let failed = 0;

function check(description, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${description}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${description}${extra ? ` — ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Esegue qualcosa raccogliendo i console.warn invece di stamparli. Serve a due
 * cose insieme: tenere leggibile l'output del test (diversi casi qui sotto
 * PROVOCANO apposta degli errori) e poter verificare che il motivo del guaio
 * sia stato davvero loggato, che è un requisito, non un dettaglio.
 */
async function catturandoIWarn(fn) {
  const raccolti = [];
  const vero = console.warn;
  console.warn = (...args) => raccolti.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.warn = vero;
  }
  return raccolti;
}

/* ------------------------------------------------------------------------ *
 * Il finto Redis
 * ------------------------------------------------------------------------ */

/**
 * Redis in memoria che parla la stessa lingua di node-redis per i pochi comandi
 * che ci servono. `stato` è condiviso fra i client creati dalla stessa fabbrica:
 * così si può spegnere una persistenza, crearne un'altra e ritrovare i dati,
 * che è esattamente il riavvio del processo che vogliamo simulare.
 */
function fabbricaFintoRedis(stato = { dati: new Map() }) {
  stato.dati = stato.dati || new Map();
  stato.comandi = [];        // registro di ogni comando ricevuto, in ordine
  stato.clientCreati = 0;
  stato.connessioni = 0;
  stato.guastoComandi = null; // messaggio: finché è valorizzato, ogni comando fallisce
  stato.guastoConnessione = null;
  stato.connessioneAppesa = false;
  stato.ritardoSet = 0;

  const fabbrica = (opzioni) => {
    stato.clientCreati += 1;
    stato.ultimeOpzioni = opzioni;
    const ascoltatori = new Map();

    const forseGuasto = async (nome) => {
      stato.comandi.push(nome);
      if (stato.guastoComandi) throw new Error(stato.guastoComandi);
    };

    return {
      on(evento, fn) { ascoltatori.set(evento, fn); return this; },

      async connect() {
        stato.connessioni += 1;
        if (stato.connessioneAppesa) return new Promise(() => {}); // non risponde mai
        if (stato.guastoConnessione) {
          // node-redis emette 'error' sull'istanza E rifiuta la connect: si
          // riproducono tutti e due, perché il primo è ciò che farebbe cadere
          // il processo se persistence.js non ascoltasse quell'evento.
          ascoltatori.get('error')?.(new Error(stato.guastoConnessione));
          throw new Error(stato.guastoConnessione);
        }
        return this;
      },

      async set(chiave, valore, opzioni) {
        await forseGuasto(`SET ${chiave}`);
        if (stato.ritardoSet) await attendi(stato.ritardoSet);
        stato.dati.set(chiave, { valore, ex: opzioni?.EX });
        return 'OK';
      },

      async del(chiavi) {
        const elenco = Array.isArray(chiavi) ? chiavi : [chiavi];
        await forseGuasto(`DEL ${elenco.join(',')}`);
        let tolte = 0;
        elenco.forEach((c) => { if (stato.dati.delete(c)) tolte += 1; });
        return tolte;
      },

      async mGet(chiavi) {
        await forseGuasto(`MGET ${chiavi.length}`);
        return chiavi.map((c) => (stato.dati.has(c) ? stato.dati.get(c).valore : null));
      },

      // Cursore vero, con pagine: il ciclo do/while di persistence.js deve
      // reggere anche un archivio che non risponde tutto in un colpo solo.
      async scan(cursore, { MATCH, COUNT = 10 } = {}) {
        await forseGuasto(`SCAN ${cursore}`);
        const prefisso = String(MATCH || '*').replace(/\*$/, '');
        const tutte = [...stato.dati.keys()].filter((c) => c.startsWith(prefisso));
        const da = Number(cursore) || 0;
        const pagina = tutte.slice(da, da + COUNT);
        const prossimo = da + COUNT >= tutte.length ? '0' : String(da + COUNT);
        return { cursor: prossimo, keys: pagina };
      },

      async quit() {
        stato.comandi.push('QUIT');
        return 'OK';
      },

      // node-redis lo espone per staccare la spina senza convenevoli: è quel
      // che serve quando la connessione non si è mai aperta.
      destroy() { stato.comandi.push('DESTROY'); },
    };
  };

  return { fabbrica, stato };
}

const CHIAVE = (code) => `monopoly:room:${code}`;

/** Una partita vera, non un oggetto finto: è quello che si salva davvero. */
function partitaDiProva(code = 'ABCDE') {
  const game = new GameEngine(code);
  game.addPlayer('mario', 'Mario', '🎩');
  game.addPlayer('giulia', 'Giulia', '🐕');
  game.start();
  game.players[0].balance = 1234;
  game.ownership[1] = { ownerId: 'mario', houses: 0, hotels: 0, mortgaged: false };
  return game;
}

/* ------------------------------------------------------------------------ */

async function main() {
  // ---------------------------------------------------------------------
  section('1. Spenta di default: senza variabili non succede assolutamente nulla');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    const p = creaPersistenza({ creaClientRedis: fabbrica });

    check('enabled è false', p.enabled === false);
    check('il tipo è "spenta"', p.tipo === 'spenta');
    check('load() torna una mappa vuota', Object.keys(await p.load()).length === 0);

    p.save('ABCDE', partitaDiProva());
    p.remove('ABCDE');
    await p.flushNow();
    await attendi(30);

    check('nessun client Redis viene nemmeno costruito', stato.clientCreati === 0);
    check('nessun comando parte', stato.comandi.length === 0);

    // E il modulo vero, quello che usano rooms.js e server.js: questo test gira
    // senza REDIS_URL né PERSIST_FILE, quindi deve risultare spento.
    const modulo = require('./src/persistence');
    check('anche il modulo caricato dall\'ambiente è spento', modulo.enabled === false);
    check('e lo dice a chiare lettere nel log d\'avvio', modulo.descrizione().includes('memoria'));

    // Nessun file creato: la prova che "spenta" vuol dire spenta davvero.
    check('nessun file lasciato in giro', !fs.existsSync('rooms-state.json'));
  }

  // ---------------------------------------------------------------------
  section('2. Quale archivio vince, e quando');
  {
    const { fabbrica } = fabbricaFintoRedis();
    const soloFile = creaPersistenza({ file: '/tmp/mai-scritto.json' });
    check('con la sola PERSIST_FILE si usa il file', soloFile.tipo === 'file');

    const soloRedis = creaPersistenza({ redisUrl: 'redis://127.0.0.1:6379', creaClientRedis: fabbrica });
    check('con la sola REDIS_URL si usa Redis', soloRedis.tipo === 'redis');

    const warn = await catturandoIWarn(async () => {
      const entrambe = creaPersistenza({
        redisUrl: 'redis://127.0.0.1:6379',
        file: '/tmp/mai-scritto.json',
        creaClientRedis: fabbrica,
      });
      check('con tutte e due impostate vince Redis', entrambe.tipo === 'redis');
    });
    check('e la precedenza viene detta nel log, non lasciata indovinare',
      warn.some((m) => m.includes('vince REDIS_URL')), warn.join(' | '));

    const conCredenziali = creaPersistenza({
      redisUrl: 'rediss://default:UNA-PASSWORD-SEGRETA@archivio.esempio.io:6379',
      creaClientRedis: fabbrica,
    });
    check('nei log non finisce mai la password dell\'URL',
      !conCredenziali.descrizione().includes('UNA-PASSWORD-SEGRETA'), conCredenziali.descrizione());
    check('ma si capisce comunque su quale host sta scrivendo',
      conCredenziali.descrizione().includes('archivio.esempio.io'), conCredenziali.descrizione());
  }

  // ---------------------------------------------------------------------
  section('3. Il salvataggio è differito e accorpato: il gioco non aspetta');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    const p = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 40 });

    const game = partitaDiProva('AAAAA');
    // Dieci mosse ravvicinate, come un turno intero o un'asta con più rilanci.
    for (let i = 0; i < 10; i++) {
      game.players[0].balance = 1000 + i;
      p.save('AAAAA', game);
    }
    check('subito dopo le mosse non è ancora partito niente', stato.comandi.length === 0,
      stato.comandi.join(' | '));
    check('e save() non ha restituito nessuna promessa da aspettare',
      typeof p.save('AAAAA', game) === 'undefined');

    await attendi(120);
    const set = stato.comandi.filter((c) => c.startsWith('SET'));
    check('dieci mosse diventano UNA sola scrittura', set.length === 1, stato.comandi.join(' | '));
    check('la chiave è quella attesa, con il prefisso del progetto',
      set[0] === `SET ${CHIAVE('AAAAA')}`, set[0]);

    const salvato = JSON.parse(stato.dati.get(CHIAVE('AAAAA')).valore);
    check('quel che finisce nell\'archivio è lo stato PIÙ RECENTE', salvato.state.players[0].balance === 1009,
      String(salvato.state.players[0].balance));
    check('la chiave ha una scadenza, così un\'orfana non resta lì per sempre',
      stato.dati.get(CHIAVE('AAAAA')).ex > 0, String(stato.dati.get(CHIAVE('AAAAA')).ex));

    // Stanze diverse: si accorpano in un solo giro, ma ognuna con la sua chiave.
    stato.comandi.length = 0;
    p.save('BBBBB', partitaDiProva('BBBBB'));
    p.save('CCCCC', partitaDiProva('CCCCC'));
    await attendi(120);
    check('due stanze diverse fanno due SET in un unico giro',
      stato.comandi.filter((c) => c.startsWith('SET')).length === 2, stato.comandi.join(' | '));

    // Una stanza ferma non va riscritta: è il motivo per cui si tiene traccia
    // di CHI è cambiato e non di un semplice "qualcosa è cambiato".
    stato.comandi.length = 0;
    p.save('BBBBB', partitaDiProva('BBBBB'));
    await attendi(120);
    check('si riscrive solo la stanza toccata, non tutte quelle in archivio',
      stato.comandi.filter((c) => c.startsWith('SET')).length === 1, stato.comandi.join(' | '));
  }

  // ---------------------------------------------------------------------
  section('4. Giro completo: partita salvata, processo riavviato, partita ritrovata');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    const primo = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10 });

    const game = partitaDiProva('RIAVV');
    game.players[1].balance = 777;
    primo.save('RIAVV', game);
    await primo.flushNow(); // come uno spegnimento pulito (SIGTERM di un deploy)

    // Da qui in poi è un ALTRO processo: nuova persistenza, stesso archivio.
    const secondo = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10 });
    const stanze = await secondo.load();
    check('la stanza torna dall\'archivio', Object.keys(stanze).join() === 'RIAVV', Object.keys(stanze).join());

    // Esattamente quel che fa rooms.js: motore vuoto + campi salvati sopra.
    const ripreso = Object.assign(new GameEngine('RIAVV'), stanze.RIAVV);
    check('la partita risulta iniziata', ripreso.started === true);
    check('i saldi sono quelli di prima', ripreso.players[0].balance === 1234 && ripreso.players[1].balance === 777);
    check('le proprietà sono ancora del loro padrone', ripreso.ownership[1].ownerId === 'mario');
    check('il turno è dove l\'avevamo lasciato', ripreso.currentPlayer.id === game.currentPlayer.id);
    // Il motore ripreso deve poter giocare, non solo essere letto.
    const tiro = ripreso.rollDice(ripreso.currentPlayer.id);
    check('e la partita riprende davvero: si può tirare', !tiro?.error, tiro?.error);

    check('la connessione viene chiusa allo spegnimento', stato.comandi.includes('QUIT'));
  }

  // ---------------------------------------------------------------------
  section('5. Una stanza chiusa sparisce anche dall\'archivio');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    const p = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10 });

    p.save('CHIUS', partitaDiProva('CHIUS'));
    await p.flushNow();
    check('prima c\'è', stato.dati.has(CHIAVE('CHIUS')));

    p.remove('CHIUS');
    await p.flushNow();
    check('dopo remove() non c\'è più', !stato.dati.has(CHIAVE('CHIUS')));
    check('ed è stata proprio una DEL', stato.comandi.some((c) => c === `DEL ${CHIAVE('CHIUS')}`),
      stato.comandi.join(' | '));

    // Togliere una stanza mai salvata non deve produrre traffico inutile.
    stato.comandi.length = 0;
    p.remove('MAI-VISTA');
    await attendi(40);
    check('togliere una stanza che non c\'è non manda nessun comando', stato.comandi.length === 0,
      stato.comandi.join(' | '));
  }

  // ---------------------------------------------------------------------
  section('6. Uno stato corrotto o di un altro schema non impedisce l\'avvio');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    // Si prepara l'archivio a mano, come se ce l'avesse lasciato una versione
    // precedente del server o una scrittura andata a metà.
    const buona = JSON.stringify({ v: 1, savedAt: Date.now(), state: JSON.parse(JSON.stringify(partitaDiProva('BUONA'))) });
    stato.dati.set(CHIAVE('BUONA'), { valore: buona });
    stato.dati.set(CHIAVE('ROTTA'), { valore: '{"v":1,"state":{"players":[' });      // JSON tagliato
    stato.dati.set(CHIAVE('VECCHI'), { valore: JSON.stringify({ v: 99, state: { players: [] } }) }); // altro schema
    stato.dati.set(CHIAVE('MONCA'), { valore: JSON.stringify({ v: 1, state: {} }) }); // senza giocatori

    const p = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10 });
    let stanze;
    const warn = await catturandoIWarn(async () => { stanze = await p.load(); });

    check('l\'avvio non salta: si torna comunque una mappa', stanze && typeof stanze === 'object');
    check('sopravvive solo la stanza buona', Object.keys(stanze).join() === 'BUONA', Object.keys(stanze).join());
    check('e sopravvive intera', stanze.BUONA.players[0].balance === 1234);
    check('di ogni scarto si logga il motivo', warn.filter((m) => m.includes('scarto la stanza')).length === 3,
      warn.join(' | '));

    await p.flushNow();
    check('le voci illeggibili vengono anche tolte dall\'archivio, per non ritrovarsele a ogni avvio',
      !stato.dati.has(CHIAVE('ROTTA')) && !stato.dati.has(CHIAVE('VECCHI')) && !stato.dati.has(CHIAVE('MONCA')));
    check('mentre la buona resta', stato.dati.has(CHIAVE('BUONA')));
  }

  // ---------------------------------------------------------------------
  section('7. Archivio che non risponde: si continua a giocare, non si cade');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    stato.guastoConnessione = 'ECONNREFUSED 10.0.0.1:6379';
    const p = creaPersistenza({
      redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10, retryMs: 30,
    });

    let stanze;
    let warn = await catturandoIWarn(async () => { stanze = await p.load(); });
    check('load() non lancia e torna vuoto', Object.keys(stanze).length === 0);
    check('e spiega perché nel registro', warn.some((m) => m.includes('lettura')), warn.join(' | '));

    // La partita va avanti: le mosse si accumulano in memoria e i tentativi di
    // scrittura falliscono in silenzio (salvo un log ogni tanto).
    const game = partitaDiProva('GUAST');
    warn = await catturandoIWarn(async () => {
      for (let i = 0; i < 5; i++) { game.players[0].balance = 100 + i; p.save('GUAST', game); await attendi(20); }
      await attendi(60);
    });
    check('nessuna eccezione sfugge al salvataggio', true);
    check('il guaio viene loggato', warn.some((m) => m.includes('salvataggio')), warn.join(' | '));
    check('ma NON una riga per tentativo: il registro non si allaga',
      warn.filter((m) => m.includes('salvataggio')).length === 1, String(warn.length));

    // L'archivio torna su: il ritentativo deve recuperare quel che era rimasto
    // indietro, senza che nessuno debba rifare una mossa.
    stato.guastoConnessione = null;
    await attendi(150);
    check('quando l\'archivio torna, la stanza ci arriva da sola', stato.dati.has(CHIAVE('GUAST')));
    const recuperata = JSON.parse(stato.dati.get(CHIAVE('GUAST')).valore);
    check('e ci arriva con lo stato aggiornato, non con quello vecchio',
      recuperata.state.players[0].balance === 104, String(recuperata.state.players[0].balance));
  }

  // ---------------------------------------------------------------------
  section('8. Comandi che falliscono a connessione aperta');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    const p = creaPersistenza({
      redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10, retryMs: 30,
    });

    stato.guastoComandi = 'READONLY You can\'t write against a read only replica';
    const game = partitaDiProva('RONLY');
    await catturandoIWarn(async () => {
      p.save('RONLY', game);
      await attendi(60);
    });
    check('la scrittura fallita non ferma nulla', !stato.dati.has(CHIAVE('RONLY')));

    stato.guastoComandi = null;
    await attendi(120);
    check('e viene ritentata da sola appena si può', stato.dati.has(CHIAVE('RONLY')));
  }

  // ---------------------------------------------------------------------
  section('9. Archivio lentissimo: l\'avvio non resta appeso');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    stato.connessioneAppesa = true; // connect() non risponde MAI
    const p = creaPersistenza({
      redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10, loadTimeoutMs: 60,
    });

    const partenza = Date.now();
    let stanze;
    const warn = await catturandoIWarn(async () => { stanze = await p.load(); });
    const durata = Date.now() - partenza;
    check('load() si arrende entro il tetto di tempo invece di bloccare il server',
      durata < 1000, `${durata}ms`);
    check('e torna vuoto', Object.keys(stanze).length === 0);
    check('dicendo che non ha avuto risposta', warn.some((m) => m.includes('nessuna risposta')), warn.join(' | '));

    // Stesso discorso allo spegnimento, ed è un caso trovato provando davvero
    // con un Redis spento: se `flushNow` aspettasse la connessione — che con la
    // riconnessione automatica non si risolve MAI — il processo non morirebbe
    // più su SIGTERM e se lo verrebbe a prendere la piattaforma dopo un minuto.
    const q = creaPersistenza({
      redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10, flushTimeoutMs: 60,
    });
    q.save('LENTA', partitaDiProva('LENTA'));
    await attendi(40); // il salvataggio è partito e sta aspettando una connessione che non arriverà
    const partenza2 = Date.now();
    const warnSpegnimento = await catturandoIWarn(() => q.flushNow());
    const durata2 = Date.now() - partenza2;
    check('nemmeno flushNow() tiene in ostaggio lo spegnimento', durata2 < 1000, `${durata2}ms`);
    check('e dice che l\'ultimo salvataggio non è riuscito',
      warnSpegnimento.some((m) => m.includes('salvataggio finale')), warnSpegnimento.join(' | '));
    check('la connessione mai aperta viene staccata di netto, non aspettata',
      stato.comandi.includes('DESTROY'), stato.comandi.join(' | '));
  }

  // ---------------------------------------------------------------------
  section('10. flushNow() salva subito, senza aspettare il debounce');
  {
    const { fabbrica, stato } = fabbricaFintoRedis();
    const p = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 60000 });
    p.save('SPEGN', partitaDiProva('SPEGN'));
    check('col solo debounce (un minuto) non sarebbe ancora partita', !stato.dati.has(CHIAVE('SPEGN')));
    await p.flushNow();
    check('flushNow() la scrive comunque: è quel che serve a SIGTERM', stato.dati.has(CHIAVE('SPEGN')));
  }

  // ---------------------------------------------------------------------
  section('11. Scritture lente e sovrapposte: nell\'archivio finisce lo stato più nuovo');
  {
    // Il caso che il guardiano sulle scritture concorrenti esiste per evitare:
    // due SET sulla stessa stanza in volo insieme possono arrivare in ordine
    // invertito e lasciare nell'archivio uno stato PIÙ VECCHIO di quello già
    // scritto. Qui la scrittura dura 60ms e nel frattempo la partita va avanti.
    const { fabbrica, stato } = fabbricaFintoRedis();
    stato.ritardoSet = 60;
    const p = creaPersistenza({ redisUrl: 'redis://x:6379', creaClientRedis: fabbrica, debounceMs: 10 });

    const game = partitaDiProva('CORSA');
    game.players[0].balance = 1;
    p.save('CORSA', game);
    await attendi(25); // la scrittura è partita ed è ancora in volo
    for (let i = 2; i <= 6; i++) { game.players[0].balance = i; p.save('CORSA', game); }
    await attendi(300);

    const finale = JSON.parse(stato.dati.get(CHIAVE('CORSA')).valore);
    check('l\'ultimo stato è quello che resta', finale.state.players[0].balance === 6,
      String(finale.state.players[0].balance));
  }

  // ---------------------------------------------------------------------
  section('12. L\'archivio su file continua a funzionare come prima');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monopoly-persist-'));
    const file = path.join(dir, 'sotto', 'rooms-state.json'); // anche la cartella va creata
    const p = creaPersistenza({ file, debounceMs: 10 });

    check('il tipo è "file"', p.tipo === 'file');
    p.save('FILEA', partitaDiProva('FILEA'));
    await p.flushNow();
    check('il file viene creato, cartella compresa', fs.existsSync(file));

    const secondo = creaPersistenza({ file, debounceMs: 10 });
    const stanze = await secondo.load();
    check('e rileggendolo si ritrova la partita', stanze.FILEA?.players[0].balance === 1234);

    secondo.remove('FILEA');
    await secondo.flushNow();
    const terzo = creaPersistenza({ file, debounceMs: 10 });
    check('remove() la toglie anche dal file', Object.keys(await terzo.load()).length === 0);

    // File corrotto: come per Redis, non deve impedire l'avvio.
    fs.writeFileSync(file, '{questo non è JSON');
    const quarto = creaPersistenza({ file, debounceMs: 10 });
    let stanzeRotte;
    const warn = await catturandoIWarn(async () => { stanzeRotte = await quarto.load(); });
    check('un file corrotto non blocca l\'avvio', Object.keys(stanzeRotte).length === 0);
    check('e il motivo si legge nel registro', warn.some((m) => m.includes('fallita')), warn.join(' | '));

    // File inesistente: è il primo avvio, non è un guaio e non si logga nulla.
    const quinto = creaPersistenza({ file: path.join(dir, 'mai-scritto.json'), debounceMs: 10 });
    const warnVuoti = await catturandoIWarn(async () => { await quinto.load(); });
    check('un archivio ancora vuoto non fa rumore', warnVuoti.length === 0, warnVuoti.join(' | '));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------
  section('13. Il contratto con rooms.js e server.js');
  {
    // server.js aspetta `roomManager.ready` prima di mettersi in ascolto: con
    // la persistenza spenta deve essere una promessa già risolta, non un
    // `undefined` che farebbe saltare l'avvio.
    const { RoomManager } = require('./src/rooms');
    const rm = new RoomManager();
    check('RoomManager espone `ready`', typeof rm.ready?.then === 'function');
    await rm.ready;
    check('con la persistenza spenta si risolve subito e senza stanze', rm.roomCodes().length === 0);

    // Le funzioni che i chiamanti usano ci sono tutte e hanno la forma attesa.
    const modulo = require('./src/persistence');
    ['load', 'save', 'remove', 'flushNow'].forEach((nome) => {
      check(`persistence.${nome} è ancora lì`, typeof modulo[nome] === 'function');
    });
    check('load() torna una promessa (ora l\'archivio può essere di rete)',
      typeof modulo.load().then === 'function');
    check('save() invece resta sincrona: sta sul percorso di ogni mossa',
      modulo.save('X', {}) === undefined);
  }

  // ---------------------------------------------------------------------
  console.log(`\n${passed} test superati, ${failed} falliti`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nIl test è esploso fuori da ogni asserzione:', err);
  process.exit(1);
});
