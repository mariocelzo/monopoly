const { board } = require('../data/board');
const {
  buildingCostOf, buildingRefundOf, hotelRentOf, mortgageValueOf,
  mortgageInterestOf, unmortgageCostOf,
} = require('./pricing');

// Lettura di proprietà, edifici e patrimonio: tutti metodi che LEGGONO lo
// stato (this.ownership, this.players) senza mai scriverlo. I wrapper sottili
// (buildingCost, mortgageValue...) richiamano le funzioni pure di pricing.js,
// spostate lì insieme a boardWithAmounts.
module.exports = {
  /** Tutte le caselle possedute da un giocatore, con casella e stato di possesso. */
  propertiesOf(playerId) {
    return Object.entries(this.ownership)
      .filter(([, owned]) => owned.ownerId === playerId)
      .map(([position, owned]) => ({ position: Number(position), square: board[Number(position)], owned }));
  },

  /**
   * Edifici presenti su una casella espressi in "unità casa": 1-4 sono le case,
   * 5-8 sono i livelli di hotel (owned.hotels, 0-4 con la modalità grattacieli;
   * senza, al più 1). Un hotel vale sempre "4 + il suo livello" perché occupa il
   * posto delle quattro case: il primo hotel vale quindi 5 come prima di questa
   * regola, il quarto vale 8. Così il confronto per l'edificazione uniforme (e
   * per la vendita, che smonta da dove ce n'è di più) resta un semplice numero,
   * anche con più hotel.
   */
  unitCount(owned) {
    return owned.hotels > 0 ? 4 + owned.hotels : owned.houses;
  },

  /**
   * Costo per costruire l'unità numero `n` su una casella: 1-4 sono case, tutte
   * a houseCost; 5-8 sono i livelli di hotel, a houseCost moltiplicato per
   * HOTEL_COST_MULTIPLIER (1, 15, 22, 30). Il primo hotel (n=5) costa quindi
   * come una casa, esattamente come prima che i livelli oltre il primo
   * esistessero: la modalità grattacieli non cambia nulla lì, aggiunge solo i
   * livelli successivi.
   */
  buildingCost(square, n) {
    return buildingCostOf(square, n);
  },

  /** Quanto costerebbe costruire la prossima unità (casa o hotel) su questa casella. */
  nextBuildingCost(square, owned) {
    return this.buildingCost(square, this.unitCount(owned) + 1);
  },

  /**
   * Quanto ricava il giocatore vendendo l'unità numero `n`: metà di quanto
   * pagato per costruirla. Serve un numero di unità e non più solo la casella,
   * perché con più hotel il rimborso dipende da QUALE livello si toglie (vedi
   * sellHouse, che vende sempre quello in cima alla pila) — prima, con un solo
   * livello possibile, il rimborso era sempre houseCost/2 e basta.
   */
  buildingRefund(square, n) {
    return buildingRefundOf(square, n);
  },

  /**
   * Elenco delle unità (numeri 1-8, stesso significato di unitCount) davvero
   * costruite su una casella, dalla prima all'ultima. Con un hotel le case sono
   * a zero per invariante (vedi buildHouse/sellHouse), quindi le due liste non
   * si sommano mai: o ci sono solo case, o c'è solo il pacchetto di hotel.
   * Usata da liquidationValue e netWorth per sommare il valore di OGNI livello
   * davvero presente, invece di moltiplicare il numero di edifici per un
   * rimborso o un costo unico — quella scorciatoia andava bene quando tutti gli
   * edifici costavano uguale, non più con gli hotel a prezzi crescenti.
   */
  builtUnits(owned) {
    const units = [];
    if (owned.hotels > 0) {
      for (let livello = 1; livello <= owned.hotels; livello++) units.push(4 + livello);
    } else {
      for (let casa = 1; casa <= owned.houses; casa++) units.push(casa);
    }
    return units;
  },

  /**
   * Affitto di una proprietà con almeno un hotel: l'affitto dell'hotel singolo
   * (rents[5]) moltiplicato per HOTEL_RENT_MULTIPLIER e arrotondato ai 25 più
   * vicini. Con un solo hotel il moltiplicatore è 1 e l'arrotondamento non
   * tocca nulla (tutti i rents[5] di board.js sono già multipli di 25): è
   * esattamente l'affitto di sempre, non una nuova regola per chi gioca senza
   * la modalità grattacieli.
   */
  hotelRent(square, hotels) {
    return hotelRentOf(square, hotels);
  },

  /** Valore d'ipoteca di una proprietà: metà del prezzo d'acquisto. */
  mortgageValue(square) {
    return mortgageValueOf(square);
  },

  /** Interesse del 10% dovuto alla banca su una proprietà ipotecata. */
  mortgageInterest(square) {
    return mortgageInterestOf(square);
  },

  /** Costo per riscattare un'ipoteca: il valore più il 10% di interesse. */
  unmortgageCost(square) {
    return unmortgageCostOf(square);
  },

  /**
   * Quanto avrebbe il giocatore se liquidasse tutto: contanti, più il rimborso di
   * ogni edificio, più l'ipoteca su ogni proprietà non ancora ipotecata.
   * Se questo valore è negativo il debito è impossibile da coprire.
   */
  liquidationValue(player) {
    return this.propertiesOf(player.id).reduce((total, { square, owned }) => {
      // Si somma il rimborso di OGNI livello davvero costruito (builtUnits),
      // non "numero di edifici × un rimborso unico": con gli hotel a prezzi
      // crescenti quella scorciatoia sottostimava di molto il patrimonio (il
      // 4° hotel di Parco della Vittoria da solo rimborsa 3.000, non gli 800
      // che darebbe 4 unità × 200/2). Stazioni e società non costruiscono
      // nulla: builtUnits torna vuoto e questo termine resta zero, come prima.
      let extra = this.builtUnits(owned).reduce((sum, n) => sum + this.buildingRefund(square, n), 0);
      if (!owned.mortgaged) extra += this.mortgageValue(square);
      return total + extra;
    }, player.balance);
  },

  /**
   * Il patrimonio pieno del giocatore: contanti, più ogni proprietà al prezzo
   * intero, più ogni edificio al costo intero di costruzione.
   *
   * È deliberatamente diverso da liquidationValue qui sopra, anche se
   * l'impianto è lo stesso: quella funzione risponde a "quanto racimolerei
   * svendendo tutto per pagare un debito", e per questo conta tutto a metà
   * (mortgageValue, buildingRefund) — un giocatore pieno di proprietà ci
   * risulterebbe povero, il che va benissimo per giudicare un debito ma è
   * fuorviante per dire chi è avanti in partita. Qui invece serve il valore
   * vero di quello che si possiede, lo stesso metro con cui si giudicherebbe
   * un'offerta di scambio: si usa nel client per l'indicatore "chi vince",
   * non per la solvibilità.
   *
   * Le proprietà ipotecate valgono comunque qualcosa, ma meno di una libera:
   * la banca ha già anticipato mortgageValue in contanti (che infatti è già
   * dentro player.balance, quindi non va contato due volte) e per riavere la
   * proprietà sgombra bisogna restituirlo con l'interesse (unmortgageCost).
   * Si conta perciò prezzo pieno meno quel costo di riscatto — non zero,
   * perché il giocatore un'equity nella proprietà ce l'ha ancora; non il
   * prezzo pieno, perché quell'equity è ridotta di quanto costerebbe
   * liberarla adesso.
   */
  netWorth(player) {
    return this.propertiesOf(player.id).reduce((total, { square, owned }) => {
      // Stesso principio di liquidationValue qui sopra, ma a costo pieno
      // invece che a rimborso: si somma il costo vero di OGNI livello
      // costruito (builtUnits + buildingCost), non "numero di edifici ×
      // houseCost" — quella scorciatoia valeva solo finché ogni edificio
      // costava uguale, e con gli hotel a prezzi crescenti sottostimerebbe il
      // patrimonio esattamente come faceva la vecchia liquidationValue.
      let extra = this.builtUnits(owned).reduce((sum, n) => sum + this.buildingCost(square, n), 0);
      extra += owned.mortgaged ? square.price - this.unmortgageCost(square) : square.price;
      return total + extra;
    }, player.balance);
  },


  ownsFullGroup(ownerId, group) {
    const groupSquares = board.filter((s) => s.group === group);
    return groupSquares.every((s) => this.ownership[s.position]?.ownerId === ownerId);
  },

  /** Numero di unità casa presenti su ogni casella del gruppo di colore. */
  groupUnitCounts(group) {
    return board
      .filter((s) => s.group === group)
      .map((s) => (this.ownership[s.position] ? this.unitCount(this.ownership[s.position]) : 0));
  },

};
