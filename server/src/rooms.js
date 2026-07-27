const { GameEngine } = require('./gameEngine');

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> { game: GameEngine, sockets: Map<socketId, playerId> }
  }

  createRoom() {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));
    const game = new GameEngine(code);
    this.rooms.set(code, { game, sockets: new Map() });
    return code;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  removeSocket(socketId) {
    for (const room of this.rooms.values()) {
      room.sockets.delete(socketId);
    }
  }
}

module.exports = { RoomManager };
