const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { board } = require('./data/board');

const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' },
});

const roomManager = new RoomManager();

// Le rotte HTTP hanno bisogno degli stessi header CORS di Socket.io: senza,
// il client servito da Vite su un'altra porta non riesce a scaricare /board.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/board', (req, res) => res.json(board));

function broadcastState(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit('state', room.game.serialize());
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
  socket.on('pay_jail_fine', withGame((game, playerId) => game.payJailFine(playerId)));
  socket.on('use_jail_card', withGame((game, playerId) => game.useJailCard(playerId)));
  socket.on('build_house', withGame((game, playerId, { position }) => game.buildHouse(playerId, position)));
  socket.on('sell_house', withGame((game, playerId, { position }) => game.sellHouse(playerId, position)));
  socket.on('mortgage_property', withGame((game, playerId, { position }) => game.mortgageProperty(playerId, position)));
  socket.on('unmortgage_property', withGame((game, playerId, { position }) => game.unmortgageProperty(playerId, position)));
  // Risoluzione di un debito: liquidazione automatica oppure resa.
  socket.on('resolve_debt_auto', withGame((game, playerId) => game.resolveDebtAuto(playerId)));
  socket.on('declare_bankruptcy', withGame((game, playerId) => game.declareBankruptcy(playerId)));
  // Scambi fra giocatori: proposta e risposta.
  socket.on('propose_trade', withGame((game, playerId, payload) => game.proposeTrade(playerId, payload)));
  socket.on('respond_trade', withGame((game, playerId, { accept }) => game.respondTrade(playerId, !!accept)));
  socket.on('end_turn', withGame((game, playerId) => {
    if (game.currentPlayer?.id !== playerId) return { error: 'Non è il tuo turno' };
    return game.endTurn();
  }));

  socket.on('chat_message', ({ text }) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return;
    const player = room.game.players.find((p) => p.id === socket.data.playerId);
    io.to(socket.data.roomCode).emit('chat_message', { from: player?.name || '???', text, at: Date.now() });
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
