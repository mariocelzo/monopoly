// Valutazioni della strategia dei bot: funzioni pure, senza stato e senza
// timer, così si testano senza costruire una partita intera.
//
// I pesi non derivano dal prezzo di listino ma dalla resa reale osservata nel
// Monopoli: quanto spesso si atterra su un gruppo e quanto rende quando
// succede. Le caselle vicine alla prigione (la più visitata del tabellone,
// fra multe, tris di doppi e carte) si vedono molto più delle altre.
const { board } = require('./data/board');

/** Quanto rende davvero un gruppo di colore, non quanto costa. */
const GROUP_WEIGHTS = {
  brown: 0.7,      // poche caselle, affitti bassi
  lightblue: 1.0,
  pink: 1.15,
  orange: 1.5,     // il gruppo migliore: 6-8-9 caselle dopo la prigione
  red: 1.35,
  yellow: 1.2,
  green: 1.05,     // care da costruire, rientro lento
  blue: 1.25,      // rendono moltissimo ma solo a cassa alta
};

/** Peso di un gruppo, 1 (neutro) se sconosciuto — stazioni e società. */
function groupWeight(group) {
  return GROUP_WEIGHTS[group] ?? 1;
}

/**
 * Quanto conviene al bot comprare questa casella, dato il suo saldo.
 * Positivo = comprare, negativo = lasciar perdere. La soglia di decisione sta
 * in bot.js, qui si produce solo il punteggio.
 */
function propertyScore(game, playerId, square, balance) {
  if (!square || square.price === undefined) return -1;

  const prezzo = square.price;
  // Riserva di sicurezza: comprare non deve lasciare senza contanti per gli
  // affitti altrui. Sotto questa soglia il punteggio crolla.
  const riservaDopo = balance - prezzo;
  if (riservaDopo < 0) return -1;

  let punteggio = groupWeight(square.group);

  // Stazioni: rendita sicura che sale con quante se ne possiedono, e non
  // richiede mai di immobilizzare denaro in case.
  if (square.type === 'station') {
    const mie = board.filter(
      (s) => s.type === 'station' && game.ownership[s.position]?.ownerId === playerId
    ).length;
    punteggio = 1.2 + mie * 0.25;
  }

  // Società: utili solo come merce di scambio, mai come investimento.
  if (square.type === 'utility') punteggio = 0.6;

  // Completare un monopolio è la mossa che vince le partite.
  if (square.group) {
    const gruppo = board.filter((s) => s.group === square.group);
    const mieNelGruppo = gruppo.filter(
      (s) => s.position !== square.position &&
        game.ownership[s.position]?.ownerId === playerId
    ).length;
    if (mieNelGruppo === gruppo.length - 1) punteggio *= 2.5;
    else if (mieNelGruppo > 0) punteggio *= 1.4;

    // Negare un monopolio a un avversario vicino a completarlo vale quasi
    // quanto completarne uno proprio.
    const altrui = {};
    gruppo.forEach((s) => {
      const o = game.ownership[s.position];
      if (o && o.ownerId !== playerId) altrui[o.ownerId] = (altrui[o.ownerId] || 0) + 1;
    });
    if (Object.values(altrui).some((n) => n === gruppo.length - 1)) punteggio *= 1.8;
  }

  // I gruppi cari valgono solo con la cassa per costruirci sopra.
  if (square.group === 'blue' || square.group === 'green') {
    if (balance < 800) punteggio *= 0.6;
  }

  // La liquidità residua modula tutto: più si resta scoperti, meno conviene.
  const fattoreLiquidita = Math.min(1.3, riservaDopo / 400);
  return punteggio * fattoreLiquidita - 0.35;
}

/** Valore di listino di un elenco di caselle. */
function propertiesValue(positions) {
  return positions.reduce((tot, pos) => tot + (board[pos]?.price || 0), 0);
}

/**
 * Il bot accetta lo scambio? Confronta cosa dà e cosa riceve, con un bonus
 * forte per i monopoli che completerebbe e un malus per quelli che
 * romperebbe. Tollera un piccolo svantaggio: un giocatore vero non calcola al
 * centesimo, e rifiutare tutto lo renderebbe insopportabile.
 */
function evaluateTrade(game, botId, trade) {
  const {
    offerProperties = [], offerMoney = 0, offerJailCards = 0,
    requestProperties = [], requestMoney = 0, requestJailCards = 0,
  } = trade;

  // "offer" è ciò che mette sul piatto chi ha fatto la proposta, quindi ciò
  // che il bot riceve; "request" è ciò che chiede, quindi ciò che il bot dà.
  const riceve = propertiesValue(offerProperties) + offerMoney + offerJailCards * 50;
  const da = propertiesValue(requestProperties) + requestMoney + requestJailCards * 50;

  let valoreRicevuto = riceve;
  let valoreCeduto = da;

  // Ricevere la casella che completa un colore vale molto più del listino.
  offerProperties.forEach((pos) => {
    const square = board[pos];
    if (!square?.group) return;
    const gruppo = board.filter((s) => s.group === square.group);
    const gia = gruppo.filter(
      (s) => s.position !== pos && game.ownership[s.position]?.ownerId === botId
    ).length;
    if (gia === gruppo.length - 1) valoreRicevuto += square.price * 1.5;
  });

  // Cedere una casella di un monopolio già posseduto è quasi sempre un errore.
  requestProperties.forEach((pos) => {
    const square = board[pos];
    if (!square?.group) return;
    if (game.ownsFullGroup(botId, square.group)) valoreCeduto += square.price * 3;
  });

  // Non si scende sotto una riserva minima di contanti.
  const bot = game.players.find((p) => p.id === botId);
  if (bot && bot.balance - requestMoney < 100) return false;

  // Tolleranza del 10%: accetta anche un piccolo svantaggio.
  return valoreRicevuto >= valoreCeduto * 0.9;
}

module.exports = { groupWeight, propertyScore, evaluateTrade, propertiesValue, GROUP_WEIGHTS };
