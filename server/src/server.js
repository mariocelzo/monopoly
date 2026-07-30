const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { board } = require('./data/board');
const { botMove, botHasMove } = require('./bot');
const persistence = require('./persistence');

const PORT = process.env.PORT || 3001;

// Nomi e pedoni per i bot, assegnati in ordine.
const BOT_NAMES = ['Bot Aurelio', 'Bot Cleopatra', 'Bot Fulvio', 'Bot Ottavia', 'Bot Silvio'];
const BOT_TOKENS = ['🐕', '🎩', '🚗', '🚢', '🐈', '🎸'];

// Pausa fra una mossa del bot e la successiva, decisa in base a COSA il bot ha
// appena fatto: è il tempo che si lascia a chi guarda per vedere l'ultima cosa
// successa, non un ritardo uguale per tutto.
//
// La versione precedente usava un unico intervallo di 1,7-3,0s per QUALUNQUE
// mossa. Il guaio è che la pausa è per mossa, non per turno, e un turno di bot
// sono in media 2,25 mosse: con tre bot al tavolo, fra due turni umani
// passavano 16 secondi. Troppi — la partita si sentiva trascinare.
//
// Il grosso del tempo però non stava dove sembrava. Su partite intere simulate
// le aste risultano l'1% delle mosse, e le prime versioni di questa tabella,
// tarate su quel numero, non hanno spostato niente nella partita vera: 16
// secondi prima, 16 dopo. Cronometrando il server durante una partita vera
// (DEBUG_RITMO, vedi scheduleBotMove) è saltato fuori il motivo — a INIZIO
// partita le aste non sono l'1% delle mosse ma la maggioranza: ogni casella è
// ancora libera, ogni rifiuto ne apre una, e in un'asta ogni giocatore rilancia
// o passa a turno. Con quattro al tavolo, una singola proprietà rifiutata erano
// nove mosse di fila e undici secondi. È esattamente l'inizio partita, cioè il
// momento in cui il rallentamento si è sentito.
//
// Da qui la forma della tabella: i passaggi d'asta costano pochissimo (non c'è
// niente da guardare in un "passo"), i tiri restano generosi (la pedina si
// muove e c'è una casella nuova da leggere), il resto sta in mezzo. Misurato
// end-to-end contro il server vero: da 16 a 9-11 secondi per giro.
//
// L'intervallo resta casuale perché una persona non risponde mai due volte alla
// stessa distanza: senza quello si sente il metronomo.
const PAUSE_BOT = {
  tiro: [1300, 1900], // la pedina si muove: è il momento che chiede più tempo
  prigione: [1000, 1500],
  carta: [1200, 1800], // c'è un testo da leggere
  affitto: [1100, 1600],
  acquisto: [1100, 1600],
  tassa: [1000, 1400],
  debito: [1100, 1500],
  scambio: [1100, 1600],
  'risposta-scambio': [1000, 1500],
  // Un'asta è uno scambio rapido di battute, non una rivelazione: la pausa
  // serve a far leggere il rilancio, non a creare suspense. E un "passo" non è
  // proprio niente da guardare.
  'asta-rilancio': [400, 700],
  'asta-passo': [200, 380],
  rifiuto: [800, 1200],
  costruzione: [700, 1100], // cambia un numero, si legge in fretta
  'fine-turno': [250, 500], // non c'è niente da vedere: la mano passa e via
  rivincita: [250, 500],
};
// Per una mossa di cui non si conosce il tipo, e per la primissima mossa di un
// bot dopo che ha giocato un umano.
const PAUSA_PREDEFINITA = [700, 1200];

const pausaBot = (tipoUltimaMossa) => {
  const [min, max] = PAUSE_BOT[tipoUltimaMossa] || PAUSA_PREDEFINITA;
  return min + Math.floor(Math.random() * (max - min));
};

// CLIENT_ORIGIN accetta più origini separate da virgola: in produzione servono
// almeno il dominio vero e quelli di anteprima. Vuoto = tutte, comodo in locale.
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Origine da rimandare indietro, o null se non è ammessa. */
function allowedOrigin(origin) {
  if (ALLOWED_ORIGINS.length === 0) return '*';
  if (!origin) return null; // richieste senza Origin (curl, health check): nessun header
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*' },
});

const roomManager = new RoomManager();

// Le rotte HTTP hanno bisogno degli stessi header CORS di Socket.io: senza,
// il client servito da un'altra origine non riesce a scaricare /board.
app.use((req, res, next) => {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    // Con più origini ammesse la risposta cambia in base a Origin: le cache
    // devono saperlo, altrimenti servono l'header sbagliato all'altro dominio.
    if (origin !== '*') res.header('Vary', 'Origin');
  }
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/board', (req, res) => res.json(board));

function broadcastState(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit('state', room.game.serialize());
  // Salvataggio differito della stanza (no-op se PERSIST_FILE non è
  // impostata, vedi persistence.js): si aggancia qui perché broadcastState
  // gira già dopo ogni cambiamento di stato, lo stesso identico punto da cui
  // parte il broadcast ai client. Non rallenta questo giro: la scrittura vera
  // è accodata e parte solo dopo un attimo di quiete.
  persistence.save(roomCode, room.game);
  scheduleBotMove(roomCode);
}

/**
 * Se un bot ha una mossa da fare, la schedula. Una sola alla volta per stanza:
 * finché un timer è in coda non se ne aggiunge un altro, così più broadcast
 * ravvicinati non generano mosse sovrapposte.
 *
 * Con `DEBUG_RITMO=1` stampa ogni pausa scelta e la mossa che ne segue. Serve
 * per le domande sul ritmo, e non è un di più: la taratura di PAUSE_BOT era
 * stata fatta due volte sulle statistiche di partite simulate, e due volte
 * aveva mancato il bersaglio perché la composizione delle mosse a inizio
 * partita non somiglia a quella di una partita intera. È stato questo log a
 * mostrare dove finivano davvero i secondi.
 */
function scheduleBotMove(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room || room.botTimer) return;
  if (!botHasMove(room.game)) return;

  const pausaScelta = pausaBot(room.ultimaMossaBot);
  if (process.env.DEBUG_RITMO) {
    console.log(`[ritmo] pausa ${pausaScelta}ms dopo "${room.ultimaMossaBot || 'inizio'}"`);
  }
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    // La stanza può essere sparita nel frattempo (tavolo chiuso, scaduta).
    const ancora = roomManager.getRoom(roomCode);
    if (!ancora) return;
    // botMove ora torna il TIPO di mossa fatta (o false se non ne aveva
    // nessuna): serve a dosare la pausa successiva su quanto c'è da guardare.
    const tipo = botMove(ancora.game);
    if (process.env.DEBUG_RITMO) console.log(`[ritmo]   -> mossa: ${tipo}`);
    if (tipo) {
      ancora.ultimaMossaBot = tipo;
      broadcastState(roomCode);
    }
  }, pausaScelta);
  room.botTimer.unref?.();
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  /** Aggancia il socket alla stanza e ricorda chi è, per gli eventi successivi. */
  function bind(code, playerId) {
    roomManager.attachSocket(code, socket.id, playerId);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
  }

  // L'identità del giocatore è il clientId scelto dal browser e conservato in
  // localStorage, non l'id del socket: quello cambia a ogni riconnessione.
  socket.on('create_room', ({ name, token, clientId }, cb) => {
    if (!clientId) return cb?.({ error: 'Identificativo mancante' });
    const code = roomManager.createRoom();
    const room = roomManager.getRoom(code);
    const added = room.game.addPlayer(clientId, name, token);
    if (added?.error) return cb?.(added);
    bind(code, clientId);
    cb?.({ roomCode: code, playerId: clientId });
    broadcastState(code);
  });

  socket.on('join_room', ({ roomCode, name, token, clientId }, cb) => {
    if (!clientId) return cb?.({ error: 'Identificativo mancante' });
    const room = roomManager.getRoom(roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    // Chi è già al tavolo non si iscrive di nuovo: rientra e basta.
    if (room.game.hasPlayer(clientId)) {
      bind(roomCode, clientId);
      cb?.({ roomCode, playerId: clientId });
      broadcastState(roomCode);
      return;
    }
    if (room.game.started) return cb?.({ error: 'Partita già iniziata' });
    // Il pedone può essere già preso: l'errore riporta quali sono occupati, così
    // la lobby li disabilita invece di far tirare a indovinare.
    const added = room.game.addPlayer(clientId, name, token);
    if (added?.error) return cb?.(added);
    bind(roomCode, clientId);
    cb?.({ roomCode, playerId: clientId });
    broadcastState(roomCode);
  });

  /**
   * Rientro dopo un ricaricamento o una caduta di rete: nessun nuovo giocatore,
   * si riaggancia il socket a chi era già al tavolo. Il client lo chiama a ogni
   * connessione se ha una partita salvata.
   */
  socket.on('rejoin_room', ({ roomCode, clientId }, cb) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (!clientId || !room.game.hasPlayer(clientId)) {
      return cb?.({ error: 'Non risulti a questo tavolo' });
    }
    bind(roomCode, clientId);
    cb?.({ roomCode, playerId: clientId });
    broadcastState(roomCode);
  });

  // I bot li gestisce solo chi ha creato il tavolo, e solo prima del via.
  socket.on('add_bot', (payload, cb) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (room.game.hostId !== socket.data.playerId) {
      return cb?.({ error: 'Solo chi ha creato il tavolo può aggiungere bot' });
    }
    if (room.game.started) return cb?.({ error: 'La partita è già iniziata' });

    const usati = room.game.takenTokens();
    const token = BOT_TOKENS.find((t) => !usati.includes(t));
    if (!token) return cb?.({ error: 'Nessun pedone libero' });
    const nome = BOT_NAMES[room.game.botCounter % BOT_NAMES.length];

    const res = room.game.addBot(nome, token);
    broadcastState(socket.data.roomCode);
    cb?.(res);
  });

  socket.on('remove_bot', ({ botId }, cb) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (room.game.hostId !== socket.data.playerId) {
      return cb?.({ error: 'Solo chi ha creato il tavolo può togliere i bot' });
    }
    const res = room.game.removeBot(botId);
    broadcastState(socket.data.roomCode);
    cb?.(res);
  });

  // Le regole della casa (Via, montepremi, asta, saldo iniziale) si scelgono
  // solo prima del via, e solo da chi ha creato il tavolo: stesso controllo
  // di add_bot/remove_bot qui sopra. GameEngine.setRules ripete comunque
  // entrambi i controlli al suo interno (chi ha creato il tavolo, partita non
  // iniziata): questo qui è solo il primo filtro, non l'unico.
  socket.on('set_rules', (payload, cb) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (room.game.hostId !== socket.data.playerId) {
      return cb?.({ error: 'Solo chi ha creato il tavolo può cambiare le regole' });
    }
    const res = room.game.setRules(socket.data.playerId, payload || {});
    broadcastState(socket.data.roomCode);
    cb?.(res);
  });

  socket.on('start_game', () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return;
    room.game.start();
    broadcastState(socket.data.roomCode);
  });

  // generic wrapper: call a GameEngine method by name with the player's id
  const withGame = (handler) => (payload, cb) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    // Chi sta mandando una mossa è collegato, per definizione: se la mappa dei
    // socket dice il contrario è la mappa a essere indietro, e va rimessa in
    // pari prima di trasmettere lo stato (vedi ensureConnected in rooms.js).
    // Costa un confronto per mossa e chiude in modo definitivo la classe di
    // difetti "sta giocando ma tutti lo vedono disconnesso".
    roomManager.ensureConnected(socket.data.roomCode, socket.id, socket.data.playerId);
    const result = handler(room.game, socket.data.playerId, payload || {});
    broadcastState(socket.data.roomCode);
    cb?.(result || {});
  };

  socket.on('roll_dice', withGame((game, playerId) => game.rollDice(playerId)));
  socket.on('buy_property', withGame((game, playerId) => game.buyProperty(playerId)));
  socket.on('decline_buy', withGame((game, playerId) => game.declineBuy(playerId)));
  // Conferma di lettura della carta: solo dopo l'effetto si applica.
  // Conferma del pagamento dell'affitto.
  socket.on('pay_tax', withGame((game, playerId) => game.payTax(playerId)));
  socket.on('pay_rent', withGame((game, playerId) => game.payRent(playerId)));
  socket.on('acknowledge_card', withGame((game, playerId) => game.acknowledgeCard(playerId)));
  socket.on('pay_jail_fine', withGame((game, playerId) => game.payJailFine(playerId)));
  socket.on('use_jail_card', withGame((game, playerId) => game.useJailCard(playerId)));
  socket.on('build_house', withGame((game, playerId, { position }) => game.buildHouse(playerId, position)));
  socket.on('sell_house', withGame((game, playerId, { position }) => game.sellHouse(playerId, position)));
  socket.on('mortgage_property', withGame((game, playerId, { position }) => game.mortgageProperty(playerId, position)));
  socket.on('unmortgage_property', withGame((game, playerId, { position }) => game.unmortgageProperty(playerId, position)));
  // Asta sulla proprietà rifiutata: rilancio o passo. L'importo arriva dal
  // client come intento grezzo; la validazione (minimo, cassa) sta tutta nel
  // motore, qui si passa solo il dato.
  socket.on('auction_bid', withGame((game, playerId, { amount }) => game.bidAuction(playerId, amount)));
  socket.on('auction_pass', withGame((game, playerId) => game.passAuction(playerId)));
  // Risoluzione di un debito: liquidazione automatica oppure resa.
  socket.on('resolve_debt_auto', withGame((game, playerId) => game.resolveDebtAuto(playerId)));
  socket.on('declare_bankruptcy', withGame((game, playerId) => game.declareBankruptcy(playerId)));
  // Scambi fra giocatori: proposta e risposta.
  socket.on('propose_trade', withGame((game, playerId, payload) => game.proposeTrade(playerId, payload)));
  socket.on('respond_trade', withGame((game, playerId, { accept }) => game.respondTrade(playerId, !!accept)));
  // Abbandonare chiude la partita ma lascia in piedi il tavolo: si puo' chiedere
  // la rivincita. Il tavolo si distrugge solo con "Chiudi il tavolo", che e'
  // esattamente cio' che quel bottone promette.
  socket.on('abandon_game', withGame((game, playerId) => game.abandonGame(playerId)));
  socket.on('request_rematch', withGame((game, playerId) => game.requestRematch(playerId)));

  socket.on('end_game', (payload, cb) => {
    const code = socket.data.roomCode;
    const room = roomManager.getRoom(code);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    const result = room.game.endGame(socket.data.playerId);
    broadcastState(code);
    if (room.game.finished) roomManager.closeRoom(code);
    cb?.(result || {});
  });

  socket.on('end_turn', withGame((game, playerId) => {
    if (game.currentPlayer?.id !== playerId) return { error: 'Non è il tuo turno' };
    return game.endTurn();
  }));

  /**
   * Il giocatore torna alla home senza arrendersi: resta al tavolo con tutto il
   * suo, ma il socket si sgancia dalla stanza. Cosi' l'altro lo vede offline
   * invece di aspettare un turno che non arriva, e lui puo' rientrare col
   * codice quando vuole.
   */
  socket.on('leave_table', (payload, cb) => {
    roomManager.detachSocket(socket.id).forEach(broadcastState);
    socket.leave(socket.data.roomCode);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    cb?.({});
  });

  socket.on('disconnect', () => {
    // Il giocatore resta al tavolo con le sue proprietà: viene solo segnato
    // come disconnesso, così l'altro lo vede e lui può rientrare.
    roomManager.detachSocket(socket.id).forEach(broadcastState);
  });
});

// Le stanze ripristinate da un salvataggio (persistenza attiva, vedi
// persistence.js) possono avere un bot con una mossa in attesa: senza questo
// aggancio resterebbero ferme finché non arriva un evento qualsiasi a far
// ripartire lo scheduling. Nessun socket è ancora connesso a questo punto,
// quindi tutte le stanze in roomManager sono esattamente quelle ripristinate
// (se la persistenza è spenta, l'elenco è semplicemente vuoto).
roomManager.roomCodes().forEach(scheduleBotMove);

roomManager.startSweeping();

/**
 * Uno spegnimento pulito (SIGTERM: un nuovo deploy, `docker stop`, o SIGINT
 * da Ctrl+C in locale) forza subito la scrittura su disco invece di aspettare
 * il debounce, così non si perdono le ultime mosse fatte prima di spegnere.
 * Un `kill -9` non passa da qui: in quel caso si perde al più la finestra di
 * debounce, per la scelta di design spiegata in persistence.js.
 */
function shutdown() {
  persistence.flushNow();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`Monopoly server listening on port ${PORT}`);
});
