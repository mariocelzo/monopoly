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

  socket.on('create_room', ({ name, token }, cb) => {
    const code = roomManager.createRoom();
    const room = roomManager.getRoom(code);
    const playerId = socket.id;
    const added = room.game.addPlayer(playerId, name, token);
    if (added?.error) return cb?.(added);
    room.sockets.set(socket.id, playerId);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    cb?.({ roomCode: code, playerId });
    broadcastState(code);
  });

  socket.on('join_room', ({ roomCode, name, token }, cb) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (room.game.started) return cb?.({ error: 'Partita già iniziata' });
    const playerId = socket.id;
    // Il pedone può essere già preso: l'errore riporta quali sono occupati, così
    // la lobby li disabilita invece di far tirare a indovinare.
    const added = room.game.addPlayer(playerId, name, token);
    if (added?.error) return cb?.(added);
    room.sockets.set(socket.id, playerId);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;
    cb?.({ roomCode, playerId });
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
    roomManager.removeSocket(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Monopoly server listening on port ${PORT}`);
});
