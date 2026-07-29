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
  /** Vero per i giocatori artificiali gestiti dal server. */
  isBot: boolean;
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

/**
 * Affitto dovuto per essere atterrati su una proprietà altrui. Va confermato:
 * prima il denaro passava di mano in silenzio.
 */
export interface AwaitingRent {
  type: 'awaiting_rent';
  playerId: string;
  position: number;
  amount: number;
  ownerId: string;
  /** Vero se una carta ha raddoppiato l'affitto. */
  doubled: boolean;
}

/** Tassa dovuta per essere atterrati su una casella tassa. */
export interface AwaitingTax {
  type: 'awaiting_tax';
  playerId: string;
  position: number;
  amount: number;
}

/**
 * Asta sulla proprietà appena rifiutata. `playerId` è chi deve rilanciare o
 * passare adesso: cambia a ogni mossa, girando in ordine di tavolo a partire
 * da chi ha rinunciato. `queue` sono gli ancora in gara (in ordine di turno,
 * chi ha appena rilanciato è in fondo), `passedIds` chi è già uscito.
 */
export interface AwaitingAuction {
  type: 'awaiting_auction';
  playerId: string;
  position: number;
  /** Prezzo di listino, solo per mostrarlo: l'asta può chiudersi molto sotto. */
  price: number;
  currentBid: number;
  currentBidderId: string | null;
  queue: string[];
  passedIds: string[];
}

export type PendingAction =
  | AwaitingBuy
  | AwaitingCard
  | AwaitingRent
  | AwaitingTax
  | AwaitingDebt
  | AwaitingTrade
  | AwaitingAuction;

/**
 * Statistiche accumulate dal motore durante la partita, contatore per
 * contatore mano a mano che le cose succedono — non ricostruite dal
 * registro, che è tappato alle ultime righe e su una partita lunga non
 * basterebbe. Servono solo per il riepilogo di fine partita (vedi
 * GameSummary.tsx). Le mappe sono playerId -> numero, tranne `landings` che
 * è posizione -> numero; un giocatore/casella assente vale 0.
 */
export interface GameStats {
  startedAt: number | null;
  finishedAt: number | null;
  rentPaid: Record<string, number>;
  rentCollected: Record<string, number>;
  bankPaid: Record<string, number>;
  purchases: Record<string, number>;
  housesBuilt: Record<string, number>;
  landings: Record<number, number>;
  laps: Record<string, number>;
  tradesCompleted: number;
}

/**
 * Regole della casa scelte per questo tavolo, prima del via (vedi HouseRules.tsx).
 * Le opzioni ammesse per `goAmount` e `startingBalance` devono restare
 * allineate a GO_AMOUNT_OPTIONS / STARTING_BALANCE_OPTIONS in
 * server/src/gameEngine.js: è il server a validarle davvero, questi tipi
 * servono solo a guidare l'interfaccia.
 */
export interface HouseRules {
  /** Quanto si incassa passando dal Via: 200 (regolamento) o 500 (default). */
  goAmount: 200 | 500;
  /** Tasse e multe verso la banca si accumulano e le incassa chi atterra sulla Sosta Gratuita. */
  freeParkingEnabled: boolean;
  /** La proprietà rifiutata va all'asta invece di restare semplicemente libera. */
  auctionEnabled: boolean;
  /** Saldo di partenza di ogni giocatore. */
  startingBalance: 1000 | 1500 | 2000;
}

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
  /** Come è finita: per bancarotta, per abbandono o per chiusura del tavolo. */
  endedReason: 'bankruptcy' | 'abandoned' | 'closed' | null;
  /** Chi ha creato il tavolo: solo lui può chiuderlo per entrambi. */
  hostId: string | null;
  /** Chi ha già chiesto la rivincita: serve il consenso di entrambi. */
  rematchVotes: string[];
  /** Ultimo tiro, mostrato al centro del tabellone. `seq` distingue tiri uguali. */
  lastRoll: { playerId: string; dice: [number, number]; seq: number } | null;
  /** Statistiche per il riepilogo di fine partita. */
  stats: GameStats;
  /** Regole della casa di questo tavolo: sola lettura per chi non è l'host. */
  rules: HouseRules;
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
