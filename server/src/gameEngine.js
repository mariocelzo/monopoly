const { board, STATION_RENT, UTILITY_MULTIPLIER, CHANCE_CARDS, COMMUNITY_CARDS } = require('./data/board');

const STARTING_BALANCE = 1500;
const GO_AMOUNT = 200;
const JAIL_POSITION = 10;
const GO_TO_JAIL_POSITION = 30;
const JAIL_FINE = 50;
const MAX_JAIL_TURNS = 3;

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
    this.pendingAction = null; // { type: 'awaiting_buy' | 'awaiting_dice' | ..., data }
  }

  addLog(message) {
    this.log.push({ message, at: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  addPlayer(id, name, token) {
    if (this.players.find((p) => p.id === id)) return;
    this.players.push({
      id, name, token,
      balance: STARTING_BALANCE,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
    });
    this.addLog(`${name} si è unito alla partita.`);
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
    return {
      roomCode: this.roomCode,
      players: this.players,
      ownership: this.ownership,
      turnIndex: this.turnIndex,
      started: this.started,
      log: this.log.slice(-30),
      pendingAction: this.pendingAction,
    };
  }

  // ---- Turn flow ----

  rollDice(playerId) {
    const player = this.currentPlayer;
    if (!player || player.id !== playerId || player.bankrupt) return { error: 'Non è il tuo turno' };
    if (this.pendingAction) return { error: 'Azione in sospeso da risolvere prima' };

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const isDouble = d1 === d2;

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
          player.balance -= JAIL_FINE;
          player.inJail = false;
          player.jailTurns = 0;
          this.addLog(`${player.name} paga ${JAIL_FINE} per uscire dopo 3 tentativi.`);
          this.movePlayer(player, d1 + d2);
        } else {
          this.endTurn();
        }
      }
      return { dice: [d1, d2] };
    }

    this.movePlayer(player, d1 + d2);

    // three doubles in a row -> jail (simplified: not tracked across turns here, single-double just gives extra roll)
    if (isDouble && !this.pendingAction) {
      this.addLog(`${player.name} ha fatto doppio: gioca ancora.`);
      // don't auto end turn; front-end can call rollDice again for same player
    } else if (!this.pendingAction) {
      this.endTurn();
    }

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

  resolveLanding(player) {
    const square = board[player.position];
    switch (square.type) {
      case 'go':
        break;
      case 'tax':
        player.balance -= square.amount;
        this.addLog(`${player.name} paga ${square.amount} di ${square.name}.`);
        this.checkBankruptcy(player, square.amount);
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
    const rent = this.calculateRent(square, owned);
    const owner = this.players.find((p) => p.id === owned.ownerId);
    player.balance -= rent;
    owner.balance += rent;
    this.addLog(`${player.name} paga ${rent} di affitto a ${owner.name} per ${square.name}.`);
    this.checkBankruptcy(player, rent, owner);
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
    this.endTurn();
    return {};
  }

  declineBuy(playerId) {
    if (!this.pendingAction || this.pendingAction.type !== 'awaiting_buy') return { error: 'Nessun acquisto in sospeso' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };
    this.addLog(`${this.currentPlayer.name} rinuncia all'acquisto di ${board[this.pendingAction.position].name}.`);
    this.pendingAction = null;
    this.endTurn();
    return {};
  }

  drawCard(player, deckType) {
    const deck = deckType === 'chance' ? this.chanceDeck : this.communityDeck;
    const card = deck.shift();
    deck.push(card);
    this.addLog(`${player.name} pesca: "${card.text}"`);
    this.applyCard(player, card);
  }

  applyCard(player, card) {
    switch (card.action) {
      case 'collect':
        player.balance += card.amount;
        break;
      case 'pay':
        player.balance -= card.amount;
        this.checkBankruptcy(player, card.amount);
        break;
      case 'pay_each_player':
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          player.balance -= card.amount;
          p.balance += card.amount;
        });
        break;
      case 'collect_from_each_player':
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          p.balance -= card.amount;
          player.balance += card.amount;
        });
        break;
      case 'advance_to': {
        const passedGo = card.target < player.position;
        player.position = card.target;
        if (passedGo && card.collectGo) player.balance += GO_AMOUNT;
        this.resolveLanding(player);
        break;
      }
      case 'move_back': {
        player.position = (player.position - card.spaces + 40) % 40;
        this.resolveLanding(player);
        break;
      }
      case 'advance_to_nearest_station': {
        const stations = board.filter((s) => s.type === 'station').map((s) => s.position);
        const next = stations.find((pos) => pos > player.position) ?? stations[0];
        const passedGo = next < player.position;
        player.position = next;
        if (passedGo) player.balance += GO_AMOUNT;
        this.resolveLanding(player);
        break;
      }
      case 'get_out_of_jail':
        player.jailCards += 1;
        break;
      case 'go_to_jail':
        this.sendToJail(player);
        break;
      case 'repairs': {
        let total = 0;
        board.forEach((s) => {
          const o = this.ownership[s.position];
          if (o && o.ownerId === player.id) {
            total += (o.houses || 0) * card.perHouse + (o.hotel ? card.perHotel : 0);
          }
        });
        player.balance -= total;
        this.checkBankruptcy(player, total);
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

  buildHouse(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!square || square.type !== 'property') return { error: 'Non è una proprietà edificabile' };
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (!this.ownsFullGroup(playerId, square.group)) return { error: 'Serve il monopolio del colore per costruire' };
    if (owned.hotel) return { error: "C'è già un hotel" };
    if (owned.houses >= 4) {
      if (player.balance < square.houseCost) return { error: 'Saldo insufficiente' };
      player.balance -= square.houseCost;
      owned.houses = 0;
      owned.hotel = true;
      this.addLog(`${player.name} costruisce un hotel su ${square.name}.`);
      return {};
    }
    if (player.balance < square.houseCost) return { error: 'Saldo insufficiente' };
    player.balance -= square.houseCost;
    owned.houses += 1;
    this.addLog(`${player.name} costruisce una casa su ${square.name} (${owned.houses}/4).`);
    return {};
  }

  sellHouse(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    const refund = Math.floor(square.houseCost / 2);
    if (owned.hotel) {
      owned.hotel = false;
      owned.houses = 4;
      player.balance += refund;
      this.addLog(`${player.name} vende l'hotel su ${square.name}.`);
      return {};
    }
    if (owned.houses > 0) {
      owned.houses -= 1;
      player.balance += refund;
      this.addLog(`${player.name} vende una casa su ${square.name}.`);
      return {};
    }
    return { error: 'Nessuna casa da vendere' };
  }

  mortgageProperty(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (owned.mortgaged) return { error: 'Già ipotecata' };
    if (owned.houses > 0 || owned.hotel) return { error: 'Vendi prima case/hotel' };
    const value = Math.floor(square.price / 2);
    owned.mortgaged = true;
    player.balance += value;
    this.addLog(`${player.name} ipoteca ${square.name} per ${value}.`);
    return {};
  }

  unmortgageProperty(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (!owned.mortgaged) return { error: 'Non è ipotecata' };
    const cost = Math.ceil((square.price / 2) * 1.1); // 10% interest
    if (player.balance < cost) return { error: 'Saldo insufficiente' };
    player.balance -= cost;
    owned.mortgaged = false;
    this.addLog(`${player.name} riscatta ${square.name} per ${cost}.`);
    return {};
  }

  checkBankruptcy(player, amountOwed, creditor = null) {
    if (player.balance >= 0) return;
    // simplified: auto-liquidate mortgages/houses isn't implemented yet;
    // if still negative after nothing to sell, declare bankrupt
    if (player.balance < 0) {
      player.bankrupt = true;
      this.addLog(`${player.name} è in bancarotta!`);
      // transfer all properties to creditor or bank
      Object.entries(this.ownership).forEach(([pos, o]) => {
        if (o.ownerId === player.id) {
          if (creditor) {
            o.ownerId = creditor.id;
            o.houses = 0;
            o.hotel = false;
          } else {
            delete this.ownership[pos];
          }
        }
      });
    }
  }

  endTurn() {
    this.pendingAction = null;
    if (this.players.every((p) => p.bankrupt)) return;
    do {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
    } while (this.currentPlayer.bankrupt);
    this.addLog(`Turno di ${this.currentPlayer.name}.`);
  }
}

module.exports = { GameEngine, board };
