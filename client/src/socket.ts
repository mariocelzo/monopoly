import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket: Socket = io(SERVER_URL, { autoConnect: false });

export interface Player {
  id: string;
  name: string;
  token: string;
  balance: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: number;
  bankrupt: boolean;
  /** Doppi consecutivi nel turno corrente: al terzo si va in prigione. */
  doublesInARow: number;
  /** Falso mentre il giocatore è offline: resta al tavolo e può rientrare. */
  connected: boolean;
}

export interface Ownership {
  ownerId: string;
  houses: number;
  hotel: boolean;
  mortgaged: boolean;
}

/** Proposta d'acquisto per la casella su cui il giocatore si è appena fermato. */
export interface AwaitingBuy {
  type: 'awaiting_buy';
  playerId: string;
  position: number;
  price: number;
}

/**
 * Debito scoperto: il giocatore deve rientrare vendendo o ipotecando, oppure
 * arrendersi. Blocca la partita per entrambi finché non è risolto.
 */
export interface AwaitingDebt {
  type: 'awaiting_debt';
  playerId: string;
  amount: number;
  creditorId: string | null;
  /** Quanto varrebbe il debitore liquidando tutto: calcolato dal server. */
  liquidationValue: number;
}

/**
 * Proposta di scambio in attesa di risposta. `playerId` è il destinatario, cioè
 * chi deve accettare o rifiutare. Congela la partita per entrambi.
 */
export interface AwaitingTrade {
  type: 'awaiting_trade';
  playerId: string;
  fromId: string;
  toId: string;
  offerProperties: number[];
  offerMoney: number;
  offerJailCards: number;
  requestProperties: number[];
  requestMoney: number;
  requestJailCards: number;
}

/**
 * Carta pescata e non ancora letta. L'effetto scatta solo alla conferma: prima
 * si applicava subito e la pedina sembrava muoversi da sola.
 */
export interface AwaitingCard {
  type: 'awaiting_card';
  playerId: string;
  deck: 'chance' | 'community';
  text: string;
}

export type PendingAction = AwaitingBuy | AwaitingCard | AwaitingDebt | AwaitingTrade;

export interface GameState {
  roomCode: string;
  players: Player[];
  ownership: Record<number, Ownership>;
  turnIndex: number;
  started: boolean;
  log: { message: string; at: number }[];
  pendingAction: PendingAction | null;
  finished: boolean;
  winnerId: string | null;
  /** Ultimo tiro, mostrato al centro del tabellone. `seq` distingue tiri uguali. */
  lastRoll: { playerId: string; dice: [number, number]; seq: number } | null;
}

export interface BoardSquare {
  position: number;
  type: string;
  name: string;
  group?: string;
  price?: number;
  houseCost?: number;
  rents?: number[];
  amount?: number;
}
