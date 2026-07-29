'use strict';

/*
 * Persistenza delle partite: salva su file lo stato di ogni stanza, per
 * sopravvivere al riavvio del processo Node (crash, riavvio manuale, `npm
 * start` rilanciato dopo un aggiornamento in locale). Spenta di default: si
 * attiva solo impostando PERSIST_FILE nell'ambiente (vedi server/.env.example
 * e la tabella nel README). Senza quella variabile questo modulo è un no-op
 * completo: nessun file viene creato, nessuna I/O in più rispetto a prima.
 *
 * ATTENZIONE — limite noto, spiegato anche nel README: in produzione questo
 * progetto gira su Render piano gratuito, dove il filesystem è EFFIMERO:
 * viene ricreato da zero a ogni deploy e a ogni riavvio dell'istanza. Questo
 * file quindi protegge da un crash o un riavvio "sul posto" (in locale, su un
 * host con un disco vero, sotto PM2...), ma NON dal caso che càpita più
 * spesso in produzione, cioè un nuovo deploy: il disco su cui è stato scritto
 * semplicemente non esiste più al riavvio successivo. Per risolvere quello
 * serve un archivio esterno al container (Redis, un database, un bucket
 * S3...) che sopravviva al deploy. Per questo l'interfaccia esposta da questo
 * modulo è ridotta a `load / save / remove`: il giorno in cui servirà un
 * archivio esterno, sostituire l'implementazione qui dentro (con qualcosa che
 * parli con Redis o un DB) è una riscrittura di QUESTO SOLO file — rooms.js e
 * server.js chiamano sempre le stesse tre funzioni e non sanno, e non devono
 * sapere, che dietro c'è un file su disco piuttosto che un servizio esterno.
 *
 * Il motore (gameEngine.js) resta completamente estraneo a tutto questo: non
 * ha idea che la persistenza esista, non fa I/O, non ha `await`. È rooms.js
 * (via server.js, dove già si ribroadcasta lo stato a ogni cambiamento) a
 * leggere da fuori i campi di un'istanza di GameEngine e a passarli qui per
 * il salvataggio, e a ricostruirne una nuova a partire da qui al riavvio.
 */

const fs = require('fs');
const path = require('path');

// La presenza della variabile è l'interruttore: niente flag booleano
// separato da tenere sincronizzato. Se non si imposta PERSIST_FILE il
// comportamento resta identico a prima di questa funzionalità.
const FILE = process.env.PERSIST_FILE || '';
const enabled = Boolean(FILE);

// Cambia solo se cambia la FORMA di ciò che salviamo (per esempio un campo
// nuovo che GameEngine si aspetta di trovare sempre valorizzato). Un
// salvataggio con versione diversa da questa si scarta invece di tentare una
// ricostruzione parziale che potrebbe rompersi a metà partita in modi
// imprevedibili: meglio perdere quella stanza che avere un motore in uno
// stato inconsistente.
const SCHEMA_VERSION = 1;

// Ogni mossa di gioco cambia lo stato della stanza. Se si scrivesse su disco
// in modo sincrono a ogni mossa, ogni azione (anche solo tirare i dadi)
// aspetterebbe un giro di I/O prima di rispondere al client: si sentirebbe.
// Si accorpano invece le modifiche ravvicinate con un semplice debounce: la
// scrittura vera parte solo dopo un momento di quiete di DEBOUNCE_MS, così
// una sequenza di mosse rapide (un intero turno, un'asta con vari rilanci)
// produce una sola scrittura su disco invece di una per mossa. Il file resta
// comunque piccolo (pochi KB), quindi anche la singola scrittura, quando
// parte, costa pochissimo: non serve altro che questo per restare invisibile
// al gioco.
const DEBOUNCE_MS = 2000;

// Specchio in memoria di quello che (una volta che flush() gira) sta scritto
// sul file: { [roomCode]: { v, savedAt, state } }. Evita di rileggere il
// file a ogni save/remove: lo si legge una sola volta, all'avvio (load()).
let store = {};
let dirty = false;
let flushTimer = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
}

/**
 * Legge l'archivio da disco all'avvio del processo. Ritorna una mappa
 * { roomCode: state } pronta da usare per ricostruire le partite (vedi
 * RoomManager.restoreFromDisk in rooms.js).
 *
 * Un file assente è la situazione normale (primo avvio, o persistenza
 * appena attivata su un ambiente che non l'aveva mai usata): si parte
 * vuoti, senza nemmeno un log d'allarme. Un file illeggibile, un JSON
 * corrotto, o singole voci di uno schema che non riconosciamo NON devono
 * impedire l'avvio del server: si scarta quel che non torna e si logga il
 * motivo, e si riparte come se non ci fosse nulla di salvato. Meglio perdere
 * delle partite che avere un server che non parte più per colpa di due
 * caratteri sbagliati in un file.
 */
function load() {
  store = {};
  const restored = {};
  if (!enabled) return restored;

  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[persistence] impossibile leggere ${FILE} (${err.message}): riparto senza stato salvato.`);
    }
    return restored;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[persistence] ${FILE} è corrotto (${err.message}): riparto senza stato salvato.`);
    return restored;
  }

  for (const [code, entry] of Object.entries(parsed || {})) {
    // Controllo minimo di forma: versione riconosciuta e almeno l'array dei
    // giocatori presente. Non è una validazione esaustiva (non serve: se
    // qualcos'altro non torna, la ricostruzione in rooms.js la scarta comunque
    // col suo try/catch), solo un primo filtro contro i casi più ovvi.
    if (!entry || entry.v !== SCHEMA_VERSION || !entry.state || !Array.isArray(entry.state.players)) {
      console.warn(`[persistence] scarto la stanza ${code}: salvataggio di una versione non riconosciuta o incompleto.`);
      continue;
    }
    store[code] = entry;
    restored[code] = entry.state;
  }

  const n = Object.keys(restored).length;
  if (n > 0) console.log(`[persistence] ripristinate ${n} stanze da ${FILE}.`);
  return restored;
}

function scheduleFlush() {
  if (!enabled || flushTimer) return;
  flushTimer = setTimeout(flush, DEBOUNCE_MS);
  flushTimer.unref?.(); // il timer di scrittura non deve tenere vivo il processo da solo
}

/**
 * Scrittura vera su disco: tutte le stanze in un solo file (lo stato di una
 * partita pesa pochi KB, il volume non è mai stato il problema, vedi il
 * commento in cima al file) con scrittura atomica — file temporaneo poi
 * rename — così un crash proprio nell'istante della scrittura non lascia un
 * JSON tagliato a metà che poi fallirebbe il prossimo load().
 */
function flush() {
  flushTimer = null;
  if (!enabled || !dirty) return;
  try {
    ensureDir();
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, FILE);
    dirty = false;
  } catch (err) {
    console.warn(`[persistence] scrittura su ${FILE} fallita (${err.message}): per ora la partita resta solo in memoria.`);
  }
}

/**
 * Segna una stanza come da salvare e ne accoda la scrittura (vedi
 * DEBOUNCE_MS). `game` è l'istanza di GameEngine così com'è, non il suo
 * serialize(): quello è pensato per il client e mostra volutamente meno di
 * quanto serva per far ripartire davvero la partita (mancano per esempio i
 * mazzi delle carte e la carta pescata non ancora letta). Si clona con un
 * giro JSON invece di elencare i campi a mano, così l'istantanea segue da
 * sola ogni campo dell'istanza — presente e futuro — senza dover tenere
 * questo file sincronizzato a mano ogni volta che gameEngine.js cambia.
 */
function save(code, game) {
  if (!enabled) return;
  store[code] = { v: SCHEMA_VERSION, savedAt: Date.now(), state: JSON.parse(JSON.stringify(game)) };
  dirty = true;
  scheduleFlush();
}

/** Toglie una stanza dall'archivio: tavolo chiuso o scaduto (vedi rooms.js). */
function remove(code) {
  if (!enabled) return;
  if (!(code in store)) return;
  delete store[code];
  dirty = true;
  scheduleFlush();
}

/**
 * Forza subito la scrittura, saltando l'attesa del debounce. Usata allo
 * spegnimento pulito del processo (SIGTERM/SIGINT, vedi server.js) per non
 * perdere le mosse fatte nell'ultima finestra di debounce. Un `kill -9` non
 * passa da qui: in quel caso si perde al più quella finestra, per scelta
 * (vedi il commento su DEBOUNCE_MS).
 */
function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
}

module.exports = { enabled, load, save, remove, flushNow };
