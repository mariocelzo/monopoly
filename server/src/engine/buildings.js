const { board } = require('../data/board');
const { MAX_HOTELS_SKYSCRAPER, MAX_HOTELS_CLASSIC } = require('./constants');

module.exports = {
  buildHouse(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!square || square.type !== 'property') return { error: 'Non è una proprietà edificabile' };
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    // Il gruppo intero, non solo questa casella: un edificio su un qualunque
    // colore che compare in una proposta aperta la renderebbe inaccettabile
    // (vedi tradeGoodsBlocker e la regola in tradeBlocker).
    const impegnata = this.tradeGoodsBlocker(playerId, position, { includiGruppo: true });
    if (impegnata) return impegnata;
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();
    if (!this.ownsFullGroup(playerId, square.group)) return { error: 'Serve il monopolio del colore per costruire' };
    // Regola ufficiale: niente costruzioni su un colore con proprietà ipotecate.
    const groupMortgaged = board.some(
      (s) => s.group === square.group && this.ownership[s.position]?.mortgaged
    );
    if (groupMortgaged) return { error: 'Riscatta prima le ipoteche del colore' };
    // Il tetto di hotel per proprietà: 1 come da regolamento classico, 4 con
    // la modalità grattacieli accesa (vedi rules.skyscraperEnabled).
    const maxHotels = this.rules.skyscraperEnabled ? MAX_HOTELS_SKYSCRAPER : MAX_HOTELS_CLASSIC;
    if (owned.hotels >= maxHotels) {
      return { error: maxHotels === MAX_HOTELS_CLASSIC ? "C'è già un hotel" : 'Hai già il massimo di hotel su questa proprietà' };
    }
    // Edificazione uniforme: si costruisce solo dove ce n'è di meno nel gruppo.
    if (this.unitCount(owned) > Math.min(...this.groupUnitCounts(square.group))) {
      return { error: 'Costruisci prima sulle altre proprietà del colore' };
    }
    const cost = this.nextBuildingCost(square, owned);
    if (player.balance < cost) return { error: 'Saldo insufficiente' };

    player.balance -= cost;
    // Tre casi, non due: con più di un livello di hotel possibile non basta
    // più distinguere solo "quattro case" da "meno di quattro". Un hotel già
    // presente (owned.hotels > 0) va sempre al livello successivo, prima di
    // guardare le case — che con un hotel in piedi sono comunque a zero per
    // invariante (vedi sellHouse). Prima che gli hotel oltre il primo
    // esistessero questo caso non poteva capitare (owned.hotels era già al
    // tetto e buildHouse si era fermato più sopra), quindi il ramo mancava.
    if (owned.hotels > 0) {
      owned.hotels += 1;
      this.addLog(`${player.name} costruisce il ${owned.hotels}º hotel su ${square.name} per ${cost}.`);
    } else if (owned.houses >= 4) {
      owned.houses = 0;
      owned.hotels = 1;
      this.addLog(`${player.name} costruisce un hotel su ${square.name}.`);
    } else {
      owned.houses += 1;
      this.addLog(`${player.name} costruisce una casa su ${square.name} (${owned.houses}/4).`);
    }
    // Conta la costruzione (casa o hotel indifferentemente): quante volte il
    // giocatore ha investito in edifici, non quante unità possiede ora.
    this.bumpStat(this.stats.housesBuilt, playerId);
    // Costruire è l'ultima spesa che non passa da chargePlayer. Il colore su
    // cui si costruisce non può comparire in una proposta di chi costruisce
    // (glielo vieta il congelamento più sopra), ma i contanti spesi possono
    // benissimo essere quelli promessi in quella proposta.
    this.decadiProposteImpossibili();
    return {};
  },

  /**
   * `internal` è alzato da resolveDebtAuto: durante una liquidazione a catena il
   * debito va valutato una volta sola, alla fine.
   */
  sellHouse(playerId, position, internal = false) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    // Nessun congelamento da scambio, e non è una dimenticanza: vedi il perché
    // per esteso in tradeGoodsBlocker. Su un colore impegnato in una proposta
    // aperta edifici non ce ne sono, quindi qui non c'è niente da difendere —
    // e vietare la vendita servirebbe solo a impedire a chi sta trattando di
    // fare cassa per pagare un affitto dall'altra parte del tabellone.
    if (this.unitCount(owned) === 0) return { error: 'Nessuna casa da vendere' };
    // Uniformità anche in vendita: si smonta da dove ce n'è di più.
    if (this.unitCount(owned) < Math.max(...this.groupUnitCounts(square.group))) {
      return { error: 'Vendi prima dalle altre proprietà del colore' };
    }

    // Si vende sempre l'unità più in alto nella pila: con più hotel il
    // rimborso dipende da QUALE livello si toglie (il 4° di Parco della
    // Vittoria rende 3.000, l'ultimo rimasto solo 100), non più un rimborso
    // fisso uguale per tutti (vedi buildingRefund).
    const soldUnit = this.unitCount(owned);
    const refund = this.buildingRefund(square, soldUnit);
    player.balance += refund;
    if (owned.hotels > 0) {
      owned.hotels -= 1;
      // Le case fantasma tornano SOLO quando si toglie l'ultimo hotel
      // rimasto: vendendo il 4°, 3° o 2° hotel restano rispettivamente 3, 2 o
      // 1 hotel, non quattro case. Prima, con un hotel solo possibile, questo
      // caso e "l'ultimo rimasto" coincidevano sempre.
      if (owned.hotels === 0) {
        owned.houses = 4;
        this.addLog(`${player.name} vende l'ultimo hotel su ${square.name} per ${refund}: tornano quattro case.`);
      } else {
        this.addLog(`${player.name} vende un hotel su ${square.name} per ${refund} (ne restano ${owned.hotels}).`);
      }
    } else {
      owned.houses -= 1;
      this.addLog(`${player.name} vende una casa su ${square.name} per ${refund}.`);
    }
    if (!internal) this.checkDebtResolved(player);
    return {};
  },

  mortgageProperty(playerId, position, internal = false) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    // Ipotecare una casella promessa cambia sotto banco quel che si consegna:
    // chi accetta si troverebbe una proprietà a metà valore e pure il 10% di
    // interesse da pagare. Solo questa casella, non tutte le sue.
    const impegnata = this.tradeGoodsBlocker(playerId, position);
    if (impegnata) return impegnata;
    if (owned.mortgaged) return { error: 'Già ipotecata' };
    if (this.unitCount(owned) > 0) return { error: 'Vendi prima case/hotel' };

    const value = this.mortgageValue(square);
    owned.mortgaged = true;
    player.balance += value;
    this.addLog(`${player.name} ipoteca ${square.name} per ${value}.`);
    if (!internal) this.checkDebtResolved(player);
    return {};
  },

  unmortgageProperty(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (!owned.mortgaged) return { error: 'Non è ipotecata' };
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    // Simmetrico all'ipoteca: riscattare una casella promessa la cambia
    // comunque rispetto a quella su cui l'altro sta decidendo. Che il cambio
    // sia in meglio per chi la riceve non fa differenza — il patto si guarda,
    // non si ritocca mentre l'altro lo legge.
    const impegnata = this.tradeGoodsBlocker(playerId, position);
    if (impegnata) return impegnata;
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();
    const cost = this.unmortgageCost(square);
    if (player.balance < cost) return { error: 'Saldo insufficiente' };
    player.balance -= cost;
    owned.mortgaged = false;
    this.addLog(`${player.name} riscatta ${square.name} per ${cost}.`);
    // Riscattare è una spesa che non passa da chargePlayer: se prosciuga i
    // contanti promessi altrove, la proposta decade come per ogni altra uscita.
    this.decadiProposteImpossibili();
    return {};
  },

};
