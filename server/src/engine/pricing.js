const { board } = require('../data/board');
const {
  HOTEL_COST_MULTIPLIER,
  HOTEL_RENT_MULTIPLIER,
  MORTGAGE_INTEREST_NUM,
  MORTGAGE_INTEREST_DEN,
} = require('./constants');

// ---------------------------------------------------------------------------
// Gli importi che dipendono solo dalla casella
// ---------------------------------------------------------------------------
// Costo di costruzione, rimborso di vendita, valore d'ipoteca, costo di
// riscatto e affitto degli hotel non dipendono dalla partita in corso: date la
// casella e il livello, il numero è sempre quello. Stanno qui come funzioni
// pure, e i metodi della classe qui sotto si limitano a richiamarle, per una
// ragione precisa: sono gli stessi importi che il client deve MOSTRARE accanto
// ai bottoni ("Ipoteca €60", "Vendi", "Costruisci €150"), e finora se li
// ricalcolava per conto suo copiando le formule. Da qui invece si possono
// pubblicare già pronti insieme al tabellone (vedi boardWithAmounts), sullo
// stesso principio già scritto in serialize(): il motore è l'unica fonte di
// verità sulle regole, il client mostra quello che gli arriva.
//
// Non è una precauzione teorica. Questa famiglia di difetti — una regola del
// server riscritta nel client, che poi diverge — ha già colpito due volte: i
// bot bloccati all'asta e il tasto "Rilancia" che mandava un'offerta sotto il
// minimo su 24 caselle su 28. Il rimedio che ha funzionato è sempre stato lo
// stesso: far pubblicare l'importo al server (è così che è nato minBid).

/** Costo per costruire l'unità numero `n`: 1-4 case, 5-8 livelli di hotel. */
function buildingCostOf(square, n) {
  if (n <= 4) return square.houseCost;
  return square.houseCost * (HOTEL_COST_MULTIPLIER[n - 4] || 0);
}

/** Rimborso vendendo l'unità numero `n`: metà di quanto è costata. */
function buildingRefundOf(square, n) {
  return Math.floor(buildingCostOf(square, n) / 2);
}

/** Affitto con `hotels` livelli di hotel, arrotondato ai 25 più vicini. */
function hotelRentOf(square, hotels) {
  const raw = square.rents[5] * (HOTEL_RENT_MULTIPLIER[hotels] || 1);
  return Math.round(raw / 25) * 25;
}

/** Valore d'ipoteca: metà del prezzo d'acquisto. */
function mortgageValueOf(square) {
  return Math.floor(square.price / 2);
}

/** Interesse del 10% dovuto alla banca su una proprietà ipotecata. */
function mortgageInterestOf(square) {
  return Math.ceil((mortgageValueOf(square) * MORTGAGE_INTEREST_NUM) / MORTGAGE_INTEREST_DEN);
}

/** Costo per riscattare un'ipoteca: il valore più il 10% di interesse. */
function unmortgageCostOf(square) {
  return mortgageValueOf(square) + mortgageInterestOf(square);
}

/**
 * Il tabellone con, su ogni casella, gli importi che il client mostra senza
 * doverli ricalcolare. È quello che risponde `GET /board`, e si scarica una
 * volta sola all'avvio: nessun costo per mossa, a differenza dello stato.
 *
 * Gli array sono indicizzati per numero di unità meno uno — `buildCosts[0]` è
 * la prima casa, `buildCosts[4]` il primo hotel, `hotelRents[0]` l'affitto con
 * un hotel — e ci sono tutti e otto i livelli anche a modalità grattacieli
 * spenta: quale sia il tetto è una regola della casa, che il client conosce già
 * dallo stato, non una proprietà della casella.
 */
function boardWithAmounts() {
  return board.map((square) => {
    const extra = {};
    if (square.price) {
      extra.mortgageValue = mortgageValueOf(square);
      extra.unmortgageCost = unmortgageCostOf(square);
    }
    if (square.houseCost) {
      extra.buildCosts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => buildingCostOf(square, n));
      extra.buildRefunds = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => buildingRefundOf(square, n));
    }
    if (square.rents) {
      extra.hotelRents = [1, 2, 3, 4].map((h) => hotelRentOf(square, h));
    }
    return { ...square, ...extra };
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = {
  buildingCostOf, buildingRefundOf, hotelRentOf, mortgageValueOf,
  mortgageInterestOf, unmortgageCostOf, boardWithAmounts, shuffle,
};
