const { GameEngine, SKIP_TURN_DELAY_MS } = require('./gameEngine');
const persistence = require('./persistence');

// Una stanza rimasta senza nessuno collegato per più di così viene buttata via.
// Deve essere abbondante: i giocatori possono chiudere il browser e rientrare.
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // 3 ore
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

class RoomManager {
  constructor() {
    // code -> { game, sockets: Map<socketId, playerId>, emptySince: number | null,
    //           botTimer: Timeout | null, turnPlayerId, turnSince, offlineSince }
    // Gli ultimi tre sono gli orologi del tavolo (vedi newRoom e noteTurn):
    // stanno qui e non nel motore perché GameEngine è puro e sincrono e non
    // guarda mai l'ora — la soglia è una regola e vive lì, il tempo che scorre
    // vive qui.
    this.rooms = new Map();
    // Se la persistenza è attiva (vedi persistence.js) le stanze salvate da un
    // avvio precedente sono già pronte qui prima ancora che arrivi un socket:
    // un client con la partita in localStorage può fare rejoin_room da subito.
    this.restoreFromDisk();
  }

  /**
   * Ricostruisce le stanze da un eventuale salvataggio su disco. GameEngine
   * resta puro e non sa ricostruirsi da solo (nessun metodo apposta, per non
   * toccare gameEngine.js): si crea un'istanza vuota con `new GameEngine` e le
   * si assegnano sopra i campi salvati, esattamente come suggerisce la
   * consegna. Ogni stanza si ricostruisce per conto suo: una voce corrotta o
   * incompleta non deve far perdere anche le altre, quindi si scarta solo lei
   * (e si toglie anche dall'archivio, così non la si ritenta ai prossimi avvii).
   */
  restoreFromDisk() {
    if (!persistence.enabled) return;
    const states = persistence.load();
    const codes = [];
    for (const [code, state] of Object.entries(states)) {
      try {
        const game = Object.assign(new GameEngine(code), state);
        // In questo processo non è ancora agganciato nessun socket: chi al
        // salvataggio risultava online va segnato come offline finché non
        // rientra con rejoin_room, altrimenti il tabellone lo mostrerebbe
        // connesso senza che nessuno stia davvero giocando per lui. I bot non
        // hanno mai un socket: restano come sono.
        game.players.forEach((p) => { if (!p.isBot) p.connected = false; });
        // emptySince riparte da adesso: come se la stanza fosse rimasta vuota
        // da questo istante, dà ai giocatori l'intera finestra di ROOM_TTL_MS
        // per rientrare prima che sweep() la consideri scaduta (vedi sotto).
        // Anche gli orologi ripartono da adesso, per la stessa ragione di
        // emptySince: al riavvio nessuno è ancora rientrato, e il turno in
        // corso va considerato fermo da questo istante, non da quando lo era
        // nel processo precedente — altrimenti il primo che si ricollega
        // troverebbe l'attesa già scaduta e potrebbe saltare il turno di uno
        // che non ha ancora avuto un secondo per rientrare.
        this.rooms.set(code, { ...this.newRoom(game), emptySince: Date.now() });
        codes.push(code);
      } catch (err) {
        console.warn(`[persistence] stanza ${code} scartata alla ricostruzione: ${err.message}`);
        persistence.remove(code);
      }
    }
    if (codes.length) console.log(`[persistence] stanze pronte al riavvio: ${codes.join(', ')}.`);
  }

  /**
   * Voce di stanza nuova. Esiste per non dover ricordare in due posti (qui e
   * nel ripristino da disco) quali campi la compongono: gli orologi del turno
   * sono arrivati dopo, e un campo dimenticato in uno dei due rami avrebbe
   * significato `undefined` nei conti del tempo.
   */
  newRoom(game, now = Date.now()) {
    return {
      game,
      sockets: new Map(),
      emptySince: null,
      botTimer: null,
      // Chi ha il turno adesso e da quando: aggiornati da noteTurn, che
      // server.js chiama dopo ogni cambiamento di stato.
      turnPlayerId: game.currentPlayer?.id ?? null,
      turnSince: now,
      // playerId -> istante in cui è caduta la sua ultima connessione. Serve a
      // non contare come "fermo da un pezzo" il turno di chi è appena caduto
      // dopo aver giocato a lungo (vedi stalledTurnMs).
      offlineSince: new Map(),
    };
  }

  /** Codici di tutte le stanze aperte in questo momento. */
  roomCodes() {
    return [...this.rooms.keys()];
  }

  createRoom() {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));
    const game = new GameEngine(code);
    this.rooms.set(code, this.newRoom(game));
    return code;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  /**
   * Associa un socket a un giocatore. Un giocatore può averne PIÙ D'UNO nello
   * stesso momento — una seconda scheda, il telefono che si riconnette mentre
   * la vecchia connessione non è ancora caduta, il link d'invito riaperto — e
   * qui si tengono tutti.
   *
   * Prima il collegamento vecchio veniva cancellato, "l'identità è una sola".
   * Il ragionamento era giusto sull'identità e sbagliato sui socket: buttava
   * via un collegamento ancora VIVO. Bastava aprire una seconda scheda e
   * richiuderla per finire segnati offline mentre si continuava a giocare
   * dalla prima, che nel frattempo era sparita dalla mappa e non ci sarebbe
   * più rientrata da sola (attachSocket lo richiama solo un `connect` nuovo).
   *
   * Tenendoli tutti, `connected` diventa semplicemente "esiste almeno un
   * socket vivo per questo giocatore", che è la domanda a cui deve rispondere.
   * Le voci morte non si accumulano: socket.io emette comunque `disconnect`,
   * al più dopo il timeout del ping, e detachSocket toglie la sua e ricalcola.
   */
  attachSocket(code, socketId, playerId) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.sockets.set(socketId, playerId);
    room.emptySince = null;
    // È tornato: l'orologio della sua assenza non ha più niente da misurare.
    room.offlineSince.delete(playerId);
    room.game.setConnected(playerId, true);
  }

  /**
   * Rimette in pari lo stato di connessione di chi ha appena fatto una mossa.
   * Rete di sicurezza voluta: se un giocatore sta agendo, per definizione è
   * collegato, qualunque cosa dica la mappa. Serve perché il difetto sopra si
   * era manifestato proprio così — uno che giocava normalmente e che tutti
   * vedevano "disconnesso" — e una divergenza del genere non deve poter
   * sopravvivere a una mossa, da qualunque strada sia arrivata.
   *
   * Torna true se qualcosa è cambiato, così chi chiama sa se vale la pena
   * ritrasmettere lo stato.
   */
  ensureConnected(code, socketId, playerId) {
    const room = this.rooms.get(code);
    if (!room || !playerId) return false;
    const giocatore = room.game.players.find((p) => p.id === playerId);
    const mancaIlSocket = room.sockets.get(socketId) !== playerId;
    if (!mancaIlSocket && giocatore?.connected) return false;
    room.sockets.set(socketId, playerId);
    room.emptySince = null;
    room.offlineSince.delete(playerId);
    room.game.setConnected(playerId, true);
    return true;
  }

  /**
   * Stacca un socket caduto. Il giocatore resta al tavolo con le sue proprietà:
   * viene solo segnato come disconnesso, così può rientrare con lo stesso id.
   * Restituisce le stanze toccate, per aggiornare chi è rimasto.
   */
  detachSocket(socketId, now = Date.now()) {
    const touched = [];
    for (const [code, room] of this.rooms) {
      const playerId = room.sockets.get(socketId);
      if (playerId === undefined) continue;
      room.sockets.delete(socketId);
      // Solo se non è rimasto nessun altro socket per lo stesso giocatore.
      if (![...room.sockets.values()].includes(playerId)) {
        // Da qui parte il conto dell'assenza (vedi stalledTurnMs): si segna
        // solo alla caduta VERA, cioè quando non gli resta più nemmeno un
        // socket, altrimenti chiudere una seconda scheda farebbe ripartire un
        // orologio per uno che sta giocando dall'altra.
        room.offlineSince.set(playerId, now);
        room.game.setConnected(playerId, false);
      }
      if (room.sockets.size === 0) room.emptySince = Date.now();
      touched.push(code);
    }
    return touched;
  }

  /**
   * Prende nota di un eventuale cambio di turno. Va chiamata dopo ogni
   * cambiamento di stato (server.js lo fa da broadcastState, che è il punto da
   * cui passa già tutto): il motore non ha modo di dire "da quando" tocca a
   * qualcuno, e sta a chi ha l'orologio accorgersene.
   *
   * Volutamente osservativa e non un evento: qualunque strada faccia avanzare
   * il turno — endTurn, advanceTurn dopo un abbandono, un salto — passa
   * comunque da un broadcast, quindi non c'è un punto che si possa dimenticare
   * di aggiornare.
   */
  noteTurn(code, now = Date.now()) {
    const room = this.rooms.get(code);
    if (!room) return;
    const inTurno = room.game.currentPlayer?.id ?? null;
    if (inTurno === room.turnPlayerId) return;
    room.turnPlayerId = inTurno;
    room.turnSince = now;
  }

  /**
   * Da quanti millisecondi la partita è ferma perché chi ha il turno è
   * disconnesso, oppure null se non è ferma affatto (partita non iniziata o
   * finita, o giocatore di turno collegato).
   *
   * Si conta dal PIÙ RECENTE fra due istanti, non solo dall'inizio del turno:
   * chi cade dopo aver già giocato mezzo minuto del suo turno non deve poter
   * essere saltato all'istante, l'attesa deve partire da quando è caduto. E
   * viceversa chi era già offline da un'ora quando gli è arrivato il turno non
   * si salta subito: l'attesa parte da quando è diventato un problema, cioè da
   * quando la mano è passata a lui.
   */
  stalledTurnMs(code, now = Date.now()) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const game = room.game;
    if (!game.started || game.finished) return null;
    const inTurno = game.currentPlayer;
    if (!inTurno || inTurno.connected !== false) return null;
    const caduto = room.offlineSince.get(inTurno.id) || 0;
    return Math.max(0, now - Math.max(room.turnSince, caduto));
  }

  /**
   * Quel che serve al client per mostrare (o non mostrare) il comando "salta
   * il turno": chi tiene fermo il tavolo e quanto manca prima che il salto sia
   * ammesso.
   *
   * L'attesa viaggia come DURATA residua e non come istante assoluto di
   * scadenza: l'orologio di un telefono può essere sfasato di minuti rispetto
   * a quello del server, e un conto alla rovescia calcolato su due orologi
   * diversi sarebbe sbagliato proprio dove conta. Il client parte da quando lo
   * riceve.
   */
  blockedTurn(code, now = Date.now()) {
    const fermoDa = this.stalledTurnMs(code, now);
    if (fermoDa === null) return null;
    const room = this.rooms.get(code);
    return {
      playerId: room.game.currentPlayer.id,
      attesaRimanenteMs: Math.max(0, SKIP_TURN_DELAY_MS - fermoDa),
    };
  }

  /**
   * Chiude una stanza a partita conclusa. Il codice smette subito di funzionare:
   * chi ricarica non rientra in un tavolo morto, torna alla lobby.
   */
  closeRoom(code) {
    const room = this.rooms.get(code);
    if (room) clearTimeout(room.botTimer);
    // Anche l'archivio va chiuso con la stanza: senza questo, una partita
    // conclusa e già ripulita dalla memoria ricomparirebbe al prossimo
    // riavvio del processo, presa dal file rimasto indietro.
    persistence.remove(code);
    return this.rooms.delete(code);
  }

  /** Butta via le stanze vuote da troppo tempo, per non accumularle in memoria. */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > ROOM_TTL_MS) {
        // Se un bot aveva una mossa in coda, muore con la stanza.
        clearTimeout(room.botTimer);
        this.rooms.delete(code);
        // Stessa scadenza anche nell'archivio: altrimenti crescerebbe
        // all'infinito con stanze che in memoria non esistono già più.
        persistence.remove(code);
        removed += 1;
      }
    }
    return removed;
  }

  /** Avvia la pulizia periodica. `unref` per non tenere vivo il processo. */
  startSweeping() {
    const timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    timer.unref?.();
    return timer;
  }
}

module.exports = { RoomManager, ROOM_TTL_MS };
