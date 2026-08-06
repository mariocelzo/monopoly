import { io, Socket } from 'socket.io-client';
import { segnalaEsito } from './azioni';
import { azzeraAzioniInVolo, chiaveAzione, segnaArrivo, segnaPartenza, TETTO_ATTESA_MS } from './azioniInVolo';
import { segnalaCollegato, segnalaTentativoDiCollegamento } from './statoCollegamento';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket: Socket = io(SERVER_URL, { autoConnect: false });

// I due registri che raccontano l'attesa all'interfaccia si nutrono qui, in un
// posto solo, e non nei componenti: chi disegna un bottone non deve sapere
// niente né del socket né di quando si riconnette.
socket.on('connect', () => {
  segnalaCollegato();
  // Dopo una riconnessione, qualunque azione fosse ancora "in volo" ha già
  // avuto il suo destino: o è arrivata al server prima della caduta, o è
  // ripartita adesso dalla coda di socket.io. In entrambi i casi lo stato che
  // conta è quello che sta per arrivare, e tenere i comandi spenti aspettando
  // un ack che non tornerà lascerebbe l'interfaccia bloccata fino allo scadere
  // del tetto d'attesa, proprio nel momento in cui si è appena tornati online.
  azzeraAzioniInVolo();
});
// socket.io ritenta da sé dopo una caduta: il cronometro del risveglio riparte
// da qui, così una serata che riprende dopo che il servizio si è addormentato
// racconta la stessa cosa di una pagina appena aperta.
socket.on('disconnect', segnalaTentativoDiCollegamento);

/**
 * Apre il collegamento segnando l'istante in cui il tentativo comincia.
 *
 * Da usare al posto di `socket.connect()`: senza quell'istante non si può
 * distinguere "mi sto collegando" (un attimo) da "il servizio dormiva e sta
 * ripartendo" (22,9 secondi misurati), che è l'unica cosa che chi guarda una
 * pagina ferma ha davvero bisogno di sapere. Vedi statoCollegamento.ts.
 */
export function collegaSocket(): void {
  if (socket.connected) return;
  segnalaTentativoDiCollegamento();
  socket.connect();
}

/**
 * L'unico modo di mandare un'azione di gioco al server.
 *
 * Ogni handler del motore risponde con un ack: `{}` se l'azione è passata,
 * `{ error: "..." }` con un messaggio già scritto in italiano se l'ha
 * rifiutata. Un `socket.emit` nudo quella risposta la butta via, e quello che
 * resta all'utente è un bottone che non fa niente: è così che il rilancio
 * d'asta sotto il minimo è passato inosservato per settimane (vedi
 * AuctionModal.tsx). Passando di qui il rifiuto finisce sempre in un posto solo
 * (azioni.ts) e da lì sullo schermo.
 *
 * Ed è anche il solo punto che sa quando un'azione è PARTITA e quando è
 * tornata: fra i due momenti passano circa 250ms di rete anche a server caldo, e
 * prima in quel quarto di secondo non cambiava niente sullo schermo. Il
 * registro delle azioni in volo (azioniInVolo.ts) si segna qui, così ogni
 * comando può spegnersi nell'istante del tocco senza che nessun componente
 * debba tenersi il proprio "sto aspettando".
 *
 * Restano fuori di proposito le quattro azioni che hanno una loro logica sulla
 * risposta e non sono mosse di gioco: create_room e join_room (che oltre
 * all'errore leggono i pedoni già presi, vedi Lobby.tsx), rejoin_room (che
 * sulla risposta decide se ricominciare dalla lobby, vedi App.tsx) e
 * leave_table (che aspetta la conferma prima di uscire dalla schermata).
 *
 * `alSuccesso` serve a chi deve fare qualcosa SOLO se l'azione è passata
 * davvero — per esempio chiudere il compositore di scambio: chiuderlo comunque
 * butterebbe via un'offerta che il server non ha accettato.
 */
export function inviaAzione(
  evento: string,
  payload: unknown = {},
  opzioni?: { alSuccesso?: () => void }
): void {
  const chiave = chiaveAzione(evento, payload);
  segnaPartenza(chiave);
  // `timeout` non è un capriccio: senza, un ack che non arriva mai (rete caduta
  // fra l'invio e la risposta, server riavviato nel frattempo) lascerebbe la
  // callback appesa per sempre nella tabella di socket.io e il comando spento
  // per il resto della serata. Con il tetto, socket.io richiama la callback con
  // `scaduto` valorizzato e il comando torna disponibile.
  socket.timeout(TETTO_ATTESA_MS).emit(evento, payload, (scaduto: unknown, res?: { error?: string }) => {
    segnaArrivo(chiave);
    // Un ack che non arriva (server spento, rete caduta) semplicemente non fa
    // scattare nulla: se ne accorge la barra rossa della connessione persa,
    // non serve un secondo avviso che dica la stessa cosa. Vale anche per lo
    // scadere del tetto, che è lo stesso silenzio visto da vicino: quello che
    // NON si deve fare è trattarlo come un rifiuto del motore, perché l'azione
    // può benissimo essere passata e sarebbe un allarme falso.
    if (scaduto) return;
    const rifiutata = segnalaEsito(evento, res?.error);
    if (!rifiutata) opzioni?.alSuccesso?.();
  });
}

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
  /**
   * Patrimonio pieno calcolato dal server (vedi netWorth in gameEngine.js):
   * contanti più proprietà ed edifici a valore intero, non di liquidazione.
   * Diverso da `balance`, che resta solo i contanti: serve a capire chi è
   * avanti in partita, non chi può permettersi di pagare adesso.
   */
  netWorth: number;
}

export interface Ownership {
  ownerId: string;
  houses: number;
  /**
   * Livelli di hotel costruiti: 0 = nessuno, fino a 4 con la modalità
   * grattacieli accesa (vedi HouseRules.skyscraperEnabled), altrimenti al più
   * 1. Non più un booleano: con più di un livello possibile serve sapere
   * quanti, non solo se c'è. Per invariante, quando questo è maggiore di zero
   * `houses` resta sempre 0 (l'hotel "occupa" il posto delle quattro case).
   */
  hotels: number;
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
 * Proposta di scambio aperta fra due giocatori.
 *
 * NON è più un `PendingAction`, ed è la differenza che conta: quello slot
 * significa "il tavolo è fermo perché si aspetta una decisione", e una
 * trattativa fra due non lo è. Le proposte arrivano in `GameState.tradeOffers`,
 * possono essere più d'una insieme, e mentre sono aperte tutti gli altri
 * continuano a giocare — era la segnalazione di chi ci gioca: «se qualcuno fa
 * uno scambio devo aspettare anche io».
 *
 * `id` non è decorativo: verso lo stesso giocatore possono esserci più proposte
 * aperte, quindi rispondere vuole l'indirizzo di quella precisa (vedi
 * respondTrade in gameEngine.js). Un "accetta" senza id prenderebbe quella
 * sbagliata al primo doppio tocco.
 */
export interface TradeOffer {
  id: string;
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
  /**
   * Rilancio minimo ammesso adesso, calcolato dal motore. Va USATO COSÌ COM'È,
   * mai ricalcolato qui: il minimo non è un valore fisso ma cresce col listino
   * della casella (vedi auctionMinIncrement in gameEngine.js), quindi qualunque
   * formula scritta nel client si stacca da quella vera appena l'altra cambia.
   * È già successo due volte: prima nei bot, che si bloccavano offrendo sempre
   * 10 su caselle che ne chiedevano di più, e poi qui nel client, dove il
   * bottone "Rilancia" mandava un'offerta sotto il minimo su 24 caselle su 28 e
   * il motore la rifiutava in silenzio.
   */
  minBid: number;
  /** Scatto minimo fra un'offerta e la successiva, sempre dal motore. */
  minIncrement: number;
}

/**
 * Le finestre che fermano il tavolo, e soltanto quelle. Gli scambi ne sono
 * usciti di proposito (vedi TradeOffer): finché ci stavano dentro, una proposta
 * fra due persone bloccava il turno, le costruzioni e le ipoteche di tutti.
 */
export type PendingAction =
  | AwaitingBuy
  | AwaitingCard
  | AwaitingRent
  | AwaitingTax
  | AwaitingDebt
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
  /**
   * Fino a quattro hotel per proprietà, a prezzi e affitti crescenti, invece
   * di uno solo. Spenta di default: senza toccarla il gioco resta quello di
   * sempre (vedi gameEngine.js, buildHouse).
   */
  skyscraperEnabled: boolean;
}

/**
 * La partita è ferma perché chi ha il turno è disconnesso. Non arriva da
 * `serialize()` del motore ma dalla stanza (vedi blockedTurn in rooms.js): il
 * motore è puro e non guarda l'orologio.
 *
 * `attesaRimanenteMs` è una DURATA, non un istante: gli orologi di due
 * dispositivi non coincidono, quindi il conto alla rovescia si fa da quando
 * questo stato arriva, non confrontando timestamp del server con quelli locali.
 */
export interface BlockedTurn {
  /** Chi tiene fermo il tavolo: è sempre il giocatore di turno. */
  playerId: string;
  /** Quanto manca prima che gli altri possano saltargli il turno. 0 = si può già. */
  attesaRimanenteMs: number;
}

export interface GameState {
  roomCode: string;
  players: Player[];
  ownership: Record<number, Ownership>;
  turnIndex: number;
  started: boolean;
  log: { message: string; at: number }[];
  pendingAction: PendingAction | null;
  /**
   * Le proposte di scambio aperte al tavolo, tutte, non solo le proprie: il
   * server trasmette lo stesso stato a tutti e non c'è niente di segreto in una
   * proposta (al tavolo vero si tratta ad alta voce). Chi disegna filtra per
   * `toId` (ho una risposta da dare) o `fromId` (sto aspettando una risposta).
   * Facoltativo nel tipo perché uno stato ricostruito a mano nei test della
   * logica pura non deve essere obbligato a dichiararlo.
   */
  tradeOffers?: TradeOffer[];
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
  /**
   * La multa per uscire di prigione. Non è una regola della casa — non si
   * sceglie — ma il client la scrive su un bottone, e prima ce l'aveva a mano:
   * cambiandola nel motore, quel bottone avrebbe promesso un importo diverso da
   * quello addebitato. Arriva dal server come tutti gli altri importi.
   */
  jailFine: number;
  /**
   * Presente solo mentre la partita è ferma sul turno di un disconnesso, e
   * `null` in tutti gli altri casi. Facoltativo nel tipo perché uno stato
   * ricostruito a mano (i test della logica pura) non deve essere obbligato a
   * dichiararlo per dire "non c'è nulla di bloccato".
   */
  turnoBloccato?: BlockedTurn | null;
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
  // Importi calcolati dal motore e pubblicati con il tabellone (vedi
  // boardWithAmounts in gameEngine.js): il client li mostra e basta, non li
  // ricalcola. Gli array sono indicizzati per numero di unità meno uno —
  // buildCosts[0] è la prima casa, buildCosts[4] il primo hotel,
  // hotelRents[0] l'affitto con un hotel. Facoltativi perché non ogni casella
  // ha un prezzo (il Via, la Sosta) o si può edificare (stazioni, società).
  mortgageValue?: number;
  unmortgageCost?: number;
  buildCosts?: number[];
  buildRefunds?: number[];
  hotelRents?: number[];
}
