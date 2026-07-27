const { GameEngine } = require('./gameEngine');

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
    // code -> { game, sockets: Map<socketId, playerId>, emptySince: number | null }
    this.rooms = new Map();
  }

  createRoom() {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));
    const game = new GameEngine(code);
    this.rooms.set(code, { game, sockets: new Map(), emptySince: null });
    return code;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  /**
   * Associa un socket a un giocatore. Se quel giocatore era già collegato da
   * un altro socket (una seconda scheda, o una connessione rimasta appesa) il
   * vecchio aggancio viene sostituito: l'identità è una sola.
   */
  attachSocket(code, socketId, playerId) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const [existingSocket, existingPlayer] of room.sockets) {
      if (existingPlayer === playerId && existingSocket !== socketId) {
        room.sockets.delete(existingSocket);
      }
    }
    room.sockets.set(socketId, playerId);
    room.emptySince = null;
    room.game.setConnected(playerId, true);
  }

  /**
   * Stacca un socket caduto. Il giocatore resta al tavolo con le sue proprietà:
   * viene solo segnato come disconnesso, così può rientrare con lo stesso id.
   * Restituisce le stanze toccate, per aggiornare chi è rimasto.
   */
  detachSocket(socketId) {
    const touched = [];
    for (const [code, room] of this.rooms) {
      const playerId = room.sockets.get(socketId);
      if (playerId === undefined) continue;
      room.sockets.delete(socketId);
      // Solo se non è rimasto nessun altro socket per lo stesso giocatore.
      if (![...room.sockets.values()].includes(playerId)) {
        room.game.setConnected(playerId, false);
      }
      if (room.sockets.size === 0) room.emptySince = Date.now();
      touched.push(code);
    }
    return touched;
  }

  /** Butta via le stanze vuote da troppo tempo, per non accumularle in memoria. */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > ROOM_TTL_MS) {
        this.rooms.delete(code);
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
