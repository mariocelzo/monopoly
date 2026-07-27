const {
  board,
  GO_AMOUNT,
  STATION_RENT,
  UTILITY_MULTIPLIER,
  CHANCE_CARDS,
  COMMUNITY_CARDS,
} = require('./data/board');

const STARTING_BALANCE = 1500;
const JAIL_POSITION = 10;
const GO_TO_JAIL_POSITION = 30;
const JAIL_FINE = 50;
const MAX_JAIL_TURNS = 3;
// Al terzo doppio consecutivo si va in prigione senza muoversi.
const MAX_DOUBLES = 3;
// Interesse del 10% che la banca trattiene sulle ipoteche: si paga per
// riscattare una proprietà e per riceverne una già ipotecata, sia in uno
// scambio sia in una bancarotta. È espresso come frazione intera perché con i
// decimali `100 * 1.1` vale 110.00000000000001 e Math.ceil arrotonda a 111.
const MORTGAGE_INTEREST_NUM = 1;
const MORTGAGE_INTEREST_DEN = 10;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameEngine {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = []; // { id, name, token, balance, position, inJail, jailTurns, jailCards, bankrupt }
    this.ownership = {}; // position -> { ownerId, houses, hotel, mortgaged }
    this.turnIndex = 0;
    this.started = false;
    this.log = [];
    this.chanceDeck = shuffle(CHANCE_CARDS);
    this.communityDeck = shuffle(COMMUNITY_CARDS);
    // { type: 'awaiting_buy' | 'awaiting_card' | 'awaiting_debt' | 'awaiting_trade',
    //   playerId, ... }
    // Blocca il flusso del turno finché il giocatore indicato da playerId non
    // risolve: compra o rinuncia, legge la carta, salda il debito, risponde
    // allo scambio.
    this.pendingAction = null;
    this.finished = false;
    this.winnerId = null;
    // Come è finita: bancarotta, abbandono o chiusura da parte di chi ha
    // creato il tavolo. Serve al client per dire la cosa giusta.
    this.endedReason = null;
    // Il creatore del tavolo, cioè il primo che si siede.
    this.hostId = null;
    // Alzata mentre resolveDebtAuto sta liquidando in serie: evita che ogni
    // singola vendita chiuda il debito e faccia girare il turno a metà loop.
    this.liquidating = false;
    // Garantisce che il turno venga chiuso una volta sola per tiro di dadi.
    this.turnResolved = false;
    // Se l'ultimo tiro era un doppio il giocatore ha diritto a rigiocare, anche
    // se nel frattempo ha dovuto comprare o saldare un debito.
    this.lastRollWasDouble = false;
    // Carta pescata e non ancora letta: l'effetto scatta alla conferma.
    this.pendingCard = null;
    // Moltiplicatore d'affitto per il prossimo atterraggio (carte "paga il
    // doppio"). Torna a 1 subito dopo.
    this.rentMultiplier = 1;
    // Ultimo tiro mostrato al centro del tabellone. `seq` cresce a ogni lancio
    // così il client riconosce un tiro nuovo anche se i dadi ripetono i valori.
    this.lastRoll = null;
  }

  /**
   * Chiude un tiro di dadi: chi ha fatto doppio gioca ancora, gli altri passano
   * la mano. Chi è finito in prigione o in bancarotta passa comunque, anche col
   * doppio. Va chiamata da ogni punto in cui la risoluzione del tiro si
   * completa: subito dopo il movimento, ma anche dopo un acquisto o un debito
   * che avevano messo il turno in pausa.
   */
  finishRoll(player) {
    if (this.finished) return;
    if (this.lastRollWasDouble && player && !player.inJail && !player.bankrupt) {
      this.addLog(`${player.name} ha fatto doppio: gioca ancora.`);
      return;
    }
    this.endTurn();
  }

  addLog(message) {
    this.log.push({ message, at: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  /** Pedoni già assegnati: servono al client per disabilitarli nella lobby. */
  takenTokens() {
    return this.players.map((p) => p.token);
  }

  hasPlayer(playerId) {
    return this.players.some((p) => p.id === playerId);
  }

  /** Segna un giocatore come connesso o meno, senza toccarne lo stato di gioco. */
  setConnected(playerId, connected) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this.addLog(connected ? `${player.name} è tornato.` : `${player.name} si è disconnesso.`);
  }

  addPlayer(id, name, token) {
    if (this.players.find((p) => p.id === id)) return { error: 'Sei già al tavolo' };
    if (this.players.some((p) => p.token === token)) {
      return { error: 'Pedone già scelto dall\'altro giocatore', takenTokens: this.takenTokens() };
    }
    if (this.players.length === 0) this.hostId = id;
    this.players.push({
      id, name, token,
      balance: STARTING_BALANCE,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
      doublesInARow: 0,
      // Un giocatore disconnesso resta al tavolo con le sue proprietà: può
      // rientrare con lo stesso id. Serve solo a segnalarlo nell'interfaccia.
      connected: true,
    });
    this.addLog(`${name} si è unito alla partita.`);
    return {};
  }

  start() {
    if (this.players.length < 1) return;
    this.started = true;
    this.turnIndex = 0;
    this.addLog('La partita è iniziata!');
  }

  get currentPlayer() {
    return this.players[this.turnIndex];
  }

  serialize() {
    // Il valore di liquidazione cambia a ogni vendita, quindi si ricalcola qui
    // invece di duplicare la regola nel client.
    let pendingAction = this.pendingAction;
    if (pendingAction?.type === 'awaiting_debt') {
      const debtor = this.players.find((p) => p.id === pendingAction.playerId);
      pendingAction = { ...pendingAction, liquidationValue: debtor ? this.liquidationValue(debtor) : 0 };
    }
    return {
      roomCode: this.roomCode,
      players: this.players,
      ownership: this.ownership,
      turnIndex: this.turnIndex,
      started: this.started,
      log: this.log.slice(-30),
      pendingAction,
      finished: this.finished,
      winnerId: this.winnerId,
      endedReason: this.endedReason,
      hostId: this.hostId,
      lastRoll: this.lastRoll,
    };
  }

  // ---- Proprietà e patrimonio ----

  /** Tutte le caselle possedute da un giocatore, con casella e stato di possesso. */
  propertiesOf(playerId) {
    return Object.entries(this.ownership)
      .filter(([, owned]) => owned.ownerId === playerId)
      .map(([position, owned]) => ({ position: Number(position), square: board[Number(position)], owned }));
  }

  /**
   * Edifici presenti su una casella espressi in "unità casa". L'hotel vale 5
   * perché costa una casa in più rispetto alle quattro che sostituisce: così il
   * confronto per la regola dell'edificazione uniforme è un semplice numero.
   */
  unitCount(owned) {
    return owned.hotel ? 5 : owned.houses;
  }

  /** Quanto ricava il giocatore vendendo un edificio: metà del costo di costruzione. */
  buildingRefund(square) {
    return Math.floor(square.houseCost / 2);
  }

  /** Valore d'ipoteca di una proprietà: metà del prezzo d'acquisto. */
  mortgageValue(square) {
    return Math.floor(square.price / 2);
  }

  /** Interesse del 10% dovuto alla banca su una proprietà ipotecata. */
  mortgageInterest(square) {
    return Math.ceil((this.mortgageValue(square) * MORTGAGE_INTEREST_NUM) / MORTGAGE_INTEREST_DEN);
  }

  /** Costo per riscattare un'ipoteca: il valore più il 10% di interesse. */
  unmortgageCost(square) {
    return this.mortgageValue(square) + this.mortgageInterest(square);
  }

  /**
   * Quanto avrebbe il giocatore se liquidasse tutto: contanti, più il rimborso di
   * ogni edificio, più l'ipoteca su ogni proprietà non ancora ipotecata.
   * Se questo valore è negativo il debito è impossibile da coprire.
   */
  liquidationValue(player) {
    return this.propertiesOf(player.id).reduce((total, { square, owned }) => {
      // Stazioni e società non hanno houseCost: contano solo per l'ipoteca.
      const units = this.unitCount(owned);
      let extra = units > 0 ? units * this.buildingRefund(square) : 0;
      if (!owned.mortgaged) extra += this.mortgageValue(square);
      return total + extra;
    }, player.balance);
  }

  hasPendingDebt() {
    return this.pendingAction?.type === 'awaiting_debt';
  }

  hasPendingTrade() {
    return this.pendingAction?.type === 'awaiting_trade';
  }

  hasPendingCard() {
    return this.pendingAction?.type === 'awaiting_card';
  }

  /**
   * Con uno scambio in sospeso le proprietà si congelano: non ha senso poter
   * cambiare la merce dopo aver fatto l'offerta.
   */
  tradeFreezeBlocker() {
    return this.hasPendingTrade() ? { error: 'Prima rispondi allo scambio proposto' } : null;
  }

  // ---- Turn flow ----

  rollDice(playerId) {
    const player = this.currentPlayer;
    if (this.finished) return { error: 'La partita è finita' };
    if (!player || player.id !== playerId || player.bankrupt) return { error: 'Non è il tuo turno' };
    if (this.pendingAction) return { error: 'Azione in sospeso da risolvere prima' };

    this.turnResolved = false;
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const isDouble = d1 === d2;
    // Uscire di prigione col doppio non dà il tiro extra: si esce e basta.
    this.lastRollWasDouble = isDouble && !player.inJail;
    this.lastRoll = {
      playerId: player.id,
      dice: [d1, d2],
      seq: (this.lastRoll?.seq || 0) + 1,
    };

    if (player.inJail) {
      if (isDouble) {
        player.inJail = false;
        player.jailTurns = 0;
        this.addLog(`${player.name} fa doppio (${d1},${d2}) ed esce di prigione!`);
        this.movePlayer(player, d1 + d2);
      } else {
        player.jailTurns += 1;
        this.addLog(`${player.name} resta in prigione (tentativo ${player.jailTurns}/${MAX_JAIL_TURNS}).`);
        if (player.jailTurns >= MAX_JAIL_TURNS) {
          player.inJail = false;
          player.jailTurns = 0;
          this.addLog(`${player.name} paga ${JAIL_FINE} per uscire dopo 3 tentativi.`);
          this.chargePlayer(player, JAIL_FINE);
          // Se la multa lo ha mandato in bancarotta non c'è più nessuno da
          // muovere; se ha aperto un debito si salda quello e il turno finisce,
          // altrimenti l'atterraggio sovrascriverebbe il debito in sospeso.
          if (!player.bankrupt && !this.hasPendingDebt()) this.movePlayer(player, d1 + d2);
        } else {
          this.endTurn();
        }
      }
      return { dice: [d1, d2] };
    }

    // Tre doppi di fila mandano in prigione, e si va senza muoversi: il
    // controllo va fatto prima di spostare la pedina.
    if (isDouble) {
      player.doublesInARow += 1;
      if (player.doublesInARow >= MAX_DOUBLES) {
        player.doublesInARow = 0;
        this.addLog(`${player.name} fa il terzo doppio di fila (${d1},${d2}).`);
        this.sendToJail(player);
        this.endTurn();
        return { dice: [d1, d2] };
      }
    } else {
      player.doublesInARow = 0;
    }

    this.movePlayer(player, d1 + d2);

    // Con un'azione in sospeso il tiro non è ancora finito: lo chiuderà chi
    // risolve l'acquisto o il debito.
    if (!this.pendingAction) this.finishRoll(player);

    return { dice: [d1, d2] };
  }

  movePlayer(player, spaces) {
    const prev = player.position;
    let next = (prev + spaces) % 40;
    if (next < prev) {
      player.balance += GO_AMOUNT;
      this.addLog(`${player.name} passa dal Via e incassa ${GO_AMOUNT}.`);
    }
    player.position = next;
    this.resolveLanding(player);
  }

  /**
   * Porta la pedina su una casella precisa muovendosi **in avanti**, girando dal
   * Via se necessario. Le carte "avanza fino a" non teletrasportano indietro: se
   * la meta è alle spalle si fa il giro, incassando il Via come qualunque
   * passaggio. L'unico movimento a ritroso del gioco è la carta "vai indietro".
   */
  movePlayerTo(player, target) {
    const spaces = (target - player.position + 40) % 40;
    if (spaces === 0) {
      this.resolveLanding(player);
      return;
    }
    this.movePlayer(player, spaces);
  }

  resolveLanding(player) {
    const square = board[player.position];
    switch (square.type) {
      case 'go':
        break;
      case 'tax':
        this.addLog(`${player.name} paga ${square.amount} di ${square.name}.`);
        this.chargePlayer(player, square.amount);
        break;
      case 'go_to_jail':
        this.sendToJail(player);
        break;
      case 'jail':
      case 'free_parking':
        break;
      case 'chance':
        this.drawCard(player, 'chance');
        break;
      case 'community':
        this.drawCard(player, 'community');
        break;
      case 'property':
      case 'station':
      case 'utility':
        this.resolvePropertyLanding(player, square);
        break;
    }
  }

  resolvePropertyLanding(player, square) {
    // Con un debito o una carta già in sospeso non si apre una proposta
    // d'acquisto: sovrascriverebbe quel pendingAction e lo farebbe sparire.
    if (this.hasPendingDebt() || this.hasPendingCard()) return;
    const owned = this.ownership[square.position];
    if (!owned) {
      // offer to buy
      this.pendingAction = {
        type: 'awaiting_buy',
        playerId: player.id,
        position: square.position,
        price: square.price,
      };
      this.addLog(`${player.name} è su ${square.name} (libera, ${square.price}).`);
      return;
    }
    if (owned.ownerId === player.id || owned.mortgaged) {
      return; // your own property, or mortgaged = no rent
    }
    const rent = this.calculateRent(square, owned) * this.rentMultiplier;
    const owner = this.players.find((p) => p.id === owned.ownerId);
    if (this.rentMultiplier > 1) this.addLog(`Affitto raddoppiato dalla carta pescata.`);
    this.addLog(`${player.name} paga ${rent} di affitto a ${owner.name} per ${square.name}.`);
    this.chargePlayer(player, rent, owner);
  }

  calculateRent(square, owned) {
    if (square.type === 'station') {
      const ownerStations = board.filter(
        (s) => s.type === 'station' && this.ownership[s.position]?.ownerId === owned.ownerId
      ).length;
      return STATION_RENT[Math.min(ownerStations, 4) - 1] || STATION_RENT[0];
    }
    if (square.type === 'utility') {
      const ownerUtilities = board.filter(
        (s) => s.type === 'utility' && this.ownership[s.position]?.ownerId === owned.ownerId
      ).length;
      const roll = 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6);
      const mult = ownerUtilities >= 2 ? UTILITY_MULTIPLIER.both : UTILITY_MULTIPLIER.one;
      return roll * mult;
    }
    // regular property
    if (owned.hotel) return square.rents[5];
    if (owned.houses > 0) return square.rents[owned.houses];
    if (this.ownsFullGroup(owned.ownerId, square.group)) return square.rents[0] * 2;
    return square.rents[0];
  }

  ownsFullGroup(ownerId, group) {
    const groupSquares = board.filter((s) => s.group === group);
    return groupSquares.every((s) => this.ownership[s.position]?.ownerId === ownerId);
  }

  // ---- Player actions ----

  buyProperty(playerId) {
    if (!this.pendingAction || this.pendingAction.type !== 'awaiting_buy') return { error: 'Nessun acquisto in sospeso' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };
    const { position, price } = this.pendingAction;
    const player = this.players.find((p) => p.id === playerId);
    if (player.balance < price) return { error: 'Saldo insufficiente' };
    player.balance -= price;
    this.ownership[position] = { ownerId: playerId, houses: 0, hotel: false, mortgaged: false };
    this.addLog(`${player.name} compra ${board[position].name} per ${price}.`);
    this.pendingAction = null;
    this.finishRoll(player);
    return {};
  }

  declineBuy(playerId) {
    if (!this.pendingAction || this.pendingAction.type !== 'awaiting_buy') return { error: 'Nessun acquisto in sospeso' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };
    this.addLog(`${this.currentPlayer.name} rinuncia all'acquisto di ${board[this.pendingAction.position].name}.`);
    this.pendingAction = null;
    this.finishRoll(this.currentPlayer);
    return {};
  }

  /**
   * Pesca una carta e la mette in attesa di lettura **senza applicarla**. Prima
   * l'effetto scattava subito: il giocatore vedeva la pedina saltare o il saldo
   * cambiare senza sapere perché, e sembrava un secondo tiro impazzito.
   */
  drawCard(player, deckType) {
    const deck = deckType === 'chance' ? this.chanceDeck : this.communityDeck;
    const card = deck.shift();
    deck.push(card);
    this.addLog(`${player.name} pesca: "${card.text}"`);
    this.pendingCard = card;
    this.pendingAction = {
      type: 'awaiting_card',
      playerId: player.id,
      deck: deckType,
      text: card.text,
    };
  }

  /** Il giocatore ha letto la carta: ora l'effetto si applica. */
  acknowledgeCard(playerId) {
    if (this.pendingAction?.type !== 'awaiting_card') return { error: 'Nessuna carta da leggere' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non è la tua carta' };

    const card = this.pendingCard;
    const player = this.players.find((p) => p.id === playerId);
    this.pendingAction = null;
    this.pendingCard = null;
    if (card && player) this.applyCard(player, card);

    // La carta può aver aperto un'altra cosa da risolvere: un acquisto, un
    // debito, o perfino un'altra carta (con "vai indietro di 3" si può finire
    // su Probabilità). In quel caso il turno resta in attesa.
    if (!this.pendingAction) this.finishRoll(this.currentPlayer);
    return {};
  }

  applyCard(player, card) {
    switch (card.action) {
      case 'collect':
        player.balance += card.amount;
        break;
      case 'pay':
        this.chargePlayer(player, card.amount);
        break;
      case 'pay_each_player':
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          this.chargePlayer(player, card.amount, p);
        });
        break;
      case 'collect_from_each_player':
        // Qui il debitore può essere l'avversario, non chi sta giocando: il
        // pendingAction del debito blocca comunque la partita per entrambi.
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          this.chargePlayer(p, card.amount, player);
        });
        break;
      case 'advance_to':
        // Sempre in avanti, incassando il Via se lo si supera.
        this.movePlayerTo(player, card.target);
        break;
      case 'move_back': {
        // L'unico movimento a ritroso: non si passa dal Via, quindi non si
        // incassa, e movePlayer non va usata.
        player.position = (player.position - card.spaces + 40) % 40;
        this.addLog(`${player.name} torna indietro fino a ${board[player.position].name}.`);
        this.resolveLanding(player);
        break;
      }
      case 'advance_to_nearest_station': {
        const stations = board.filter((s) => s.type === 'station').map((s) => s.position);
        const next = stations.find((pos) => pos > player.position) ?? stations[0];
        // Alcune di queste carte fanno pagare l'affitto raddoppiato: il
        // moltiplicatore vale per il solo atterraggio che segue.
        this.rentMultiplier = card.rentMultiplier || 1;
        this.movePlayerTo(player, next);
        this.rentMultiplier = 1;
        break;
      }
      case 'get_out_of_jail':
        player.jailCards += 1;
        break;
      case 'go_to_jail':
        this.sendToJail(player);
        break;
      case 'repairs': {
        const total = this.propertiesOf(player.id).reduce(
          (sum, { owned }) => sum + owned.houses * card.perHouse + (owned.hotel ? card.perHotel : 0),
          0
        );
        if (total > 0) this.addLog(`${player.name} paga ${total} di riparazioni.`);
        this.chargePlayer(player, total);
        break;
      }
    }
  }

  sendToJail(player) {
    player.position = JAIL_POSITION;
    player.inJail = true;
    player.jailTurns = 0;
    this.addLog(`${player.name} viene mandato in prigione.`);
  }

  payJailFine(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.inJail) return { error: 'Non sei in prigione' };
    if (player.balance < JAIL_FINE) return { error: 'Saldo insufficiente' };
    player.balance -= JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.addLog(`${player.name} paga ${JAIL_FINE} per uscire di prigione.`);
    return {};
  }

  useJailCard(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.inJail) return { error: 'Non sei in prigione' };
    if (player.jailCards < 1) return { error: 'Non hai carte "esci di prigione"' };
    player.jailCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    this.addLog(`${player.name} usa una carta "esci di prigione gratis".`);
    return {};
  }

  /** Numero di unità casa presenti su ogni casella del gruppo di colore. */
  groupUnitCounts(group) {
    return board
      .filter((s) => s.group === group)
      .map((s) => (this.ownership[s.position] ? this.unitCount(this.ownership[s.position]) : 0));
  }

  buildHouse(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!square || square.type !== 'property') return { error: 'Non è una proprietà edificabile' };
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (!this.ownsFullGroup(playerId, square.group)) return { error: 'Serve il monopolio del colore per costruire' };
    // Regola ufficiale: niente costruzioni su un colore con proprietà ipotecate.
    const groupMortgaged = board.some(
      (s) => s.group === square.group && this.ownership[s.position]?.mortgaged
    );
    if (groupMortgaged) return { error: 'Riscatta prima le ipoteche del colore' };
    if (owned.hotel) return { error: "C'è già un hotel" };
    // Edificazione uniforme: si costruisce solo dove ce n'è di meno nel gruppo.
    if (this.unitCount(owned) > Math.min(...this.groupUnitCounts(square.group))) {
      return { error: 'Costruisci prima sulle altre proprietà del colore' };
    }
    if (player.balance < square.houseCost) return { error: 'Saldo insufficiente' };

    player.balance -= square.houseCost;
    if (owned.houses >= 4) {
      owned.houses = 0;
      owned.hotel = true;
      this.addLog(`${player.name} costruisce un hotel su ${square.name}.`);
    } else {
      owned.houses += 1;
      this.addLog(`${player.name} costruisce una casa su ${square.name} (${owned.houses}/4).`);
    }
    return {};
  }

  /**
   * `internal` è alzato da resolveDebtAuto: durante una liquidazione a catena il
   * debito va valutato una volta sola, alla fine.
   */
  sellHouse(playerId, position, internal = false) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (this.unitCount(owned) === 0) return { error: 'Nessuna casa da vendere' };
    // Uniformità anche in vendita: si smonta da dove ce n'è di più.
    if (this.unitCount(owned) < Math.max(...this.groupUnitCounts(square.group))) {
      return { error: 'Vendi prima dalle altre proprietà del colore' };
    }

    const refund = this.buildingRefund(square);
    player.balance += refund;
    if (owned.hotel) {
      owned.hotel = false;
      owned.houses = 4;
      this.addLog(`${player.name} vende l'hotel su ${square.name} per ${refund}.`);
    } else {
      owned.houses -= 1;
      this.addLog(`${player.name} vende una casa su ${square.name} per ${refund}.`);
    }
    if (!internal) this.checkDebtResolved(player);
    return {};
  }

  mortgageProperty(playerId, position, internal = false) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (owned.mortgaged) return { error: 'Già ipotecata' };
    if (this.unitCount(owned) > 0) return { error: 'Vendi prima case/hotel' };

    const value = this.mortgageValue(square);
    owned.mortgaged = true;
    player.balance += value;
    this.addLog(`${player.name} ipoteca ${square.name} per ${value}.`);
    if (!internal) this.checkDebtResolved(player);
    return {};
  }

  unmortgageProperty(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (!owned.mortgaged) return { error: 'Non è ipotecata' };
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    const cost = this.unmortgageCost(square);
    if (player.balance < cost) return { error: 'Saldo insufficiente' };
    player.balance -= cost;
    owned.mortgaged = false;
    this.addLog(`${player.name} riscatta ${square.name} per ${cost}.`);
    return {};
  }

  // ---- Debiti e bancarotta ----

  /**
   * Unico punto attraverso cui un giocatore perde denaro. Il debito è modellato
   * come saldo negativo: il creditore viene pagato subito e il debitore resta in
   * rosso finché non liquida abbastanza da rientrare.
   */
  chargePlayer(player, amount, creditor = null) {
    if (amount <= 0) return;
    player.balance -= amount;
    if (creditor) creditor.balance += amount;
    if (player.balance >= 0) return;

    // Nemmeno svendendo tutto ce la farebbe: bancarotta immediata, nessuna scelta.
    if (this.liquidationValue(player) < 0) {
      this.addLog(`${player.name} non può coprire il debito in alcun modo.`);
      this.bankruptPlayer(player, creditor);
      return;
    }

    this.pendingAction = {
      type: 'awaiting_debt',
      playerId: player.id,
      amount: -player.balance,
      creditorId: creditor ? creditor.id : null,
    };
    this.addLog(`${player.name} deve coprire ${-player.balance}: vendi, ipoteca o dichiara bancarotta.`);
  }

  /**
   * Se il debitore è tornato in pari chiude il debito e fa ripartire il gioco.
   * Il turno finisce comunque: un debito nasce sempre durante la risoluzione di
   * un turno, anche quando a doverlo pagare è l'avversario (carta "incassa da
   * ogni giocatore").
   */
  checkDebtResolved(player) {
    if (!this.hasPendingDebt() || this.pendingAction.playerId !== player.id) return;
    if (player.balance < 0) {
      this.pendingAction.amount = -player.balance; // il debito residuo si aggiorna
      return;
    }
    this.pendingAction = null;
    this.addLog(`${player.name} ha saldato il debito.`);
    this.finishRoll(this.currentPlayer);
  }

  /**
   * Liquidazione automatica deterministica: prima gli edifici (partendo da dove
   * ce ne sono di più, così la regola dell'uniformità è rispettata da sé), poi le
   * ipoteche, sacrificando per ultime le proprietà che compongono un monopolio.
   * Si ferma appena il saldo torna positivo.
   */
  resolveDebtAuto(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Giocatore non trovato' };
    if (!this.hasPendingDebt() || this.pendingAction.playerId !== playerId) {
      return { error: 'Non hai debiti da saldare' };
    }

    this.liquidating = true;
    this.addLog(`${player.name} liquida automaticamente per coprire il debito.`);

    // Il contatore è solo una rete di sicurezza: ogni giro vende o ipoteca
    // qualcosa, quindi il loop termina comunque.
    let safety = 0;
    while (player.balance < 0 && safety++ < 200) {
      const withBuildings = this.propertiesOf(playerId)
        .filter((entry) => this.unitCount(entry.owned) > 0)
        .sort((a, b) => this.unitCount(b.owned) - this.unitCount(a.owned));
      if (withBuildings.length > 0) {
        this.sellHouse(playerId, withBuildings[0].position, true);
        continue;
      }

      const mortgageable = this.propertiesOf(playerId)
        .filter((entry) => !entry.owned.mortgaged)
        .sort((a, b) => {
          const aMonopoly = a.square.type === 'property' && this.ownsFullGroup(playerId, a.square.group) ? 1 : 0;
          const bMonopoly = b.square.type === 'property' && this.ownsFullGroup(playerId, b.square.group) ? 1 : 0;
          if (aMonopoly !== bMonopoly) return aMonopoly - bMonopoly; // i monopoli per ultimi
          return a.square.price - b.square.price; // poi dalle più economiche
        });
      if (mortgageable.length === 0) break;
      this.mortgageProperty(playerId, mortgageable[0].position, true);
    }

    this.liquidating = false;

    // Non dovrebbe accadere: chargePlayer fallisce prima se il patrimonio non basta.
    if (player.balance < 0) {
      const creditor = this.players.find((p) => p.id === this.pendingAction?.creditorId) || null;
      this.bankruptPlayer(player, creditor);
      return {};
    }
    this.checkDebtResolved(player);
    return {};
  }

  /** Resa volontaria del giocatore che ha un debito aperto. */
  declareBankruptcy(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Giocatore non trovato' };
    if (!this.hasPendingDebt() || this.pendingAction.playerId !== playerId) {
      return { error: 'Non hai debiti da saldare' };
    }
    const creditor = this.players.find((p) => p.id === this.pendingAction.creditorId) || null;
    this.bankruptPlayer(player, creditor);
    return {};
  }

  /**
   * Esecuzione della bancarotta, sia volontaria sia forzata. Gli edifici tornano
   * alla banca senza rimborso; le proprietà passano al creditore mantenendo
   * l'ipoteca, e su ognuna di quelle ipotecate il creditore paga subito alla
   * banca il 10% di interesse, come da regolamento. Senza creditore (tasse,
   * carte) le caselle tornano libere.
   */
  bankruptPlayer(player, creditor = null) {
    if (player.bankrupt) return;
    player.bankrupt = true;

    let interestDue = 0;
    this.propertiesOf(player.id).forEach(({ position, square, owned }) => {
      if (creditor) {
        owned.ownerId = creditor.id;
        owned.houses = 0;
        owned.hotel = false;
        if (owned.mortgaged) interestDue += this.mortgageInterest(square);
      } else {
        delete this.ownership[position];
      }
    });

    if (creditor) {
      // Addebito diretto e non a cascata: se anche l'interesse mandasse il
      // creditore in rosso non ha senso aprirgli un secondo debito nel mezzo di
      // una bancarotta altrui.
      if (interestDue > 0) {
        creditor.balance -= interestDue;
        this.addLog(`${creditor.name} paga ${interestDue} di interessi sulle ipoteche ereditate.`);
      }
      // chargePlayer ha già accreditato al creditore l'intero importo dovuto, ma
      // il debitore quei soldi non li aveva: col saldo negativo si restituisce la
      // differenza, così il creditore incassa solo quanto esisteva davvero.
      creditor.balance += player.balance;
      this.addLog(`${player.name} è in bancarotta: tutto passa a ${creditor.name}.`);
    } else {
      this.addLog(`${player.name} è in bancarotta: le sue proprietà tornano alla banca.`);
    }

    player.balance = 0;
    if (this.hasPendingDebt() && this.pendingAction.playerId === player.id) this.pendingAction = null;
    this.checkWinner();
    if (!this.finished) this.finishRoll(this.currentPlayer);
  }

  // ---- Scambi fra giocatori ----

  /** Vero se esiste anche un solo edificio sul gruppo di colore della casella. */
  groupHasBuildings(group) {
    return board.some((s) => s.group === group && this.unitCount(this.ownership[s.position] || { houses: 0 }) > 0);
  }

  /**
   * Controlla che una casella sia scambiabile da un certo giocatore. Il
   * regolamento vieta di cedere una proprietà finché sul suo colore c'è anche
   * un solo edificio: prima vanno venduti tutti.
   */
  tradeBlocker(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    if (!square || !owned) return `Casella ${position} non è di nessuno`;
    if (owned.ownerId !== playerId) return `${square.name} non è di chi la offre`;
    if (square.group && this.groupHasBuildings(square.group)) {
      return `Vendi prima gli edifici sul colore di ${square.name}`;
    }
    return null;
  }

  /**
   * Apre una proposta di scambio. Non consuma il turno: chiunque può proporre,
   * anche fuori dal proprio turno, ma la proposta congela il gioco finché
   * l'altro non risponde.
   */
  proposeTrade(fromId, {
    toId,
    offerProperties = [],
    offerMoney = 0,
    offerJailCards = 0,
    requestProperties = [],
    requestMoney = 0,
    requestJailCards = 0,
  } = {}) {
    const from = this.players.find((p) => p.id === fromId);
    const to = this.players.find((p) => p.id === toId);
    if (!this.started || this.finished) return { error: 'La partita non è in corso' };
    if (!from || !to || from.id === to.id) return { error: 'Destinatario non valido' };
    if (from.bankrupt || to.bankrupt) return { error: 'Un giocatore è fallito' };
    if (this.pendingAction) return { error: 'Prima risolvi l\'azione in sospeso' };

    const amounts = [offerMoney, requestMoney, offerJailCards, requestJailCards].map(
      (n) => Math.floor(Number(n) || 0)
    );
    if (amounts.some((n) => n < 0)) return { error: 'Gli importi non possono essere negativi' };
    const [offered, requested, offeredCards, requestedCards] = amounts;
    if (offered > from.balance) return { error: 'Non hai abbastanza denaro' };
    if (requested > to.balance) return { error: `${to.name} non ha abbastanza denaro` };
    if (offeredCards > from.jailCards) return { error: 'Non hai così tante carte uscita' };
    if (requestedCards > to.jailCards) return { error: `${to.name} non ha così tante carte uscita` };
    const isEmpty =
      offerProperties.length + requestProperties.length === 0 &&
      offered + requested + offeredCards + requestedCards === 0;
    if (isEmpty) return { error: 'Lo scambio è vuoto' };

    for (const position of offerProperties) {
      const blocker = this.tradeBlocker(fromId, position);
      if (blocker) return { error: blocker };
    }
    for (const position of requestProperties) {
      const blocker = this.tradeBlocker(toId, position);
      if (blocker) return { error: blocker };
    }

    this.pendingAction = {
      type: 'awaiting_trade',
      playerId: to.id, // tocca al destinatario rispondere
      fromId: from.id,
      toId: to.id,
      offerProperties: [...offerProperties],
      offerMoney: offered,
      offerJailCards: offeredCards,
      requestProperties: [...requestProperties],
      requestMoney: requested,
      requestJailCards: requestedCards,
    };
    this.addLog(`${from.name} propone uno scambio a ${to.name}.`);
    return {};
  }

  /** Il destinatario accetta o rifiuta. In nessun caso il turno cambia. */
  respondTrade(playerId, accept) {
    if (!this.hasPendingTrade()) return { error: 'Nessuno scambio in sospeso' };
    const trade = this.pendingAction;
    if (trade.toId !== playerId) return { error: 'Non tocca a te rispondere' };

    const from = this.players.find((p) => p.id === trade.fromId);
    const to = this.players.find((p) => p.id === trade.toId);

    if (!accept) {
      this.pendingAction = null;
      this.addLog(`${to.name} rifiuta lo scambio.`);
      return {};
    }

    // Ricontrolla al momento dell'accettazione: fra proposta e risposta i due
    // possono aver costruito o ipotecato.
    for (const position of trade.offerProperties) {
      const blocker = this.tradeBlocker(trade.fromId, position);
      if (blocker) return { error: blocker };
    }
    for (const position of trade.requestProperties) {
      const blocker = this.tradeBlocker(trade.toId, position);
      if (blocker) return { error: blocker };
    }
    if (trade.offerMoney > from.balance) return { error: `${from.name} non ha più abbastanza denaro` };
    if (trade.requestMoney > to.balance) return { error: 'Non hai abbastanza denaro' };
    if (trade.offerJailCards > from.jailCards) return { error: `${from.name} non ha più quelle carte` };
    if (trade.requestJailCards > to.jailCards) return { error: 'Non hai più quelle carte' };

    trade.offerProperties.forEach((position) => { this.ownership[position].ownerId = to.id; });
    trade.requestProperties.forEach((position) => { this.ownership[position].ownerId = from.id; });

    const netCards = trade.offerJailCards - trade.requestJailCards;
    from.jailCards -= netCards;
    to.jailCards += netCards;

    // Solo la differenza cambia di mano, così non si creano saldi negativi
    // intermedi se entrambi mettono denaro sul piatto.
    const net = trade.offerMoney - trade.requestMoney;
    from.balance -= net;
    to.balance += net;

    this.addLog(`${from.name} e ${to.name} concludono lo scambio.`);
    this.pendingAction = null;

    // Chi riceve una proprietà ipotecata paga subito il 10% alla banca. Si fa
    // dopo aver chiuso il pendingAction perché l'interesse può aprire un debito.
    this.chargeMortgageInterest(to, trade.offerProperties);
    this.chargeMortgageInterest(from, trade.requestProperties);
    return {};
  }

  /** Interesse del 10% dovuto da chi riceve proprietà ipotecate in uno scambio. */
  chargeMortgageInterest(player, positions) {
    const due = positions.reduce(
      (sum, position) => sum + (this.ownership[position]?.mortgaged ? this.mortgageInterest(board[position]) : 0),
      0
    );
    if (due <= 0) return;
    this.addLog(`${player.name} paga ${due} di interessi sulle ipoteche ricevute.`);
    this.chargePlayer(player, due);
  }

  // ---- Fine anticipata ----

  /**
   * Un giocatore lascia il tavolo: l'avversario vince a tavolino. Diverso dalla
   * bancarotta, dove si perde per esaurimento; qui si sceglie di smettere.
   */
  abandonGame(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Giocatore non trovato' };
    if (this.finished) return { error: 'La partita è già finita' };

    const rimasti = this.players.filter((p) => p.id !== playerId && !p.bankrupt);
    this.finished = true;
    this.endedReason = 'abandoned';
    this.winnerId = rimasti.length === 1 ? rimasti[0].id : null;
    this.pendingAction = null;
    this.addLog(`${player.name} abbandona la partita.`);
    if (this.winnerId) this.addLog(`${rimasti[0].name} vince a tavolino.`);
    return {};
  }

  /** Chi ha creato il tavolo lo chiude per entrambi, senza vincitori. */
  endGame(playerId) {
    if (playerId !== this.hostId) {
      return { error: 'Solo chi ha creato il tavolo può chiudere la partita' };
    }
    if (this.finished) return { error: 'La partita è già finita' };
    this.finished = true;
    this.endedReason = 'closed';
    this.winnerId = null;
    this.pendingAction = null;
    this.addLog('Il tavolo è stato chiuso da chi lo ha creato.');
    return {};
  }

  /** Con un solo giocatore ancora in piedi la partita è finita. */
  checkWinner() {
    if (!this.started || this.finished) return;
    const alive = this.players.filter((p) => !p.bankrupt);
    if (alive.length === 1) {
      this.finished = true;
      this.winnerId = alive[0].id;
      this.endedReason = 'bankruptcy';
      this.addLog(`${alive[0].name} vince la partita!`);
    }
  }

  endTurn() {
    // Un debito o uno scambio aperto congelano la partita per entrambi.
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.hasPendingTrade()) return { error: 'Prima rispondi allo scambio proposto' };
    if (this.hasPendingCard()) return { error: 'Prima leggi la carta pescata' };
    // Il turno può essere chiuso una sola volta per tiro: una bancarotta lo
    // chiude già da dentro resolveLanding, e rollDice non deve rifarlo.
    if (this.turnResolved || this.finished) return {};
    this.turnResolved = true;
    this.pendingAction = null;
    // I doppi contano solo entro il turno di chi li ha tirati.
    if (this.currentPlayer) this.currentPlayer.doublesInARow = 0;
    if (this.players.every((p) => p.bankrupt)) return {};
    do {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
    } while (this.currentPlayer.bankrupt);
    this.addLog(`Turno di ${this.currentPlayer.name}.`);
  }
}

module.exports = { GameEngine, board };
