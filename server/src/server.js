const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { board } = require('./data/board');
const { botMove, botHasMove } = require('./bot');

const PORT = process.env.PORT || 3001;

// Nomi e pedoni per i bot, assegnati in ordine.
const BOT_NAMES = ['Bot Aurelio', 'Bot Cleopatra', 'Bot Fulvio', 'Bot Ottavia', 'Bot Silvio'];
const BOT_TOKENS = ['🐕', '🎩', '🚗', '🚢', '🐈', '🎸'];

// Pausa fra una mossa del bot e la successiva. Un secondo fisso era troppo
// svelto per seguire cosa stesse succedendo, e soprattutto si sentiva il
// metronomo: una persona non risponde mai due volte alla stessa distanza.
// L'intervallo casuale toglie quella cadenza meccanica.
const BOT_PAUSA_MIN_MS = 1700;
const BOT_PAUSA_MAX_MS = 3000;

const pausaBot = () =>
  BOT_PAUSA_MIN_MS + Math.floor(Math.random() * (BOT_PAUSA_MAX_MS - BOT_PAUSA_MIN_MS));

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
  scheduleBotMove(roomCode);
}

/**
 * Se un bot ha una mossa da fare, la schedula. Una sola alla volta per stanza:
 * finché un timer è in coda non se ne aggiunge un altro, così più broadcast
 * ravvicinati non generano mosse sovrapposte.
 */
function scheduleBotMove(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room || room.botTimer) return;
  if (!botHasMove(room.game)) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    // La stanza può essere sparita nel frattempo (tavolo chiuso, scaduta).
    const ancora = roomManager.getRoom(roomCode);
    if (!ancora) return;
    if (botMove(ancora.game)) broadcastState(roomCode);
  }, pausaBot());
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

roomManager.startSweeping();

server.listen(PORT, () => {
  console.log(`Monopoly server listening on port ${PORT}`);
});
