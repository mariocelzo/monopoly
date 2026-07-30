// Il giocatore artificiale. Non ha accesso privilegiato al motore: chiama gli
// stessi metodi pubblici che chiamerebbe un client umano, e vale per lui ogni
// regola e ogni rifiuto.
//
// Ogni chiamata a botMove esegue UNA sola mossa e ritorna. Il ciclo che le
// concatena, con le pause fra una e l'altra, sta in server.js: qui non ci sono
// timer, così le decisioni si testano in modo sincrono.
const { board } = require('./data/board');
const { propertyScore, evaluateTrade, groupWeight, regalaMonopolio } = require('./botStrategy');

/** Contanti che un bot cerca sempre di non intaccare. */
const RISERVA = 150;

/** Vero se tocca a un bot ed è libero di agire. */
function isBotTurn(game) {
  if (!game.started || game.finished) return false;
  const current = game.currentPlayer;
  return !!current && current.isBot === true && !current.bankrupt;
}

/** Vero se un pendingAction aspetta la risposta di un bot. */
function botMustAnswer(game) {
  const pa = game.pendingAction;
  if (!pa) return false;
  const atteso = game.players.find((p) => p.id === pa.playerId);
  return !!atteso && atteso.isBot === true && !atteso.bankrupt;
}

/** Vero se c'è una qualunque mossa da far fare a un bot adesso. */
function botHasMove(game) {
  if (game.finished) {
    // A partita finita resta solo il voto per la rivincita.
    return game.endedReason !== 'closed' &&
      game.players.some((p) => p.isBot && !game.rematchVotes.includes(p.id));
  }
  return botMustAnswer(game) || (isBotTurn(game) && !game.pendingAction);
}

/**
 * Esegue una singola mossa del bot che ha diritto di agire adesso.
 * Ritorna true se ha fatto qualcosa, false se non c'era nulla da fare.
 */
function botMove(game) {
  // A partita finita i bot votano subito la rivincita: altrimenti bloccherebbero
  // per sempre il voto degli umani, aspettando un consenso che non arriva.
  if (game.finished) {
    if (game.endedReason === 'closed') return false;
    const daVotare = game.players.find((p) => p.isBot && !game.rematchVotes.includes(p.id));
    if (!daVotare) return false;
    game.requestRematch(daVotare.id);
    return 'rivincita';
  }

  if (botMustAnswer(game)) return risolvePendingAction(game);
  if (isBotTurn(game) && !game.pendingAction) return giocaIlTurno(game);
  return false;
}

/** Risolve l'azione in sospeso che aspetta il bot. */
function risolvePendingAction(game) {
  const pa = game.pendingAction;
  const bot = game.players.find((p) => p.id === pa.playerId);

  switch (pa.type) {
    case 'awaiting_card':
      game.acknowledgeCard(bot.id);
      return 'carta';

    case 'awaiting_rent':
      game.payRent(bot.id);
      return 'affitto';

    case 'awaiting_tax':
      game.payTax(bot.id);
      return 'tassa';

    case 'awaiting_debt':
      // La liquidazione automatica del motore vende gli edifici e ipoteca
      // sacrificando i monopoli per ultimi: è già la strategia giusta.
      game.resolveDebtAuto(bot.id);
      return 'debito';

    case 'awaiting_buy': {
      const square = board[pa.position];
      const punteggio = propertyScore(game, bot.id, square, bot.balance);
      // Margine casuale del ±10% sulla soglia: due situazioni quasi identiche
      // non danno sempre la stessa decisione, come per un giocatore vero.
      const soglia = (Math.random() - 0.5) * 0.2;
      if (punteggio > soglia && bot.balance - square.price >= RISERVA) {
        game.buyProperty(bot.id);
        return 'acquisto';
      }
      game.declineBuy(bot.id);
      return 'rifiuto';
    }

    case 'awaiting_trade':
      game.respondTrade(bot.id, evaluateTrade(game, bot.id, pa));
      return 'risposta-scambio';

    case 'awaiting_auction': {
      const square = board[pa.position];
      // La soglia la dice il motore: qui non si ricalcola. Duplicarla è già
      // costato caro una volta — quando il rilancio minimo è diventato
      // proporzionale al listino, questo punto continuava a offrire 10, il
      // motore rifiutava, il rifiuto non cambiava lo stato e toccava di nuovo
      // allo stesso bot, all'infinito.
      const minBid = pa.minBid;
      const tetto = tettoAsta(game, bot, square);
      // Non rilancia se supera il proprio tetto, o se non se lo può proprio
      // permettere: passare è sempre lecito, anche per chi ha appena rinunciato.
      if (minBid > tetto || minBid > bot.balance) {
        game.passAuction(bot.id);
        return 'asta-passo';
      }
      // Se per qualunque ragione il rilancio viene rifiutato, si passa invece
      // di riprovare: un'offerta respinta non muove lo stato, e ritentarla
      // bloccherebbe la partita per tutti.
      if (game.bidAuction(bot.id, minBid).error) {
        game.passAuction(bot.id);
        return 'asta-passo';
      }
      return 'asta-rilancio';
    }

    default:
      return false;
  }
}

/**
 * Quanto è disposto a spendere un bot per aggiudicarsi una casella all'asta.
 * Si parte da propertyScore, lo stesso giudizio usato per decidere se
 * comprare al listino: un punteggio alto (vicino a un monopolio) alza il
 * tetto anche oltre il prezzo di listino, uno basso lo tiene comunque un po'
 * sopra zero, perché in un'asta il prezzo può scendere molto sotto il
 * listino e vale la pena tentare. La casualità (±15%) evita che due bot con
 * lo stesso punteggio si fermino sempre alla cifra identica.
 */
function tettoAsta(game, bot, square) {
  const punteggio = propertyScore(game, bot.id, square, bot.balance);
  const interesse = Math.max(0.15, 0.5 + punteggio * 0.5);
  const casualita = 0.85 + Math.random() * 0.3;
  const tetto = Math.round(square.price * interesse * casualita);
  // Non si scende mai sotto la riserva di sicurezza: un'asta persa per una
  // casella non deve lasciare il bot senza contanti per gli affitti altrui.
  return Math.max(0, Math.min(tetto, bot.balance - RISERVA));
}

/** Una mossa del turno del bot: prigione, costruzione, scambio, dadi. */
function giocaIlTurno(game) {
  const bot = game.currentPlayer;

  if (bot.inJail) return gestisciPrigione(game, bot);

  if (!haTirato(game, bot)) {
    // Costruzioni e proposte di scambio vanno fatte PRIMA di tirare: appena un
    // tiro non-doppio si risolve, il motore chiude il turno da solo
    // (finishRoll -> endTurn), quindi la finestra "ho tirato, adesso
    // costruisco" non esiste. È anche l'ordine più naturale da guardare:
    // sistemo le mie cose, poi muovo.
    if (provaACostruire(game, bot)) return 'costruzione';
    if (provaAProporreScambio(game, bot)) return 'scambio';
    game.rollDice(bot.id);
    return 'tiro';
  }

  // Ha tirato un doppio: il motore ha lasciato il turno aperto apposta e gli
  // spetta un altro tiro.
  if (!game.turnResolved && game.lastRollWasDouble) {
    game.rollDice(bot.id);
    return 'tiro';
  }

  // Rete di sicurezza: se si arriva qui col turno ancora aperto lo si chiude.
  // endTurn del motore non controlla di chi sia il turno (per gli umani lo fa
  // il gestore socket), quindi lo si verifica qui.
  if (game.currentPlayer?.id === bot.id) game.endTurn();
  return 'fine-turno';
}

/**
 * Ha già tirato i dadi in questo turno? Due segnali concordi: `turnResolved`
 * torna true a ogni endTurn, quindi a inizio turno vale ancora true; e l'ultimo
 * tiro registrato deve essere suo. A partita appena iniziata `lastRoll` è null
 * e la risposta è comunque "no".
 */
function haTirato(game, bot) {
  if (game.turnResolved) return false;
  return !!game.lastRoll && game.lastRoll.playerId === bot.id;
}

// Ricorda dopo quale tiro ogni bot ha già costruito, così non tira su un
// intero quartiere in un colpo solo facendo aspettare gli altri. La chiave è
// debole sulla partita: quando la partita sparisce, sparisce anche l'appunto.
const ultimaCostruzione = new WeakMap();

function haGiaCostruito(game, bot) {
  const mappa = ultimaCostruzione.get(game) || {};
  // Si usa rollCount e non lastRoll?.seq: lastRoll sparisce a fine turno (il
  // tabellone non deve più mostrare il tiro di chi ha già giocato), ma questo
  // controllo deve continuare a funzionare anche a lastRoll già azzerato.
  return mappa[bot.id] === game.rollCount;
}

function segnaCostruito(game, bot) {
  const mappa = ultimaCostruzione.get(game) || {};
  mappa[bot.id] = game.rollCount;
  ultimaCostruzione.set(game, mappa);
}

/** In prigione: carta, multa o tentativo coi dadi. */
function gestisciPrigione(game, bot) {
  if (bot.jailCards > 0) {
    game.useJailCard(bot.id);
    return 'prigione';
  }
  // Con case in giro conviene uscire subito e incassare; a inizio partita
  // restare dentro è quasi un vantaggio. Nel 20% dei casi tenta comunque i
  // dadi anche potendo pagare: un umano ogni tanto rischia per gusto.
  const puoPagare = bot.balance - 50 >= RISERVA;
  if (puoPagare && Math.random() > 0.2) {
    game.payJailFine(bot.id);
    return 'prigione';
  }
  game.rollDice(bot.id);
  return 'tiro';
}

/** Costruisce al massimo una casa per turno, se la cassa lo consente. */
function provaACostruire(game, bot) {
  if (haGiaCostruito(game, bot)) return false;

  const candidate = game.propertiesOf(bot.id)
    .filter(({ square, owned }) =>
      square.type === 'property' &&
      !owned.mortgaged &&
      game.ownsFullGroup(bot.id, square.group) &&
      // Il costo vero della prossima unità, non square.houseCost fisso: con
      // la modalità grattacieli il 2°-4° hotel costano molto più di una
      // casa (vedi nextBuildingCost in gameEngine.js). Per una casa o il
      // primo hotel il costo coincide con houseCost, quindi qui il filtro si
      // comporta esattamente come prima — cambia solo per i livelli di
      // hotel oltre il primo, che senza questo controllo sarebbero stati
      // ammessi come candidati anche quando il bot non può permetterseli.
      bot.balance - game.nextBuildingCost(square, owned) >= RISERVA + 100
    )
    // Prima i gruppi che rendono di più.
    .sort((a, b) => (b.square.rents[1] || 0) - (a.square.rents[1] || 0));

  for (const { position } of candidate) {
    // buildHouse rifiuta da sé se l'edificazione non è uniforme o se c'è
    // un'ipoteca sul colore: basta provare e guardare l'esito.
    if (!game.buildHouse(bot.id, position).error) {
      segnaCostruito(game, bot);
      return true;
    }
  }
  return false;
}

/**
 * Ogni tanto propone uno scambio che gli completerebbe un monopolio, offrendo
 * denaro e una propria proprietà di scarto di valore comparabile. Se non trova
 * nulla di onesto da offrire, lascia perdere: niente proposte a vuoto.
 */
function provaAProporreScambio(game, bot) {
  if (game.pendingAction) return false;
  if (Math.random() > 0.3) return false;

  // I candidati si ordinano per quanto rende il colore, non per dove capitano
  // sul tabellone: prima si prova a chiudere gli arancioni, poi i marroni. Il
  // vecchio ciclo scorreva `board` in ordine e prendeva la prima casella utile,
  // che è anche il motivo per cui rifaceva sempre la stessa identica offerta.
  const candidati = board
    .filter((square) => {
      if (!square.group) return false;
      const owned = game.ownership[square.position];
      if (!owned || owned.ownerId === bot.id) return false;
      const proprietario = game.players.find((p) => p.id === owned.ownerId);
      if (!proprietario || proprietario.bankrupt) return false;
      // Serve che sia l'ultima casella mancante per completare il colore.
      const gruppo = board.filter((s) => s.group === square.group);
      const mie = gruppo.filter(
        (s) => s.position !== square.position && game.ownership[s.position]?.ownerId === bot.id
      ).length;
      return mie === gruppo.length - 1;
    })
    .sort((a, b) => groupWeight(b.group) - groupWeight(a.group));

  for (const square of candidati) {
    const proprietario = game.players.find(
      (p) => p.id === game.ownership[square.position].ownerId
    );

    // Merce di scambio: una propria proprietà fuori dai colori già completi, e
    // che non completi un colore a chi la riceve. Cedere per sbaglio la casella
    // che mancava all'avversario vale molto più di quanto si incassa.
    const scarto = game.propertiesOf(bot.id)
      .filter(({ square: s, owned: o }) =>
        !o.mortgaged && o.houses === 0 && !o.hotels &&
        (!s.group || !game.ownsFullGroup(bot.id, s.group)) &&
        !regalaMonopolio(game, proprietario.id, [s.position])
      )
      .sort((a, b) => (a.square.price || 0) - (b.square.price || 0))[0];

    // Quanto spingersi sopra il listino: un colore che rende molto merita di
    // essere pagato caro, e con la cassa piena ci si può permettere di insistere.
    const generosita = 1.1 + groupWeight(square.group) * 0.15 + (bot.balance > 800 ? 0.2 : 0);
    const target = Math.round(square.price * generosita);
    const valoreScarto = scarto ? scarto.square.price : 0;
    const denaro = Math.max(0, Math.min(bot.balance - RISERVA, target - valoreScarto));
    const valoreOfferto = denaro + valoreScarto;
    if (valoreOfferto < square.price) continue; // non può permetterselo

    // Non si ripropone lo stesso baratto a chi l'ha appena rifiutato. Si torna
    // alla carica solo con un'offerta sensibilmente migliore — un terzo in più
    // — che è quello che farebbe una persona: insistere sì, ma alzando.
    const chiave = `${proprietario.id}:${square.position}`;
    const precedente = offertaPrecedente(game, chiave);
    if (precedente !== null && valoreOfferto <= precedente * 1.3) continue;

    const res = game.proposeTrade(bot.id, {
      toId: proprietario.id,
      offerProperties: scarto ? [scarto.position] : [],
      offerMoney: denaro,
      requestProperties: [square.position],
    });
    if (!res.error) {
      segnaProposta(game, chiave, valoreOfferto);
      return true;
    }
  }
  return false;
}

// Quanto valeva l'ultima offerta fatta per una certa casella a un certo
// giocatore. Senza questa memoria il bot ricalcolava ogni turno la stessa
// proposta — il calcolo è deterministico — e la ripeteva finché il tavolo non
// cambiava, che è il motivo per cui sembrava un disco rotto.
const offerteFatte = new WeakMap();

function offertaPrecedente(game, chiave) {
  const fatte = offerteFatte.get(game);
  return fatte && fatte.has(chiave) ? fatte.get(chiave) : null;
}

function segnaProposta(game, chiave, valore) {
  const fatte = offerteFatte.get(game) || new Map();
  fatte.set(chiave, valore);
  offerteFatte.set(game, fatte);
}

module.exports = { botMove, botHasMove, isBotTurn, botMustAnswer };
