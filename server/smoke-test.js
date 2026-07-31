// Smoke test del motore di gioco. Nessun framework: si lancia con `node smoke-test.js`
// dalla cartella server. Va eseguito prima e dopo ogni modifica sostanziale a
// gameEngine.js, come da convenzioni del progetto.
const { GameEngine, SKIP_TURN_DELAY_MS } = require('./src/gameEngine');
const { board } = require('./src/data/board');
const { groupWeight, propertyScore, evaluateTrade, regalaMonopolio } = require('./src/botStrategy');
const { botMove, isBotTurn } = require('./src/bot');

let passed = 0;
let failed = 0;

function check(description, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${description}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${description}${extra ? ` — ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/**
 * Partita a due pronta al via, con saldi impostati a piacere. `skyscraper`
 * accende la modalità grattacieli prima del via (le regole si scelgono solo
 * lì, vedi setRules): di default resta spenta, così ogni test già scritto
 * prima di questa regola continua a girare esattamente come prima.
 */
function newGame({ balanceA = 1500, balanceB = 1500, skyscraper = false } = {}) {
  const game = new GameEngine('TEST');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  if (skyscraper) game.setRules('a', { skyscraperEnabled: true });
  game.start();
  game.players[0].balance = balanceA;
  game.players[1].balance = balanceB;
  return game;
}

/** Assegna una casella a un giocatore senza passare dall'acquisto. */
function give(game, playerId, position, extra = {}) {
  game.ownership[position] = { ownerId: playerId, houses: 0, hotels: 0, mortgaged: false, ...extra };
}

/**
 * Fa passare tutti quelli in coda in un'asta aperta, così la casella resta
 * libera. Serve ai test più vecchi di questa regola, che rinunciano a una
 * proprietà per esercitare altro (i doppi, la prigione) e si aspettano che
 * dopo la rinuncia il tiro riprenda subito, come prima che rinunciare aprisse
 * un'asta.
 */
function passAuction(game) {
  while (game.pendingAction?.type === 'awaiting_auction') {
    game.passAuction(game.pendingAction.playerId);
  }
}

// Le tre caselle arancioni: monopolio comodo per i test sull'edificazione.
const ORANGE = board.filter((s) => s.group === 'orange').map((s) => s.position);
const BROWN = board.filter((s) => s.group === 'brown').map((s) => s.position);
// Le due blu: BLUE[0] è Viale dei Giardini, BLUE[1] è Parco della Vittoria (39,
// l'esempio citato nella regola della modalità grattacieli). Un monopolio di
// due sole caselle è comodo per i test sui quattro livelli di hotel: bastano
// due costruzioni per pareggiare il gruppo a ogni livello, invece di tre.
const BLUE = board.filter((s) => s.group === 'blue').map((s) => s.position);

// ---------------------------------------------------------------------------
section('1. Edificazione uniforme');
{
  const game = newGame();
  ORANGE.forEach((pos) => give(game, 'a', pos));

  check('la prima casa è consentita', !game.buildHouse('a', ORANGE[0]).error);
  const second = game.buildHouse('a', ORANGE[0]);
  check('la seconda casa sulla stessa casella è rifiutata', !!second.error, second.error);
  check('la casa su una casella al minimo è consentita', !game.buildHouse('a', ORANGE[1]).error);
  check(
    'la casa sulla terza casella pareggia il gruppo',
    !game.buildHouse('a', ORANGE[2]).error
  );
  check(
    'ora la seconda casa sulla prima casella è consentita',
    !game.buildHouse('a', ORANGE[0]).error
  );
}

section('2. Vendita uniforme');
{
  const game = newGame();
  ORANGE.forEach((pos) => give(game, 'a', pos, { houses: 1 }));
  game.ownership[ORANGE[0]].houses = 2;

  const fromMin = game.sellHouse('a', ORANGE[1]);
  check('vendere da una casella al minimo è rifiutato', !!fromMin.error, fromMin.error);
  check('vendere da quella al massimo è consentito', !game.sellHouse('a', ORANGE[0]).error);
}

section('3. Costruzione con ipoteche nel gruppo');
{
  const game = newGame();
  ORANGE.forEach((pos) => give(game, 'a', pos));
  game.ownership[ORANGE[2]].mortgaged = true;

  const res = game.buildHouse('a', ORANGE[0]);
  check('non si costruisce su un colore con ipoteche', !!res.error, res.error);
}

section('4. Monopolio incompleto');
{
  const game = newGame();
  give(game, 'a', ORANGE[0]);
  const res = game.buildHouse('a', ORANGE[0]);
  check('serve il monopolio per costruire', !!res.error, res.error);
}

// ---------------------------------------------------------------------------
section('5. Debito coperto dal patrimonio');
{
  // Arancioni: ipotecabili per 90 + 90 + 100 = 280, quindi 250 di scoperto si copre.
  const game = newGame({ balanceA: 100 });
  ORANGE.forEach((pos) => give(game, 'a', pos));
  const mario = game.players[0];

  game.chargePlayer(mario, 350);
  check('si apre un debito invece della bancarotta', game.pendingAction?.type === 'awaiting_debt');
  check('il debito è pari allo scoperto', game.pendingAction?.amount === 250, `amount=${game.pendingAction?.amount}`);
  check('il giocatore non è fallito', !mario.bankrupt);

  const rolled = game.rollDice('a');
  check('con un debito aperto non si tirano i dadi', !!rolled.error, rolled.error);
  const ended = game.endTurn();
  check('con un debito aperto non si chiude il turno', !!ended.error, ended.error);

  game.resolveDebtAuto('a');
  check('la liquidazione automatica riporta il saldo in pari', mario.balance >= 0, `saldo=${mario.balance}`);
  check('il debito è chiuso', game.pendingAction === null);
  check('il giocatore è ancora in gioco', !mario.bankrupt);
  check(
    'qualche proprietà è stata ipotecata',
    ORANGE.some((pos) => game.ownership[pos]?.mortgaged)
  );
}

section('6. Ordine di liquidazione: prima gli edifici, monopoli per ultimi');
{
  // 3 case (50 di rimborso l'una = 150) + 2 stazioni (100 d'ipoteca l'una = 200):
  // uno scoperto di 300 si copre senza toccare il monopolio arancione.
  const game = newGame({ balanceA: 0 });
  ORANGE.forEach((pos) => give(game, 'a', pos, { houses: 1 }));
  give(game, 'a', 5); // Stazione Sud, fuori da ogni monopolio
  give(game, 'a', 15); // Stazione Ovest, idem
  const mario = game.players[0];

  game.chargePlayer(mario, 300);
  game.resolveDebtAuto('a');

  check('gli edifici sono stati venduti per primi', ORANGE.every((pos) => game.ownership[pos].houses === 0));
  check(
    'le stazioni fuori monopolio sono state ipotecate',
    game.ownership[5].mortgaged === true && game.ownership[15].mortgaged === true
  );
  check(
    'il monopolio arancione non è stato ipotecato',
    ORANGE.every((pos) => !game.ownership[pos].mortgaged)
  );
}

section('7. Debito superiore al patrimonio');
{
  const game = newGame({ balanceA: 50 });
  give(game, 'a', BROWN[0]); // vale 60, ipotecabile per 30
  const mario = game.players[0];
  const giulia = game.players[1];
  const before = giulia.balance;

  game.chargePlayer(mario, 5000, giulia);
  check('nessun debito in sospeso: è bancarotta diretta', game.pendingAction === null);
  check('il giocatore è fallito', mario.bankrupt);
  check('il saldo del fallito è azzerato', mario.balance === 0);
  check(
    'il creditore incassa solo quanto esisteva davvero',
    giulia.balance === before + 50,
    `atteso ${before + 50}, ottenuto ${giulia.balance}`
  );
  check('la proprietà è passata al creditore', game.ownership[BROWN[0]].ownerId === 'b');
  check('la partita è finita', game.finished === true);
  check('il vincitore è il creditore', game.winnerId === 'b');
}

section('8. Bancarotta verso la banca');
{
  const game = newGame({ balanceA: 10 });
  give(game, 'a', BROWN[0]);
  const mario = game.players[0];

  game.chargePlayer(mario, 5000); // nessun creditore: tassa
  check('il giocatore è fallito', mario.bankrupt);
  check('la casella torna libera', game.ownership[BROWN[0]] === undefined);
}

section('9. Interesse del 10% sulle ipoteche ereditate');
{
  const game = newGame({ balanceA: 0, balanceB: 1000 });
  // Vicolo Stretto: prezzo 60, valore d'ipoteca 30, interesse dovuto 3.
  give(game, 'a', BROWN[1], { mortgaged: true });
  const mario = game.players[0];
  const giulia = game.players[1];

  game.chargePlayer(mario, 500, giulia);
  check('il giocatore è fallito', mario.bankrupt);
  check('l\'ipoteca resta sulla proprietà ereditata', game.ownership[BROWN[1]].mortgaged === true);
  // 1000 +500 incassati da chargePlayer -500 restituiti (il debitore non li aveva)
  // -3 di interessi sull'ipoteca ereditata = 997.
  check('il creditore ha pagato 3 di interessi', giulia.balance === 997, `saldo=${giulia.balance}`);
}

section('9b. Costo di riscatto senza errori di virgola mobile');
{
  const game = newGame();
  // Stazione Sud: prezzo 200, ipoteca 100, interesse 10, riscatto 110.
  // Con `100 * 1.1` in floating point verrebbe 111.
  const station = board[5];
  check('riscatto di 110 su un\'ipoteca da 100', game.unmortgageCost(station) === 110, `${game.unmortgageCost(station)}`);
  check('interesse di 10 su un\'ipoteca da 100', game.mortgageInterest(station) === 10);

  give(game, 'a', 5, { mortgaged: true });
  game.players[0].balance = 110;
  check('con esattamente 110 il riscatto passa', !game.unmortgageProperty('a', 5).error);
  check('il saldo torna a zero', game.players[0].balance === 0, `saldo=${game.players[0].balance}`);
}

section('10. Resa volontaria');
{
  const game = newGame({ balanceA: 0 });
  ORANGE.forEach((pos) => give(game, 'a', pos));
  const mario = game.players[0];
  const giulia = game.players[1];

  game.chargePlayer(mario, 200, giulia);
  check('il debito è risolvibile', game.pendingAction?.type === 'awaiting_debt');
  check('la resa è accettata', !game.declareBankruptcy('a').error);
  check('il giocatore è fallito', mario.bankrupt);
  check('la partita è finita', game.finished === true);
}

// ---------------------------------------------------------------------------
section('10b. Scambio: proposta e accettazione');
{
  const game = newGame({ balanceA: 500, balanceB: 500 });
  give(game, 'a', ORANGE[0]);
  give(game, 'b', BROWN[0]);
  const [mario, giulia] = game.players;

  const res = game.proposeTrade('a', {
    toId: 'b',
    offerProperties: [ORANGE[0]],
    offerMoney: 100,
    requestProperties: [BROWN[0]],
    requestMoney: 0,
  });
  check('la proposta è accettata dal motore', !res.error, res.error);
  check('si apre uno scambio in sospeso', game.pendingAction?.type === 'awaiting_trade');
  check('tocca al destinatario rispondere', game.pendingAction?.playerId === 'b');

  const wrongResponder = game.respondTrade('a', true);
  check('il proponente non può rispondere da solo', !!wrongResponder.error, wrongResponder.error);
  const rolled = game.rollDice('a');
  check('con uno scambio aperto non si tirano i dadi', !!rolled.error, rolled.error);
  const built = game.mortgageProperty('a', ORANGE[0]);
  check('le proprietà sono congelate durante lo scambio', !!built.error, built.error);

  game.respondTrade('b', true);
  check('la proprietà offerta è passata al destinatario', game.ownership[ORANGE[0]].ownerId === 'b');
  check('la proprietà richiesta è passata al proponente', game.ownership[BROWN[0]].ownerId === 'a');
  check('il denaro è stato trasferito', mario.balance === 400 && giulia.balance === 600, `${mario.balance}/${giulia.balance}`);
  check('lo scambio è chiuso', game.pendingAction === null);
  check('il turno non è cambiato', game.turnIndex === 0);
}

section('10c. Scambio: rifiuto e vincoli');
{
  const game = newGame();
  ORANGE.forEach((pos) => give(game, 'a', pos));
  give(game, 'b', BROWN[0]);
  game.ownership[ORANGE[0]].houses = 1;

  const withBuildings = game.proposeTrade('a', { toId: 'b', offerProperties: [ORANGE[1]] });
  check(
    'non si cede una proprietà con edifici sul colore',
    !!withBuildings.error,
    withBuildings.error
  );

  const notMine = game.proposeTrade('a', { toId: 'b', offerProperties: [BROWN[0]] });
  check('non si offre una proprietà altrui', !!notMine.error, notMine.error);

  const tooRich = game.proposeTrade('a', { toId: 'b', offerMoney: 99999 });
  check('non si offre denaro che non si ha', !!tooRich.error, tooRich.error);

  const empty = game.proposeTrade('a', { toId: 'b' });
  check('uno scambio vuoto è rifiutato', !!empty.error, empty.error);

  game.proposeTrade('a', { toId: 'b', requestProperties: [BROWN[0]], offerMoney: 50 });
  game.respondTrade('b', false);
  check('dopo il rifiuto lo scambio è chiuso', game.pendingAction === null);
  check('il rifiuto non muove nulla', game.ownership[BROWN[0]].ownerId === 'b');
  check('il rifiuto non muove denaro', game.players[0].balance === 1500);
}

section('10d. Scambio: interesse sulle ipoteche ricevute');
{
  const game = newGame({ balanceA: 500, balanceB: 500 });
  // Vicolo Stretto: prezzo 60, ipoteca 30, interesse 3.
  give(game, 'a', BROWN[1], { mortgaged: true });

  game.proposeTrade('a', { toId: 'b', offerProperties: [BROWN[1]], requestMoney: 100 });
  game.respondTrade('b', true);

  check('la proprietà è passata', game.ownership[BROWN[1]].ownerId === 'b');
  check('resta ipotecata', game.ownership[BROWN[1]].mortgaged === true);
  check(
    'chi la riceve paga 3 di interessi',
    game.players[1].balance === 500 - 100 - 3,
    `saldo=${game.players[1].balance}`
  );
  check('il proponente incassa i 100 richiesti', game.players[0].balance === 600);
}

section('10i. Scambio di carte "esci di prigione" e pedoni unici');
{
  const game = newGame();
  const [mario, giulia] = game.players;
  mario.jailCards = 2;

  const troppe = game.proposeTrade('a', { toId: 'b', offerJailCards: 3 });
  check('non si offrono più carte di quante se ne hanno', !!troppe.error, troppe.error);

  game.proposeTrade('a', { toId: 'b', offerJailCards: 1, requestMoney: 60 });
  game.respondTrade('b', true);
  check('la carta è passata', mario.jailCards === 1 && giulia.jailCards === 1, `${mario.jailCards}/${giulia.jailCards}`);
  check('il denaro è passato', mario.balance === 1560 && giulia.balance === 1440, `${mario.balance}/${giulia.balance}`);

  // Pedoni: due giocatori non possono avere lo stesso.
  const dup = new GameEngine('DUP');
  check('il primo pedone è accettato', !dup.addPlayer('x', 'Mario', '🎩').error);
  const taken = dup.addPlayer('y', 'Giulia', '🎩');
  check('il pedone duplicato è rifiutato', !!taken.error, taken.error);
  check('l\'errore riporta i pedoni occupati', Array.isArray(taken.takenTokens) && taken.takenTokens.includes('🎩'));
  check('un pedone libero è accettato', !dup.addPlayer('y', 'Giulia', '🐕').error);
  check('i giocatori al tavolo sono due', dup.players.length === 2);
}

section('10e. Tre doppi consecutivi mandano in prigione');
{
  const game = newGame();
  const mario = game.players[0];

  // Dadi truccati: due doppi e poi il terzo. Le caselle di arrivo (4 tassa,
  // 8 proprietà libera) sono scelte apposta perché non facciano pescare una
  // carta: un "vai in prigione" da Imprevisti azzererebbe il contatore e
  // renderebbe il test instabile. La prigione (10) non coincide né con la
  // posizione di partenza (8) né con l'arrivo del terzo tiro (18).
  let rolls = [[2, 2], [2, 2], [5, 5]];
  let i = 0;
  const realRandom = Math.random;
  Math.random = () => {
    // rollDice consuma due valori per tiro: li si serve dalla coppia corrente.
    const pair = rolls[Math.min(i >> 1, rolls.length - 1)];
    const value = pair[i % 2];
    i += 1;
    return (value - 1) / 6 + 0.001;
  };

  // Il tiro può fermarsi su una proprietà libera o su una tassa: si risolve
  // subito, così il turno prosegue e col doppio il tiro extra spetta comunque.
  const rollAndDecline = () => {
    game.rollDice('a');
    if (game.pendingAction?.type === 'awaiting_buy') {
      game.declineBuy('a');
      passAuction(game); // nessuno offre: la casella resta libera come prima
    }
    if (game.pendingAction?.type === 'awaiting_tax') game.payTax('a');
    if (game.pendingAction?.type === 'awaiting_rent') game.payRent('a');
  };

  rollAndDecline();
  check('dopo il primo doppio si conta 1', mario.doublesInARow === 1, `${mario.doublesInARow}`);
  check('dopo il primo doppio è ancora il suo turno', game.currentPlayer.id === 'a');
  rollAndDecline();
  const posDopoDue = mario.position;
  check('dopo il secondo doppio si conta 2', mario.doublesInARow === 2, `${mario.doublesInARow}`);
  check('dopo il secondo doppio è ancora il suo turno', game.currentPlayer.id === 'a');

  game.rollDice('a');
  check('al terzo doppio finisce in prigione', mario.inJail === true);
  check(
    'ci va senza muoversi: è in prigione, non dove lo portava il tiro',
    mario.position === 10 && posDopoDue + 10 !== 10,
    `posizione=${mario.position}, il tiro portava a ${posDopoDue + 10}`
  );
  check('il contatore è azzerato', mario.doublesInARow === 0);
  check('il turno passa all\'avversario', game.currentPlayer.id === 'b');

  Math.random = realRandom;
}

section('10g. Il tiro extra del doppio sopravvive a un acquisto');
{
  const game = newGame();
  const mario = game.players[0];

  // 3+3 porta su The Angel Islington (casella 6), libera: si apre l'acquisto.
  const realRandom = Math.random;
  Math.random = () => 0.4; // 1 + floor(0.4 * 6) = 3

  game.rollDice('a');
  check('l\'acquisto è in sospeso', game.pendingAction?.type === 'awaiting_buy');
  check('il turno non è ancora passato', game.currentPlayer.id === 'a');

  game.buyProperty('a');
  check('dopo l\'acquisto il doppio dà comunque il tiro extra', game.currentPlayer.id === 'a');
  check('nessuna azione in sospeso', game.pendingAction === null);

  Math.random = realRandom;
}

section('10h. Uscire di prigione col doppio non dà il tiro extra');
{
  const game = newGame();
  const mario = game.players[0];
  mario.inJail = true;
  mario.position = 10;

  const realRandom = Math.random;
  Math.random = () => 0.5; // 4 e 4: doppio
  game.rollDice('a');
  if (game.pendingAction?.type === 'awaiting_buy') {
    game.declineBuy('a');
    passAuction(game);
  }
  Math.random = realRandom;

  check('esce di prigione', mario.inJail === false);
  check('ma il turno passa comunque', game.currentPlayer.id === 'b', `turno di ${game.currentPlayer.name}`);
}

section('10f. Il contatore dei doppi non attraversa i turni');
{
  const game = newGame();
  const mario = game.players[0];
  mario.doublesInARow = 2;
  game.endTurn();
  check('chiudere il turno azzera i doppi', mario.doublesInARow === 0);
}

// ---------------------------------------------------------------------------
section('11. Conservazione del denaro fra giocatori');
{
  const game = newGame();
  const total = () => game.players.reduce((sum, p) => sum + p.balance, 0);
  const before = total();
  const [mario, giulia] = game.players;

  game.chargePlayer(mario, 300, giulia);
  game.chargePlayer(giulia, 120, mario);
  check('i trasferimenti fra giocatori non creano denaro', total() === before, `${before} -> ${total()}`);
}

section('12. Partita simulata, 300 turni');
{
  const game = newGame();
  let crashed = null;
  try {
    for (let i = 0; i < 300 && !game.finished; i++) {
      const current = game.currentPlayer;
      if (!current) break;

      // Tassa dovuta: va confermata come l'affitto.
      if (game.pendingAction?.type === 'awaiting_tax') {
        game.payTax(game.pendingAction.playerId);
        continue;
      }

      // Affitto dovuto: va confermato, altrimenti il turno resta bloccato.
      if (game.pendingAction?.type === 'awaiting_rent') {
        game.payRent(game.pendingAction.playerId);
        continue;
      }

      // Carta pescata: va confermata, altrimenti il turno resta bloccato.
      if (game.pendingAction?.type === 'awaiting_card') {
        game.acknowledgeCard(game.pendingAction.playerId);
        continue;
      }

      // Debito in sospeso: metà delle volte si liquida, metà ci si arrende.
      if (game.pendingAction?.type === 'awaiting_debt') {
        const debtor = game.pendingAction.playerId;
        if (Math.random() < 0.8) game.resolveDebtAuto(debtor);
        else game.declareBankruptcy(debtor);
        continue;
      }

      // Asta in sospeso: chi tocca rilancia al minimo se se lo può permettere
      // ed è dell'umore giusto, altrimenti passa. Esercita anche il caso in
      // cui l'asta gira per più mosse prima di chiudersi da sé.
      if (game.pendingAction?.type === 'awaiting_auction') {
        const bidderId = game.pendingAction.playerId;
        const bidder = game.players.find((p) => p.id === bidderId);
        // Il minimo non è più fisso: si legge quello esposto dal motore
        // (game.pendingAction.minBid), calcolato sul listino della casella.
        const minBid = game.pendingAction.minBid;
        if (bidder && minBid <= bidder.balance && Math.random() < 0.5) {
          game.bidAuction(bidderId, minBid);
        } else {
          game.passAuction(bidderId);
        }
        continue;
      }

      game.rollDice(current.id);

      if (game.pendingAction?.type === 'awaiting_buy') {
        const who = game.pendingAction.playerId;
        if (Math.random() < 0.7) game.buyProperty(who);
        else game.declineBuy(who);
      }

      // Ogni tanto si costruisce, per esercitare la regola dell'uniformità.
      if (Math.random() < 0.3) {
        const mine = game.propertiesOf(current.id);
        const target = mine[Math.floor(Math.random() * mine.length)];
        if (target) game.buildHouse(current.id, target.position);
      }
    }
  } catch (err) {
    crashed = err;
  }

  check('nessun crash in 300 turni', crashed === null, crashed && crashed.stack);
  check(
    'nessun saldo negativo fuori da un debito aperto',
    game.players.every((p) => p.balance >= 0 || game.pendingAction?.playerId === p.id),
    game.players.map((p) => `${p.name}=${p.balance}`).join(', ')
  );
  check(
    'nessun gruppo edificato in modo non uniforme',
    board
      .filter((s) => s.type === 'property')
      .every((s) => {
        const counts = game.groupUnitCounts(s.group);
        return Math.max(...counts) - Math.min(...counts) <= 1;
      })
  );
  check(
    'se la partita è finita c\'è un vincitore',
    !game.finished || !!game.winnerId
  );
}

// ---------------------------------------------------------------------------
section('14. "Avanza fino a" va sempre in avanti, mai indietro');
{
  const game = newGame();
  const mario = game.players[0];
  // Largo Colombo è la casella 24. Partendo dalla 30 la meta è alle spalle:
  // si deve fare il giro passando dal Via, non tornare indietro di 6.
  mario.position = 30;
  const saldoPrima = mario.balance;
  game.chanceDeck = [{ text: 'Vai a Largo Colombo.', action: 'advance_to', target: 24 }];

  game.drawCard(mario, 'chance');
  check('la carta resta in attesa di lettura', game.pendingAction?.type === 'awaiting_card');
  game.acknowledgeCard('a');

  check('arriva a destinazione', mario.position === 24, `posizione=${mario.position}`);
  check(
    'ha incassato il Via facendo il giro',
    mario.balance === saldoPrima + 500,
    `${saldoPrima} -> ${mario.balance}`
  );
}

section('15. Passaggio dal Via a 500');
{
  const game = newGame();
  const mario = game.players[0];
  mario.position = 38;
  const prima = mario.balance;
  game.movePlayer(mario, 4); // 38 -> 2, quindi passa dal Via
  check('il Via vale 500', mario.balance === prima + 500, `+${mario.balance - prima}`);

  // "Vai indietro" non passa dal Via e non deve pagare nulla.
  const g2 = newGame();
  const m2 = g2.players[0];
  m2.position = 2;
  const prima2 = m2.balance;
  g2.chanceDeck = [{ text: 'Vai indietro di 3 caselle.', action: 'move_back', spaces: 3 }];
  g2.drawCard(m2, 'chance');
  g2.acknowledgeCard('a');
  check('tornare indietro porta alla casella 39', m2.position === 39, `posizione=${m2.position}`);
  check('e non fa incassare il Via', m2.balance === prima2, `saldo=${m2.balance}`);
}

section('16. La carta va letta prima di applicarsi');
{
  const game = newGame();
  const mario = game.players[0];
  mario.position = 5;
  const prima = mario.balance;
  game.chanceDeck = [{ text: 'La banca ti paga un dividendo di 50.', action: 'collect', amount: 50 }];

  game.drawCard(mario, 'chance');
  check('il testo della carta è nello stato', game.pendingAction?.text?.includes('dividendo'));
  check('l\'effetto non è ancora applicato', mario.balance === prima, `saldo=${mario.balance}`);

  const rolled = game.rollDice('a');
  check('con una carta in sospeso non si tirano i dadi', !!rolled.error, rolled.error);
  const ended = game.endTurn();
  check('e non si chiude il turno', !!ended.error, ended.error);
  const altro = game.acknowledgeCard('b');
  check('solo il pescatore può confermare', !!altro.error, altro.error);

  game.acknowledgeCard('a');
  check('dopo la conferma l\'effetto è applicato', mario.balance === prima + 50);
  check('la carta è chiusa', game.pendingAction === null);
}

section('17. Affitto raddoppiato dalla carta "stazione più vicina"');
{
  const game = newGame();
  const [mario, giulia] = game.players;
  give(game, 'b', 15); // Stazione Ovest, unica di Giulia: affitto base 25
  mario.position = 12;
  giulia.balance = 1500;
  mario.balance = 1500;

  game.chanceDeck = [{
    text: 'Vai alla stazione più vicina, paga il doppio.',
    action: 'advance_to_nearest_station',
    rentMultiplier: 2,
  }];
  game.drawCard(mario, 'chance');
  game.acknowledgeCard('a');

  check('arriva alla stazione 15', mario.position === 15, `posizione=${mario.position}`);
  check('l\'affitto è in attesa di pagamento', game.pendingAction?.type === 'awaiting_rent');
  check('l\'importo congelato è il doppio', game.pendingAction?.amount === 50, `${game.pendingAction?.amount}`);
  check('è segnalato come raddoppiato', game.pendingAction?.doubled === true);
  // Il moltiplicatore torna a 1 subito, ma l'importo era già stato congelato.
  check('il moltiplicatore è tornato a 1', game.rentMultiplier === 1);

  game.payRent('a');
  check('paga 50 invece di 25', mario.balance === 1450, `saldo=${mario.balance}`);
  check('il proprietario incassa 50', giulia.balance === 1550, `saldo=${giulia.balance}`);
}

section('17b. L\'affitto va confermato prima di essere addebitato');
{
  const game = newGame();
  const [mario, giulia] = game.players;
  give(game, 'b', ORANGE[0]); // Via Verdi, affitto base 14
  mario.position = 10;

  game.movePlayer(mario, ORANGE[0] - 10);
  check('si apre un affitto in sospeso', game.pendingAction?.type === 'awaiting_rent');
  check('nessun denaro è ancora passato', mario.balance === 1500 && giulia.balance === 1500);
  check('l\'importo è indicato', game.pendingAction?.amount === 14, `${game.pendingAction?.amount}`);
  check('è indicato il proprietario', game.pendingAction?.ownerId === 'b');

  const altro = game.payRent('b');
  check('solo chi deve pagare può confermare', !!altro.error, altro.error);
  const rolled = game.rollDice('a');
  check('con un affitto in sospeso non si tirano i dadi', !!rolled.error, rolled.error);
  const ended = game.endTurn();
  check('e non si chiude il turno', !!ended.error, ended.error);

  game.payRent('a');
  check('dopo la conferma il denaro passa', mario.balance === 1486 && giulia.balance === 1514, `${mario.balance}/${giulia.balance}`);
  check('l\'affitto è chiuso', game.pendingAction === null);
}

section('17c. Affitto insostenibile: si passa al debito');
{
  const game = newGame({ balanceA: 5 });
  const mario = game.players[0];
  give(game, 'b', ORANGE[0], { hotels: 1 }); // affitto da hotel: 950
  give(game, 'a', BROWN[0]);
  give(game, 'a', BROWN[1]);
  mario.position = 10;

  game.movePlayer(mario, ORANGE[0] - 10);
  check('l\'affitto è in sospeso', game.pendingAction?.type === 'awaiting_rent');
  game.payRent('a');
  check(
    'non potendo pagare si arriva alla bancarotta o al debito',
    mario.bankrupt || game.pendingAction?.type === 'awaiting_debt',
    JSON.stringify(game.pendingAction)
  );
}

section('17d. Niente affitto sulle ipotecate e sulle proprie');
{
  const game = newGame();
  const mario = game.players[0];
  give(game, 'b', ORANGE[0], { mortgaged: true });
  give(game, 'a', ORANGE[1]);

  mario.position = 10;
  game.movePlayer(mario, ORANGE[0] - 10);
  check('su una ipotecata non si paga', game.pendingAction === null, JSON.stringify(game.pendingAction));

  mario.position = 10;
  game.turnResolved = false;
  game.movePlayer(mario, ORANGE[1] - 10);
  check('sulla propria non si paga', game.pendingAction === null, JSON.stringify(game.pendingAction));
}

section('17e. Anche le tasse si confermano');
{
  const game = newGame();
  const mario = game.players[0];
  mario.position = 0;

  game.movePlayer(mario, 4); // Tassa patrimoniale, 200
  check('si apre una tassa in sospeso', game.pendingAction?.type === 'awaiting_tax');
  check('l\'importo è indicato', game.pendingAction?.amount === 200, `${game.pendingAction?.amount}`);
  check('nulla è ancora addebitato', mario.balance === 1500);

  const altro = game.payTax('b');
  check('solo chi deve pagare può confermare', !!altro.error, altro.error);
  const ended = game.endTurn();
  check('il turno resta bloccato', !!ended.error, ended.error);

  game.payTax('a');
  check('dopo la conferma il saldo cala', mario.balance === 1300, `saldo=${mario.balance}`);
  check('la tassa è chiusa', game.pendingAction === null);

  // Tassa di lusso, la seconda del tabellone.
  const g2 = newGame();
  g2.players[0].position = 30;
  g2.movePlayer(g2.players[0], 8); // casella 38
  check('vale anche per la tassa di lusso', g2.pendingAction?.amount === 100, `${g2.pendingAction?.amount}`);
}

section('17f. "Paga a ogni giocatore" quando i soldi non bastano per tutti');
{
  // Trovato dal test a invarianti (`fallito-e-a-zero`): la carta cicla su una
  // lista di destinatari calcolata una volta sola, e continuava a addebitare
  // anche dopo che il pagante era già fallito a metà giro. La seconda volta
  // bankruptPlayer esce subito, perché quel giocatore è già in bancarotta: il
  // saldo restava negativo invece di tornare a zero, e l'ultimo creditore
  // incassava denaro mai esistito — chargePlayer gli accredita comunque
  // l'intero importo, e il conguaglio (`creditor.balance += player.balance`,
  // che restituisce la differenza non coperta) sta dentro la bancarotta, che a
  // quel punto non viene più eseguita.
  const game = new GameEngine('PAY-EACH');
  game.addPlayer('a', 'Anna', '🎩');
  game.addPlayer('b', 'Bruno', '🐕');
  game.addPlayer('c', 'Carla', '🚗');
  game.start();
  const [anna, bruno, carla] = game.players;
  anna.balance = 30; // non basta nemmeno per il primo dei due da 50
  bruno.balance = 100;
  carla.balance = 100;
  const cassaPrima = game.players.reduce((s, p) => s + p.balance, 0);

  game.applyCard(anna, { action: 'pay_each_player', amount: 50 });

  check('chi non ce la fa fallisce', anna.bankrupt === true);
  check('e un fallito resta a saldo zero, non in rosso', anna.balance === 0, `saldo=${anna.balance}`);
  check(
    'il primo creditore incassa solo quello che c\'era davvero',
    bruno.balance === 130,
    `Bruno=${bruno.balance}, atteso 130 (i suoi 100 più i 30 di Anna)`
  );
  check(
    'e chi viene dopo non incassa denaro inesistente',
    carla.balance === 100,
    `Carla=${carla.balance}, atteso 100`
  );
  check(
    'il denaro complessivo non cambia: non se ne crea dal nulla',
    game.players.reduce((s, p) => s + p.balance, 0) === cassaPrima,
    `${cassaPrima} -> ${game.players.reduce((s, p) => s + p.balance, 0)}`
  );
}

section('18. Nessuna carta scavalca un debito già aperto');
{
  // Due arancioni ipotecabili per 90 l'una: 100 di scoperto è copribile, quindi
  // si apre un debito invece di scattare la bancarotta.
  const game = newGame({ balanceA: 100 });
  give(game, 'a', ORANGE[0]);
  give(game, 'a', ORANGE[1]);
  const mario = game.players[0];

  game.chargePlayer(mario, 200); // apre un debito
  check('il debito è aperto', game.pendingAction?.type === 'awaiting_debt');

  mario.position = 6;
  game.resolveLanding(mario); // casella 6 è una proprietà libera
  check('la proposta d\'acquisto non sovrascrive il debito', game.pendingAction?.type === 'awaiting_debt');
}

section('19. Abbandono e chiusura del tavolo');
{
  const game = newGame();
  check('chi crea il tavolo è il primo giocatore', game.hostId === 'a');

  const nonHost = game.endGame('b');
  check('solo chi ha creato può chiudere', !!nonHost.error, nonHost.error);

  check('l\'abbandono è accettato', !game.abandonGame('b').error);
  check('la partita è finita', game.finished === true);
  check('vince chi resta', game.winnerId === 'a');
  check('il motivo è l\'abbandono', game.endedReason === 'abandoned');
  check('non si può abbandonare due volte', !!game.abandonGame('b').error);

  // Chiusura da parte dell'host: nessun vincitore.
  const g2 = newGame();
  check('la chiusura è accettata', !g2.endGame('a').error);
  check('la partita è finita', g2.finished === true);
  check('senza vincitore', g2.winnerId === null);
  check('il motivo è la chiusura', g2.endedReason === 'closed');

  // Una fine anticipata non deve lasciare azioni in sospeso appese.
  const g3 = newGame({ balanceA: 100 });
  give(g3, 'a', ORANGE[0]);
  give(g3, 'a', ORANGE[1]);
  g3.chargePlayer(g3.players[0], 200);
  check('c\'è un debito aperto', g3.pendingAction?.type === 'awaiting_debt');
  g3.abandonGame('a');
  check('la fine ripulisce il pendingAction', g3.pendingAction === null);
}

section('19b. Rivincita: serve il consenso di entrambi');
{
  const game = newGame();
  const [mario, giulia] = game.players;
  give(game, 'a', ORANGE[0], { houses: 2 });
  give(game, 'b', BROWN[0]);
  mario.balance = 42;
  mario.position = 22;
  giulia.jailCards = 1;

  const troppoPresto = game.requestRematch('a');
  check('a partita in corso non si chiede', !!troppoPresto.error, troppoPresto.error);

  game.abandonGame('b');
  check('la partita è finita', game.finished === true);

  game.requestRematch('a');
  check('un voto solo non fa ripartire', game.finished === true);
  check('il voto è registrato', game.rematchVotes.length === 1);
  const doppio = game.requestRematch('a');
  check('non si vota due volte', !!doppio.error, doppio.error);

  game.requestRematch('b');
  check('col secondo voto si riparte', game.finished === false);
  check('i saldi tornano a 1500', mario.balance === 1500 && giulia.balance === 1500);
  check('le pedine tornano al Via', game.players.every((p) => p.position === 0));
  check('le proprietà sono azzerate', Object.keys(game.ownership).length === 0);
  check('le carte uscita sono azzerate', giulia.jailCards === 0);
  check('nessuno è più fallito', game.players.every((p) => !p.bankrupt));
  check('non c\'è più un vincitore', game.winnerId === null && game.endedReason === null);
  check('si riparte dal primo giocatore', game.turnIndex === 0);
  check('i voti sono azzerati', game.rematchVotes.length === 0);
  check('la partita è in corso', game.started === true);
  check('i giocatori sono gli stessi', game.players.map((p) => p.name).join() === 'Mario,Giulia');
  check('il creatore del tavolo non cambia', game.hostId === 'a');

  // E si può giocare davvero.
  check('si possono tirare i dadi', !game.rollDice('a').error);
}

section('19c. Dopo un tavolo chiuso non c\'è rivincita');
{
  const game = newGame();
  game.endGame('a');
  const res = game.requestRematch('a');
  check('la rivincita è rifiutata', !!res.error, res.error);
  check('la partita resta finita', game.finished === true);
}

section('20. Chiusura della stanza');
{
  const { RoomManager } = require('./src/rooms');
  const rooms = new RoomManager();
  const code = rooms.createRoom();
  rooms.attachSocket(code, 's1', 'x');
  check('la stanza esiste', rooms.getRoom(code) !== undefined);
  check('closeRoom la rimuove', rooms.closeRoom(code) === true);
  check('il codice non vale più', rooms.getRoom(code) === undefined);
}

// ---------------------------------------------------------------------------
section('21. Tavolo fino a sei giocatori');
{
  const game = new GameEngine('SEI');
  const nomi = ['Mario', 'Giulia', 'Luca', 'Anna', 'Bea', 'Ciro'];
  const pedoni = ['🎩', '🐕', '🚗', '🚢', '🐈', '🎸'];
  nomi.forEach((n, i) => game.addPlayer('p' + i, n, pedoni[i]));
  check('sei giocatori entrano', game.players.length === 6);

  const settimo = game.addPlayer('x', 'Extra', '🎺');
  check('il settimo è rifiutato', !!settimo.error, settimo.error);
  check('restano sei', game.players.length === 6);

  game.start();
  const ordine = [];
  for (let i = 0; i < 8; i++) { ordine.push(game.currentPlayer.name); game.turnResolved = false; game.endTurn(); }
  check(
    'il turno gira su tutti e sei',
    ordine.join() === 'Mario,Giulia,Luca,Anna,Bea,Ciro,Mario,Giulia',
    ordine.join()
  );
}

section('22. Con più di due, chi abbandona esce ma la partita continua');
{
  const game = new GameEngine('ABB');
  ['Mario', 'Giulia', 'Luca', 'Anna'].forEach((n, i) => game.addPlayer('p' + i, n, ['🎩', '🐕', '🚗', '🚢'][i]));
  game.start();
  give(game, 'p1', ORANGE[0]);

  game.abandonGame('p1');
  check('la partita continua', game.finished === false);
  check('chi abbandona è fuori', game.players[1].bankrupt === true);
  check('le sue proprietà tornano libere', game.ownership[ORANGE[0]] === undefined);
  check('gli altri tre sono ancora dentro', game.players.filter((p) => !p.bankrupt).length === 3);

  const dinuovo = game.abandonGame('p1');
  check('non si abbandona due volte', !!dinuovo.error, dinuovo.error);

  // Il turno non deve saltare: stava giocando Mario, non Giulia.
  check('il turno resta a chi stava giocando', game.currentPlayer.name === 'Mario');

  game.abandonGame('p2');
  check('con due rimasti la partita continua ancora', game.finished === false);
  game.abandonGame('p3');
  check('rimasto uno, la partita finisce', game.finished === true);
  check('vince chi è rimasto', game.winnerId === 'p0');
  check('il motivo è l\'abbandono', game.endedReason === 'abandoned');
}

section('23. Debiti multipli: si risolvono in coda, non si sovrascrivono');
{
  const game = new GameEngine('DEB');
  ['Mario', 'Giulia', 'Luca', 'Anna'].forEach((n, i) => game.addPlayer('p' + i, n, ['🎩', '🐕', '🚗', '🚢'][i]));
  game.start();
  [1, 2, 3].forEach((i) => { game.players[i].balance = 50; });
  // Due proprietà a testa: il debito è copribile, quindi niente bancarotta.
  give(game, 'p1', 16); give(game, 'p1', 18);
  give(game, 'p2', 21); give(game, 'p2', 23);
  give(game, 'p3', 26); give(game, 'p3', 27);

  game.applyCard(game.players[0], { action: 'collect_from_each_player', amount: 200 });
  check('tutti e tre sono in rosso', game.players.slice(1).every((p) => p.balance === -150));
  check('un debito è aperto', game.pendingAction?.type === 'awaiting_debt');

  const risolti = [];
  let giri = 0;
  while (game.pendingAction?.type === 'awaiting_debt' && giri++ < 10) {
    risolti.push(game.pendingAction.playerId);
    game.resolveDebtAuto(game.pendingAction.playerId);
  }
  check('sono stati risolti tutti e tre, uno alla volta', risolti.length === 3, risolti.join());
  check('nessuno resta in rosso', game.players.every((p) => p.balance >= 0));
  check('nessun debito appeso', game.pendingAction === null);
}

// ---------------------------------------------------------------------------
section('13. Riconnessione: il giocatore sopravvive al cambio di socket');
{
  const { RoomManager, ROOM_TTL_MS } = require('./src/rooms');
  const rooms = new RoomManager();
  const code = rooms.createRoom();
  const room = rooms.getRoom(code);

  // L'identità è il clientId del browser, non l'id del socket.
  room.game.addPlayer('client-mario', 'Mario', '🎩');
  room.game.addPlayer('client-giulia', 'Giulia', '🐕');
  room.game.start();
  rooms.attachSocket(code, 'socket-1', 'client-mario');
  rooms.attachSocket(code, 'socket-2', 'client-giulia');
  give(room.game, 'client-mario', ORANGE[0]);
  room.game.players[0].balance = 1234;

  rooms.detachSocket('socket-1');
  const mario = room.game.players.find((p) => p.id === 'client-mario');
  check('chi cade resta al tavolo', room.game.players.length === 2);
  check('viene segnato come disconnesso', mario.connected === false);
  check('conserva il saldo', mario.balance === 1234);
  check('conserva le proprietà', room.game.ownership[ORANGE[0]].ownerId === 'client-mario');
  check('la stanza non è considerata vuota', room.emptySince === null, 'c\'è ancora Giulia');

  // Rientra con un socket nuovo, stesso clientId.
  rooms.attachSocket(code, 'socket-3', 'client-mario');
  check('torna connesso', mario.connected === true);
  check('il socket vecchio non è più agganciato', !room.sockets.has('socket-1'));
  check('il socket nuovo è agganciato', room.sockets.get('socket-3') === 'client-mario');
  check('resta un solo socket per giocatore', room.sockets.size === 2, `${room.sockets.size}`);

  // Una seconda scheda con la stessa identità si AGGIUNGE, non sostituisce.
  // Questo controllo prima diceva il contrario ("la seconda subentra alla
  // prima"), e codificava il difetto invece di prenderlo: cancellare il socket
  // precedente ne buttava via uno ancora vivo, e bastava chiudere la seconda
  // scheda per risultare disconnessi mentre si continuava a giocare dalla
  // prima. L'identità del giocatore resta una sola — sono i suoi socket a
  // poter essere più d'uno.
  rooms.attachSocket(code, 'socket-4', 'client-mario');
  check('la seconda scheda si aggiunge alla prima', room.sockets.has('socket-3') && room.sockets.has('socket-4'));
  check('i giocatori restano due', room.game.players.length === 2);
  rooms.detachSocket('socket-4');
  check('e chiudendola resta connesso, perché la prima è ancora aperta', mario.connected === true);

  // Con tutti scollegati la stanza scade, ma solo dopo il tempo di grazia.
  rooms.detachSocket('socket-3');
  rooms.detachSocket('socket-2');
  check('la stanza risulta vuota', room.emptySince !== null);
  check('subito dopo non viene buttata', rooms.sweep(Date.now()) === 0);
  check('dopo la scadenza viene rimossa', rooms.sweep(Date.now() + ROOM_TTL_MS + 1) === 1);
  check('la stanza non esiste più', rooms.getRoom(code) === undefined);
}

// ---------------------------------------------------------------------------
section('24. Bot: aggiunta e rimozione al tavolo');
{
  const game = new GameEngine('BOT');
  game.addPlayer('umano', 'Mario', '🎩');

  const res = game.addBot('Bot Aurelio', '🐕');
  check('il bot viene aggiunto', !res.error, res.error);
  check('i giocatori sono due', game.players.length === 2);

  const bot = game.players[1];
  check('il bot è marcato come tale', bot.isBot === true);
  check('il bot risulta sempre connesso', bot.connected === true);
  check('il bot ha un id proprio', typeof bot.id === 'string' && bot.id.startsWith('bot-'));
  check('l\'umano non è marcato bot', game.players[0].isBot === false);
  check('il creatore del tavolo resta l\'umano', game.hostId === 'umano');

  // Il pedone occupato vale anche per i bot.
  const doppio = game.addBot('Bot Bis', '🐕');
  check('un pedone già preso è rifiutato anche al bot', !!doppio.error, doppio.error);

  // Rimozione prima dell'inizio.
  check('il bot si rimuove', !game.removeBot(bot.id).error);
  check('resta solo l\'umano', game.players.length === 1);

  const inesistente = game.removeBot('bot-999');
  check('rimuovere un bot inesistente è rifiutato', !!inesistente.error, inesistente.error);

  game.addBot('Bot Cleo', '🚗');
  game.start();
  const aPartitaIniziata = game.removeBot(game.players[1].id);
  check('a partita iniziata non si rimuove', !!aPartitaIniziata.error, aPartitaIniziata.error);
}

// ---------------------------------------------------------------------------
section('25. Bot: valutazioni pure della strategia');
{
  // Gli arancioni sono il gruppo più redditizio del tabellone: stanno a 6-8-9
  // caselle dalla prigione, che è la casella più visitata.
  check('gli arancioni pesano più dei marroni', groupWeight('orange') > groupWeight('brown'));
  check('gli arancioni pesano più dei rosa', groupWeight('orange') > groupWeight('pink'));
  check('ogni gruppo ha un peso positivo', ['brown', 'lightblue', 'pink', 'orange', 'red', 'yellow', 'green', 'blue']
    .every((g) => groupWeight(g) > 0));
  check('un gruppo sconosciuto ha peso neutro', groupWeight('inesistente') === 1);

  const game = newGame();
  const arancione = board[ORANGE[0]];

  // Con tanta cassa si compra volentieri; con pochissima no.
  const ricco = propertyScore(game, 'a', arancione, 2000);
  const povero = propertyScore(game, 'a', arancione, 100);
  check('con cassa alta il punteggio è positivo', ricco > 0, String(ricco));
  check('con cassa quasi nulla il punteggio scende', povero < ricco, `${povero} vs ${ricco}`);

  // Completare un monopolio vale molto di più che una proprietà isolata.
  const g2 = newGame();
  give(g2, 'a', ORANGE[1]);
  give(g2, 'a', ORANGE[2]);
  const completa = propertyScore(g2, 'a', board[ORANGE[0]], 2000);
  const isolata = propertyScore(newGame(), 'a', board[ORANGE[0]], 2000);
  check('completare un monopolio vale di più', completa > isolata, `${completa} vs ${isolata}`);
}

section('26. Bot: valutazione degli scambi');
{
  // Il bot ('a') è sempre il DESTINATARIO della proposta: riceve quanto sta in
  // `offer*` (roba del proponente) e cede quanto sta in `request*` (roba sua).
  const game = newGame();
  give(game, 'b', ORANGE[0]);   // di Giulia, la vuole il bot
  give(game, 'a', BROWN[0]);    // del bot, di scarso valore

  // Offerta generosa verso il bot: riceve una proprietà cara, dà una scarsa.
  const buona = evaluateTrade(game, 'a', {
    offerProperties: [ORANGE[0]], offerMoney: 0, offerJailCards: 0,
    requestProperties: [BROWN[0]], requestMoney: 0, requestJailCards: 0,
  });
  check('uno scambio vantaggioso è accettato', buona === true);

  // Offerta assurda: il bot dà una proprietà cara e 500, riceve una scarsa.
  const g2 = newGame();
  give(g2, 'a', ORANGE[0]);
  give(g2, 'b', BROWN[0]);
  const pessima = evaluateTrade(g2, 'a', {
    offerProperties: [BROWN[0]], offerMoney: 0, offerJailCards: 0,
    requestProperties: [ORANGE[0]], requestMoney: 500, requestJailCards: 0,
  });
  check('uno scambio nettamente in perdita è rifiutato', pessima === false);

  // Rompere un monopolio già posseduto è da rifiutare anche a prezzo pieno.
  const g3 = newGame();
  ORANGE.forEach((pos) => give(g3, 'a', pos));
  const rompeMonopolio = evaluateTrade(g3, 'a', {
    offerProperties: [], offerMoney: 250, offerJailCards: 0,
    requestProperties: [ORANGE[0]], requestMoney: 0, requestJailCards: 0,
  });
  check('non si rompe un proprio monopolio per poco denaro', rompeMonopolio === false);
}

// ---------------------------------------------------------------------------
section('27. Bot: decisioni durante il turno');
{
  // Tira i dadi quando tocca a lui.
  const game = new GameEngine('B1');
  game.addPlayer('umano', 'Mario', '🎩');
  game.addBot('Bot Aurelio', '🐕');
  game.start();
  game.turnIndex = 1; // tocca al bot

  check('riconosce che tocca al bot', isBotTurn(game) === true);
  const posPrima = game.players[1].position;
  botMove(game);
  // rollCount e non lastRoll: se il tiro non apre nulla in sospeso (niente da
  // comprare, niente carta) il turno si chiude subito e lastRoll torna null,
  // ma il tiro c'è comunque stato.
  check('il bot ha tirato i dadi', game.rollCount > 0, `rollCount=${game.rollCount}`);
  check('la pedina si è mossa o ha un\'azione aperta',
    game.players[1].position !== posPrima || game.pendingAction !== null);

  // Con una carta pescata, la conferma.
  const g2 = new GameEngine('B2');
  g2.addPlayer('umano', 'Mario', '🎩');
  g2.addBot('Bot Aurelio', '🐕');
  g2.start();
  g2.turnIndex = 1;
  g2.chanceDeck = [{ text: 'La banca ti paga 50.', action: 'collect', amount: 50 }];
  g2.drawCard(g2.players[1], 'chance');
  const saldoPrima = g2.players[1].balance;
  botMove(g2);
  check('il bot conferma la carta pescata', g2.pendingAction === null);
  check('l\'effetto della carta è stato applicato', g2.players[1].balance === saldoPrima + 50);

  // Con un affitto da pagare, paga.
  const g3 = new GameEngine('B3');
  g3.addPlayer('umano', 'Mario', '🎩');
  g3.addBot('Bot Aurelio', '🐕');
  g3.start();
  g3.turnIndex = 1;
  g3.ownership[ORANGE[0]] = { ownerId: 'umano', houses: 0, hotels: 0, mortgaged: false };
  g3.players[1].position = 10;
  g3.movePlayer(g3.players[1], ORANGE[0] - 10);
  check('l\'affitto è in sospeso', g3.pendingAction?.type === 'awaiting_rent');
  botMove(g3);
  check('il bot ha pagato l\'affitto', g3.pendingAction === null);
  check('il denaro è passato all\'umano', g3.players[0].balance > 1500);

  // Con un debito copribile, liquida da solo.
  const g4 = new GameEngine('B4');
  g4.addPlayer('umano', 'Mario', '🎩');
  g4.addBot('Bot Aurelio', '🐕');
  g4.start();
  const bot4 = g4.players[1];
  bot4.balance = 100;
  g4.ownership[ORANGE[0]] = { ownerId: bot4.id, houses: 0, hotels: 0, mortgaged: false };
  g4.ownership[ORANGE[1]] = { ownerId: bot4.id, houses: 0, hotels: 0, mortgaged: false };
  g4.chargePlayer(bot4, 200);
  check('il debito è aperto sul bot', g4.pendingAction?.type === 'awaiting_debt');
  botMove(g4);
  check('il bot ha saldato il debito', bot4.balance >= 0, `saldo=${bot4.balance}`);

  // Con un monopolio completo e cassa abbondante costruisce, e lo fa PRIMA di
  // tirare: dopo un tiro non-doppio il motore chiude il turno da solo e la
  // finestra per costruire non esisterebbe più.
  const g5 = new GameEngine('B6');
  g5.addPlayer('umano', 'Mario', '🎩');
  g5.addBot('Bot Aurelio', '🐕');
  g5.start();
  g5.turnIndex = 1;
  const bot5 = g5.players[1];
  bot5.balance = 2000;
  for (const pos of ORANGE) {
    g5.ownership[pos] = { ownerId: bot5.id, houses: 0, hotels: 0, mortgaged: false };
  }
  botMove(g5);
  const case5 = ORANGE.reduce((tot, pos) => tot + g5.ownership[pos].houses, 0);
  check('il bot costruisce prima di tirare', case5 === 1, `case=${case5}`);
  check('costruendo non ha ancora tirato', g5.lastRoll === null);
  botMove(g5);
  const case5bis = ORANGE.reduce((tot, pos) => tot + g5.ownership[pos].houses, 0);
  check('non costruisce due volte nello stesso turno', case5bis === 1, `case=${case5bis}`);

  // Dopo un doppio il turno resta aperto e il bot deve tirare di nuovo, non
  // chiudere il turno buttando via il tiro extra.
  const g6 = new GameEngine('B7');
  g6.addPlayer('umano', 'Mario', '🎩');
  g6.addBot('Bot Aurelio', '🐕');
  g6.start();
  g6.turnIndex = 1;
  const bot6 = g6.players[1];
  // Lo stato "ho appena fatto doppio" si costruisce a mano invece di cercare
  // dadi che ci arrivino per caso: così il test non dipende dal tabellone.
  g6.lastRoll = { playerId: bot6.id, dice: [3, 3], seq: 1 };
  g6.rollCount = 1;
  g6.lastRollWasDouble = true;
  g6.turnResolved = false;
  bot6.doublesInARow = 1;
  botMove(g6);
  // Si guarda rollCount e non lastRoll.seq: da quando il tabellone smette di
  // mostrare il tiro di chi ha già giocato, lastRoll torna null appena il turno
  // si chiude — e il secondo tiro, se non è a sua volta un doppio e non apre
  // nulla in sospeso, chiude il turno all'istante. Leggere lì dentro faceva
  // fallire questo test una volta ogni sette.
  check('dopo un doppio il bot ritira', g6.rollCount === 2, `rollCount=${g6.rollCount}`);
  check('il tiro extra è suo', g6.lastRoll === null || g6.lastRoll.playerId === bot6.id);

  // Senza doppio invece non deve ritirare: chiude il turno e passa la mano.
  // (Stato costruito a mano: nel gioco vero il motore chiude da sé, qui si
  // verifica che la rete di sicurezza del bot non tiri i dadi a sproposito.)
  const g7 = new GameEngine('B8');
  g7.addPlayer('umano', 'Mario', '🎩');
  g7.addBot('Bot Aurelio', '🐕');
  g7.start();
  g7.turnIndex = 1;
  const bot7 = g7.players[1];
  g7.lastRoll = { playerId: bot7.id, dice: [2, 5], seq: 1 };
  g7.rollCount = 1;
  g7.lastRollWasDouble = false;
  g7.turnResolved = false;
  botMove(g7);
  // rollCount non si tocca a fine turno (a differenza di lastRoll): resta 1
  // a conferma che il bot non ha ritirato i dadi una seconda volta.
  check('senza doppio non ritira', g7.rollCount === 1, `rollCount=${g7.rollCount}`);
  check('senza doppio passa la mano', g7.turnIndex === 0, `turnIndex=${g7.turnIndex}`);
  check('senza doppio la scritta del tiro sparisce', g7.lastRoll === null);
}

section('28. Bot: risposta agli scambi');
{
  const game = new GameEngine('B5');
  game.addPlayer('umano', 'Mario', '🎩');
  game.addBot('Bot Aurelio', '🐕');
  game.start();
  const botId = game.players[1].id;

  // Offerta generosa: l'umano dà una proprietà cara e chiede pochi soldi.
  game.ownership[ORANGE[0]] = { ownerId: 'umano', houses: 0, hotels: 0, mortgaged: false };
  game.proposeTrade('umano', {
    toId: botId, offerProperties: [ORANGE[0]], requestMoney: 50,
  });
  check('lo scambio è in attesa del bot', game.pendingAction?.type === 'awaiting_trade');
  botMove(game);
  check('il bot ha risposto', game.pendingAction === null);
  check('il bot ha accettato l\'offerta conveniente',
    game.ownership[ORANGE[0]].ownerId === botId);
}

// ---------------------------------------------------------------------------
section('29. Bot: proposte di scambio non ripetitive e non autolesioniste');
{
  const LIGHTBLUE = board.filter((s) => s.group === 'lightblue').map((s) => s.position);

  // regalaMonopolio è la domanda "cedendogli questa, gli chiudo un colore?"
  {
    const g = newGame();
    // L'umano ha due azzurre su tre: la terza gli completerebbe il gruppo.
    give(g, 'b', LIGHTBLUE[0]);
    give(g, 'b', LIGHTBLUE[1]);
    check('cedere l\'ultima casella di un colore glielo regala',
      regalaMonopolio(g, 'b', [LIGHTBLUE[2]]) === true);
    check('cedere una casella di un colore che non chiude non regala nulla',
      regalaMonopolio(g, 'b', [ORANGE[0]]) === false);
  }

  /** Prepara un bot a un passo dal monopolio arancione, con merce da scambiare. */
  function tavoloDaScambio() {
    const g = new GameEngine('SC');
    g.addPlayer('umano', 'Mario', '🎩');
    g.addBot('Bot Aurelio', '🐕');
    g.start();
    const bot = g.players[1];
    g.turnIndex = 1;
    bot.balance = 1500;
    // Al bot mancano solo gli arancioni: due su tre sono suoi, la terza è dell'umano.
    g.ownership[ORANGE[0]] = { ownerId: bot.id, houses: 0, hotels: 0, mortgaged: false };
    g.ownership[ORANGE[1]] = { ownerId: bot.id, houses: 0, hotels: 0, mortgaged: false };
    g.ownership[ORANGE[2]] = { ownerId: 'umano', houses: 0, hotels: 0, mortgaged: false };
    return { g, bot };
  }

  // Il bot non ripropone lo stesso baratto a chi l'ha appena rifiutato: prima
  // ricalcolava ogni turno la stessa identica offerta e la ripeteva all'infinito.
  {
    const { g, bot } = tavoloDaScambio();
    // Una proprietà di scarto da mettere sul piatto.
    g.ownership[BROWN[0]] = { ownerId: bot.id, houses: 0, hotels: 0, mortgaged: false };

    // Math.random fissato a 0: supera il filtro del 30% e toglie ogni casualità.
    const vero = Math.random;
    Math.random = () => 0;
    try {
      botMove(g);
      check('il bot propone lo scambio', g.pendingAction?.type === 'awaiting_trade');
      const chiesto = g.pendingAction?.requestProperties?.[0];
      check('chiede la casella che gli completa il colore', chiesto === ORANGE[2], `chiesto=${chiesto}`);

      g.respondTrade('umano', false);
      check('dopo il rifiuto non c\'è più nulla in sospeso', g.pendingAction === null);

      // Stesso turno, stessa situazione: non deve riproporre la stessa cosa.
      botMove(g);
      check('non ripropone lo stesso baratto appena rifiutato',
        g.pendingAction?.type !== 'awaiting_trade',
        `pendingAction=${g.pendingAction?.type}`);
    } finally {
      Math.random = vero;
    }
  }

  // Fra due possibili scarti, non cede quello che completerebbe un colore
  // all'avversario: quel pezzo vale molto più del suo prezzo di listino.
  {
    const { g, bot } = tavoloDaScambio();
    // L'umano ha due azzurre: la terza gli chiuderebbe il gruppo.
    g.ownership[LIGHTBLUE[0]] = { ownerId: 'umano', houses: 0, hotels: 0, mortgaged: false };
    g.ownership[LIGHTBLUE[1]] = { ownerId: 'umano', houses: 0, hotels: 0, mortgaged: false };
    // Il bot possiede sia quella pericolosa sia una marrone innocua.
    g.ownership[LIGHTBLUE[2]] = { ownerId: bot.id, houses: 0, hotels: 0, mortgaged: false };
    g.ownership[BROWN[0]] = { ownerId: bot.id, houses: 0, hotels: 0, mortgaged: false };

    const vero = Math.random;
    Math.random = () => 0;
    try {
      botMove(g);
      const offerte = g.pendingAction?.offerProperties || [];
      check('propone comunque qualcosa', g.pendingAction?.type === 'awaiting_trade');
      check('non cede la casella che chiuderebbe il colore all\'avversario',
        !offerte.includes(LIGHTBLUE[2]), `offerte=${offerte.join(',')}`);
    } finally {
      Math.random = vero;
    }
  }
}

// ---------------------------------------------------------------------------
section('30. Regola della casa: montepremi della Sosta Gratuita');
{
  // Una tassa pagata alla banca deve far crescere il montepremi.
  const game = newGame();
  const mario = game.players[0];
  mario.position = 0;
  game.movePlayer(mario, 4); // casella 4: Tassa patrimoniale, 200
  check('la tassa è in sospeso', game.pendingAction?.type === 'awaiting_tax');
  game.payTax('a');
  check(
    'la tassa pagata alla banca gonfia il montepremi',
    game.freeParkingPot === 200,
    `pot=${game.freeParkingPot}`
  );

  // Un affitto pagato a un altro giocatore non deve toccare il montepremi.
  const primaDelAffitto = game.freeParkingPot;
  give(game, 'b', ORANGE[0]);
  mario.position = 10;
  game.turnResolved = false;
  game.movePlayer(mario, ORANGE[0] - 10);
  check('l\'affitto è in sospeso', game.pendingAction?.type === 'awaiting_rent');
  game.payRent('a');
  check(
    'l\'affitto pagato a un altro giocatore non gonfia il montepremi',
    game.freeParkingPot === primaDelAffitto,
    `pot=${game.freeParkingPot}`
  );

  // La multa di prigione (pagata alla banca) gonfia il montepremi.
  const primaDellaMulta = game.freeParkingPot;
  mario.inJail = true;
  game.payJailFine('a');
  check(
    'la multa di prigione gonfia il montepremi',
    game.freeParkingPot === primaDellaMulta + 50,
    `pot=${game.freeParkingPot}`
  );

  // Chi atterra sulla Sosta Gratuita incassa tutto e il montepremi torna a zero.
  const saldoPrimaDiIncassare = mario.balance;
  const potPrimaDiIncassare = game.freeParkingPot;
  mario.position = 10;
  game.turnResolved = false;
  game.movePlayer(mario, 10); // casella 20: Sosta Gratuita
  check(
    'chi atterra sulla Sosta incassa il montepremi',
    mario.balance === saldoPrimaDiIncassare + potPrimaDiIncassare,
    `saldo=${mario.balance}`
  );
  check('il montepremi torna a zero dopo l\'incasso', game.freeParkingPot === 0);

  // Atterrare sulla Sosta col montepremi già vuoto non deve rompere nulla.
  const saldoConPotVuoto = mario.balance;
  mario.position = 10;
  game.turnResolved = false;
  game.movePlayer(mario, 10); // di nuovo sulla Sosta Gratuita, montepremi vuoto
  check(
    'atterrare sulla Sosta col montepremi vuoto non cambia il saldo',
    mario.balance === saldoConPotVuoto,
    `saldo=${mario.balance}`
  );
  check('il montepremi resta a zero', game.freeParkingPot === 0);

  // Il montepremi arriva nello stato serializzato per il client.
  game.freeParkingPot = 42;
  const state = game.serialize();
  check(
    'il montepremi è nello stato serializzato',
    state.freeParkingPot === 42,
    `serialized=${state.freeParkingPot}`
  );

  // La rivincita azzera il montepremi, senza portarselo dietro.
  game.finished = true;
  game.requestRematch('a');
  game.requestRematch('b');
  check('la rivincita azzera il montepremi', game.freeParkingPot === 0, `pot=${game.freeParkingPot}`);
}

// ---------------------------------------------------------------------------
section('31. lastRoll sparisce a fine turno, resta col doppio');
{
  // Chiusura normale del turno: senza doppio il tiro non è più quello in
  // corso, quindi il tabellone non deve più mostrare chi ha tirato.
  const game = newGame();
  const mario = game.players[0];
  mario.position = 0;
  give(game, mario.id, 3); // già sua: atterrarci non apre un acquisto in sospeso
  game.turnResolved = false;
  game.movePlayer(mario, 3); // niente da comprare, niente doppio
  game.lastRoll = { playerId: mario.id, dice: [1, 2], seq: 7 };
  game.finishRoll(mario);
  check('dopo la chiusura del turno il tiro non è più esposto', game.lastRoll === null);
  check('il turno è passato all\'avversario', game.turnIndex === 1, `turnIndex=${game.turnIndex}`);

  // Col doppio il turno resta suo: la scritta deve restare, perché quel tiro
  // è ancora quello in corso e sta per ritirare.
  const game2 = newGame();
  const mario2 = game2.players[0];
  game2.turnResolved = false;
  game2.lastRollWasDouble = true;
  game2.lastRoll = { playerId: mario2.id, dice: [4, 4], seq: 3 };
  game2.finishRoll(mario2);
  check('dopo un doppio il tiro resta esposto', game2.lastRoll !== null);
  check('è ancora il turno di chi ha fatto doppio', game2.turnIndex === 0, `turnIndex=${game2.turnIndex}`);

  // Tiro in prigione senza doppio: si resta dentro, il turno passa e la
  // scritta del tiro precedente non deve restare a suggerire che stia ancora
  // giocando lui. Dadi truccati (2 e 5, non doppio) per non dipendere dalla
  // sorte: con un doppio si uscirebbe di prigione senza che il turno passi.
  const game3 = newGame();
  const mario3 = game3.players[0];
  mario3.inJail = true;
  const realRandom = Math.random;
  Math.random = (() => {
    const dadi = [2, 5];
    let i = 0;
    return () => (dadi[i++ % 2] - 1) / 6 + 0.001;
  })();
  game3.rollDice('a');
  Math.random = realRandom;
  check('tiro in prigione senza doppio: resta dentro', mario3.inJail === true);
  check('tiro in prigione senza doppio: il turno passa', game3.turnIndex === 1, `turnIndex=${game3.turnIndex}`);
  check('tiro in prigione senza doppio: il tiro non è più esposto', game3.lastRoll === null);
}

// ---------------------------------------------------------------------------
section('32. Asta sulla proprietà rifiutata');
{
  // Partita a tre così da poter distinguere "non tocca a te" (il turno
  // dell'asta è andato avanti) da "l'asta si è già chiusa": con solo due
  // giocatori i due casi coincidono sempre, perché chi passa lascia da solo
  // l'altro, che vince all'istante.
  const game = new GameEngine('AUCTION');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  game.addPlayer('c', 'Luca', '🚗');
  game.start();
  const [mario, giulia, luca] = game.players;

  // Vicolo Corto (1), marrone, listino 60: libera, così l'atterraggio apre
  // la proposta d'acquisto come su qualunque altra casella libera.
  game.movePlayer(mario, 1);
  check('atterrando su una libera si apre la proposta d\'acquisto', game.pendingAction?.type === 'awaiting_buy');

  game.declineBuy('a');
  check('la rinuncia apre l\'asta invece di lasciare la casella libera', game.pendingAction?.type === 'awaiting_auction');
  check('l\'asta parte da chi ha rinunciato', game.pendingAction.playerId === 'a');
  check('l\'ordine di turno è quello del tavolo, a partire da chi rinuncia', JSON.stringify(game.pendingAction.queue) === JSON.stringify(['a', 'b', 'c']));
  check('la casella non è ancora di nessuno', !game.ownership[1]);

  const rilancioValido = game.bidAuction('a', 10);
  check('un rilancio valido (base d\'asta 10) va a buon fine', !rilancioValido.error, JSON.stringify(rilancioValido));
  check('l\'offerta corrente sale a 10', game.pendingAction.currentBid === 10 && game.pendingAction.currentBidderId === 'a');
  check('tocca al prossimo in coda', game.pendingAction.playerId === 'b');

  const rilancioBasso = game.bidAuction('b', 15);
  check('un rilancio sotto il minimo (offerta corrente + 10) è rifiutato', !!rilancioBasso.error, JSON.stringify(rilancioBasso));
  check('l\'offerta corrente non cambia', game.pendingAction.currentBid === 10);

  giulia.balance = 15;
  const offertaTroppoAlta = game.bidAuction('b', 20);
  check('un\'offerta oltre la propria cassa è rifiutata', !!offertaTroppoAlta.error, JSON.stringify(offertaTroppoAlta));
  giulia.balance = 1500; // ripristinata per il resto del test

  const passoDiGiulia = game.passAuction('b');
  check('passare è sempre lecito', !passoDiGiulia.error, JSON.stringify(passoDiGiulia));
  check('chi passa esce dalla coda', !game.pendingAction.queue.includes('b'));
  check('tocca al prossimo rimasto in coda', game.pendingAction.playerId === 'c');

  const bidDopoIlPasso = game.bidAuction('b', 100);
  check('chi ha passato non può più offrire', !!bidDopoIlPasso.error, JSON.stringify(bidDopoIlPasso));

  // Con Luca che passa resta un solo giocatore in coda (Mario, con l'unica
  // offerta): l'asta si chiude da sé, senza che nessuno debba "confermare".
  game.passAuction('c');
  check('con un solo rimasto in coda l\'asta si chiude da sé', game.pendingAction === null, JSON.stringify(game.pendingAction));
  check('la casella è assegnata a chi aveva l\'offerta più alta', game.ownership[1]?.ownerId === 'a');
  check('il denaro dell\'offerta è stato scalato', mario.balance === 1490, `balance=${mario.balance}`);
  check('il turno è passato al prossimo giocatore', game.currentPlayer.id === 'b', `turno di ${game.currentPlayer.name}`);
}

// ---------------------------------------------------------------------------
section('32b. Un\'asta senza offerte lascia la casella libera');
{
  const game = newGame();
  const mario = game.players[0];

  game.movePlayer(mario, 3); // Vicolo Stretto, marrone, libera
  game.declineBuy('a');
  check('l\'asta è aperta', game.pendingAction?.type === 'awaiting_auction');

  passAuction(game); // nessuno offre, entrambi passano
  check('senza offerte l\'asta si chiude senza assegnare nulla', game.pendingAction === null);
  check('la casella resta libera', !game.ownership[3]);
}

// ---------------------------------------------------------------------------
section('32c. Il tiro extra del doppio sopravvive all\'asta');
{
  const game = newGame();
  const mario = game.players[0];

  // 3+3: doppio, atterra su Bastioni Gran Sasso (6), libera.
  const realRandom = Math.random;
  Math.random = () => 0.4;
  game.rollDice('a');
  Math.random = realRandom;
  check('il doppio è registrato', game.lastRollWasDouble === true);
  check('atterra su una libera', game.pendingAction?.type === 'awaiting_buy');

  game.declineBuy('a');
  check('la rinuncia apre l\'asta senza chiudere il turno', game.pendingAction?.type === 'awaiting_auction');
  check('durante l\'asta il turno resta ancora suo', game.currentPlayer.id === 'a');

  passAuction(game); // nessuno offre
  check('dopo l\'asta il turno non è passato: il doppio non è andato perso', game.currentPlayer.id === 'a');
  check('nessuna azione in sospeso', game.pendingAction === null);

  const ritiro = game.rollDice('a');
  check('può ritirare subito dopo l\'asta, come da diritto del doppio', !ritiro.error, JSON.stringify(ritiro));
}

// ---------------------------------------------------------------------------
section('32c-bis. Chi lascia il tavolo mentre tocca a lui rilanciare non porta via l\'asta agli altri');
{
  // L'asta non è la finestra di uno solo: è di tutti quelli rimasti in coda.
  // abandonGame però chiudeva "qualunque finestra intestata a chi esce", e
  // siccome durante un'asta `pendingAction.playerId` è semplicemente chi deve
  // parlare adesso, chi lasciava il tavolo proprio in quel momento portava via
  // l'asta intera: la migliore offerta di un altro annullata, la casella di
  // nuovo libera e nessuno in grado di capire perché.
  const game = new GameEngine('ABBANDONO-ASTA');
  ['Anna', 'Bruno', 'Carla'].forEach((nome, i) => {
    game.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗'][i]);
  });
  game.start();
  const [, bruno, carla] = game.players;

  game.turnResolved = false;
  game.movePlayer(game.players[0], 39); // Parco della Vittoria, 400, libera
  game.declineBuy('a');
  game.bidAuction('a', game.pendingAction.minBid);
  game.bidAuction('b', game.pendingAction.minBid);
  game.bidAuction('c', game.pendingAction.minBid); // Carla ha la migliore
  const offertaDiCarla = game.pendingAction.currentBid;
  check('tocca di nuovo ad Anna, con Carla in testa', game.pendingAction.playerId === 'a' && game.pendingAction.currentBidderId === 'c');

  game.abandonGame('a');
  check('l\'asta resta aperta per gli altri due', game.pendingAction?.type === 'awaiting_auction', JSON.stringify(game.pendingAction));
  // Da qui in poi si legge pendingAction con la protezione: se una regressione
  // facesse di nuovo sparire l'asta, questi controlli devono fallire dicendo
  // cosa non va, non esplodere su un null e fermare tutta la suite.
  check('l\'offerta di chi è rimasto non viene annullata', game.pendingAction?.currentBid === offertaDiCarla && game.pendingAction?.currentBidderId === 'c');
  check('chi ha abbandonato esce dalla coda', !game.pendingAction?.queue?.includes('a'));
  check('e la parola passa al prossimo', game.pendingAction?.playerId === 'b');

  const saldoCarla = carla.balance;
  game.passAuction('b'); // resta solo Carla: si aggiudica la casella
  check('l\'asta si chiude assegnando la casella a chi aveva offerto di più', game.ownership[39]?.ownerId === 'c');
  check('e il prezzo viene scalato davvero', carla.balance === saldoCarla - offertaDiCarla, `saldo=${carla.balance}`);
  check('chiusa l\'asta il turno riparte da chi è ancora in partita', !game.currentPlayer.bankrupt && game.currentPlayer.id === 'b', `turno di ${game.currentPlayer.name}`);

  // Rovescio: se ad andarsene è proprio chi aveva la migliore offerta, quella
  // offerta va annullata — non potrebbe pagarla — e l'asta prosegue dalla base.
  const g2 = new GameEngine('ABBANDONO-ASTA-2');
  ['Anna', 'Bruno', 'Carla', 'Dino'].forEach((nome, i) => {
    g2.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗', '🚢'][i]);
  });
  g2.start();
  g2.turnResolved = false;
  g2.movePlayer(g2.players[0], 39);
  g2.declineBuy('a');
  g2.bidAuction('a', g2.pendingAction.minBid); // Anna in testa, poi tocca a Bruno
  check('Anna è in testa', g2.pendingAction.currentBidderId === 'a');
  g2.abandonGame('a');
  check('l\'asta continua anche così', g2.pendingAction?.type === 'awaiting_auction');
  check('l\'offerta di chi se n\'è andato è annullata', g2.pendingAction?.currentBid === 0 && g2.pendingAction?.currentBidderId === null);
  check('e il minimo torna la base d\'asta', g2.pendingAction?.minBid === g2.pendingAction?.minIncrement, JSON.stringify(g2.pendingAction?.minBid));
  check('la casella non è di nessuno finché l\'asta non si chiude', !g2.ownership[39]);
}

// ---------------------------------------------------------------------------
section('32d. Un bot partecipa all\'asta e la chiude da solo, in una partita di soli bot');
{
  const game = new GameEngine('BOTS-AUCTION');
  game.addBot('Bot Uno', '🐕');
  game.addBot('Bot Due', '🎩');
  game.start();
  const [botA, botB] = game.players;
  const totalePrima = botA.balance + botB.balance;

  game.movePlayer(botA, 1); // Vicolo Corto, libera
  check('il bot atterra su una libera e gli si propone l\'acquisto', game.pendingAction?.type === 'awaiting_buy');
  game.declineBuy(botA.id);
  check('la rinuncia del bot apre l\'asta', game.pendingAction?.type === 'awaiting_auction');

  let giri = 0;
  let crashed = null;
  try {
    while (game.pendingAction?.type === 'awaiting_auction' && giri < 50) {
      const mosso = botMove(game);
      if (!mosso) break; // rete di sicurezza: non dovrebbe mai succedere qui
      giri += 1;
    }
  } catch (err) {
    crashed = err;
  }

  check('nessun crash mentre i bot fanno l\'asta', crashed === null, crashed && crashed.stack);
  check(
    'l\'asta fra soli bot si chiude da sola, senza restare appesa',
    game.pendingAction?.type !== 'awaiting_auction',
    `dopo ${giri} mosse: ${JSON.stringify(game.pendingAction)}`
  );
  const totaleDopo = botA.balance + botB.balance;
  check(
    'il denaro tornato alla banca coincide con l\'eventuale assegnazione',
    game.ownership[1] ? totaleDopo < totalePrima : totaleDopo === totalePrima,
    `prima=${totalePrima} dopo=${totaleDopo} ownership=${JSON.stringify(game.ownership[1])}`
  );
}

// ---------------------------------------------------------------------------
section('32e. Il rilancio minimo scala col prezzo di listino, non è più fisso a 10');
{
  // Vicolo Corto (1), marrone, listino 60: casella economica. Con la formula
  // (prezzo/80 arrotondato alla decina) l'incremento resta 10, come prima
  // della modifica: su una casella così a buon mercato non doveva cambiare
  // nulla.
  const gameEconomica = newGame();
  const marioEconomico = gameEconomica.players[0];
  gameEconomica.movePlayer(marioEconomico, 1);
  gameEconomica.declineBuy('a');
  check(
    'casella economica (60): il minimo d\'asta resta piccolo, sull\'ordine della decina',
    gameEconomica.pendingAction.minBid === 10,
    `minBid=${gameEconomica.pendingAction.minBid}`
  );

  // Parco della Vittoria (39), blu, listino 400: la più cara del tabellone.
  // Si arriva in posizione 39 muovendo di 39 spazi da 0 (il Via), senza
  // giro del tabellone: niente Via da incassare, la casella è ancora libera.
  const gameCara = newGame();
  const marioCaro = gameCara.players[0];
  gameCara.movePlayer(marioCaro, 39);
  gameCara.declineBuy('a');
  check(
    'casella cara (400): il minimo d\'asta è consistente ma non spropositato (400/8=50)',
    gameCara.pendingAction.minBid === 50,
    `minBid=${gameCara.pendingAction.minBid}`
  );
  check(
    'il minimo su una casella cara resta un numero tondo (multiplo di 10)',
    gameCara.pendingAction.minBid % 10 === 0
  );
  check(
    'partendo da zero, per chiudere l\'asta intorno al listino bastano 8 rilanci (400/50), non i 40 di un incremento fisso da 10',
    Math.ceil(400 / gameCara.pendingAction.minIncrement) === 8
  );

  // Un rilancio sotto il minimo va rifiutato, sia sulla casella economica che
  // su quella cara: il tetto minimo non è solo esposto, va anche rispettato.
  const bidBassoEconomico = gameEconomica.bidAuction('a', 5);
  check(
    'sotto il minimo su una casella economica il rilancio è rifiutato',
    !!bidBassoEconomico.error,
    JSON.stringify(bidBassoEconomico)
  );
  const bidBassoCaro = gameCara.bidAuction('a', 40);
  check(
    'sotto il minimo su una casella cara il rilancio è rifiutato (40 < 50)',
    !!bidBassoCaro.error,
    JSON.stringify(bidBassoCaro)
  );
  const bidValidoCaro = gameCara.bidAuction('a', 50);
  check(
    'al minimo esatto il rilancio su una casella cara va a buon fine',
    !bidValidoCaro.error,
    JSON.stringify(bidValidoCaro)
  );
  check(
    'dopo il rilancio la soglia successiva è offerta + incremento (50+50=100)',
    gameCara.pendingAction.minBid === 100,
    `minBid=${gameCara.pendingAction.minBid}`
  );
}

section('32f. Un\'asta fra bot si chiude anche su una casella cara');
{
  // Il test 32d usa Vicolo Corto, che costa 60: lì il rilancio minimo resta 10
  // e il difetto non si vedeva. Quando il minimo è diventato proporzionale al
  // listino, bot.js continuava a offrire 10 di suo: il motore rifiutava, il
  // rifiuto non cambiava lo stato, e toccava di nuovo allo stesso bot — asta
  // bloccata per sempre, e con lei la partita. I test restavano verdi e solo la
  // calibrazione lo mostrava, con le partite concluse crollate dal 99% al 13%.
  // Quindi qui si usa la casella più cara del tabellone.
  const CARA = board.reduce((m, s) => (s.price || 0) > (m.price || 0) ? s : m, board[1]);

  const game = new GameEngine('ASTA-CARA');
  game.addBot('Bot Uno', '🐕');
  game.addBot('Bot Due', '🎩');
  game.start();
  const botA = game.players[0];

  game.movePlayer(botA, CARA.position);
  game.declineBuy(botA.id);
  check('l\'asta sulla casella cara è aperta', game.pendingAction?.type === 'awaiting_auction',
    `casella=${CARA.name} (${CARA.price})`);
  check('il rilancio minimo è più alto che sulle caselle economiche',
    game.pendingAction.minBid > 10, `minBid=${game.pendingAction.minBid}`);

  let giri = 0;
  while (game.pendingAction?.type === 'awaiting_auction' && giri < 60) {
    if (!botMove(game)) break;
    giri += 1;
  }
  check('l\'asta si chiude invece di girare a vuoto',
    game.pendingAction?.type !== 'awaiting_auction',
    `dopo ${giri} mosse è ancora aperta`);
  check('e ci arriva in poche mosse, non decine', giri < 25, `mosse=${giri}`);
}

// ---------------------------------------------------------------------------
section('32h. La multa della prigione non aggira il congelamento dell\'asta');
{
  // Con un'asta in corso la spesa libera è congelata per tutti: costruire o
  // riscattare un'ipoteca a metà asta renderebbe inaffrontabile un'offerta già
  // fatta, e il conto tornerebbe scoperto solo all'aggiudicazione. La multa
  // della prigione era l'unica uscita di denaro rimasta fuori da quel
  // congelamento, e bastava per arrivare esattamente al risultato che il
  // congelamento esiste per impedire: si offre tutto quello che si ha, si paga
  // la multa, e all'aggiudicazione il conto è scoperto — con un saldo negativo
  // che nessuno chiede di coprire, perché closeAuction scala l'offerta e basta.
  const game = new GameEngine('MULTA-ASTA');
  ['Anna', 'Bruno', 'Carla', 'Dino'].forEach((nome, i) => {
    game.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗', '🚢'][i]);
  });
  game.start();
  const carla = game.players[2];
  carla.inJail = true;
  carla.position = 10;
  carla.balance = 200;

  game.turnResolved = false;
  game.movePlayer(game.players[0], 1); // Vicolo Corto, libera
  game.declineBuy('a');
  game.passAuction('a');
  game.passAuction('b'); // ora tocca a Carla, che è in prigione
  check('l\'asta è aperta e tocca a chi sta in prigione', game.pendingAction?.playerId === 'c');

  game.bidAuction('c', 200); // offre tutta la sua cassa
  const multa = game.payJailFine('c');
  check('a metà asta la multa è rifiutata', !!multa.error, JSON.stringify(multa));
  check('il saldo non è cambiato', carla.balance === 200, `saldo=${carla.balance}`);
  check('e resta in prigione', carla.inJail === true);

  game.passAuction('d'); // resta solo Carla: si aggiudica la casella
  check('la casella va a chi ha offerto', game.ownership[1]?.ownerId === 'c');
  check(
    'e chi se l\'aggiudica riesce a pagarla: niente saldo negativo',
    carla.balance === 0,
    `saldo=${carla.balance} (senza il congelamento finiva a -50)`
  );
  check(
    'nessun rosso senza un debito aperto a chiederne il rientro',
    !(carla.balance < 0 && !game.pendingAction),
    `saldo=${carla.balance}, pendente=${game.pendingAction?.type || 'nessuna'}`
  );
}

// ---------------------------------------------------------------------------
section('32i. La multa della prigione non aggira nemmeno il congelamento dello scambio');
{
  // Stesso principio dell'asta, e stesso trattamento che hanno già la
  // costruzione e il riscatto: mentre una proposta di scambio è in sospeso il
  // denaro di chi ci sta dentro non deve muoversi, altrimenti la proposta
  // diventa irricevibile fra quando è stata fatta e quando le si risponde.
  const game = new GameEngine('MULTA-SCAMBIO');
  ['Anna', 'Bruno', 'Carla'].forEach((nome, i) => {
    game.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗'][i]);
  });
  game.start();
  const carla = game.players[2];
  carla.inJail = true;
  carla.position = 10;
  carla.balance = 200;
  game.ownership[1] = { ownerId: 'a', houses: 0, hotels: 0, mortgaged: false };

  game.proposeTrade('a', { toId: 'c', offerProperties: [1], offerMoney: 0, requestProperties: [], requestMoney: 180 });
  check('la proposta è in sospeso verso Carla', game.pendingAction?.type === 'awaiting_trade');

  const multa = game.payJailFine('c');
  check('con una proposta aperta la multa è rifiutata', !!multa.error, JSON.stringify(multa));
  check('il denaro promesso è ancora tutto lì', carla.balance === 200, `saldo=${carla.balance}`);

  game.respondTrade('c', true);
  check('così la proposta si può ancora accettare', game.ownership[1]?.ownerId === 'c', JSON.stringify(game.pendingAction));

  // Controprova: chiuse le finestre, la multa si paga come sempre. Il saldo si
  // rimette a posto a mano perché lo scambio appena concluso se l'è portato via
  // quasi tutto, e qui interessa il congelamento, non il conto in tasca.
  carla.balance = 200;
  const dopo = game.payJailFine('c');
  check('senza finestre aperte la multa si paga normalmente', !dopo.error, JSON.stringify(dopo));
  check('esce di prigione', carla.inJail === false);
}

// ---------------------------------------------------------------------------
section('32g. Il turno non si chiude con una proposta d\'acquisto aperta');
{
  // Il riquadro "proprietà libera" era l'unica finestra che endTurn non
  // guardava, e da lì passava una mossa che nel Monopoli non esiste: premere
  // "Fine" chiudeva il turno, faceva sparire la proposta e saltava l'asta.
  // Chi lo faceva non subiva nemmeno la conseguenza normale del rifiuto — la
  // casella restava libera per il proprio giro dopo, invece di finire all'asta
  // dove chiunque avrebbe potuto prendersela.
  const game = new GameEngine('FINE-ACQUISTO');
  game.addPlayer('a', 'Anna', '🎩');
  game.addPlayer('b', 'Bruno', '🐕');
  game.addPlayer('c', 'Carla', '🚗');
  game.start();

  // Si tira davvero, non si sposta la pedina a mano: "Fine" arriva dopo un
  // tiro, ed è il tiro che azzera turnResolved. 1+2 = Vicolo Stretto, libera,
  // e non è un doppio.
  const dadi = [0, 0.2];
  const realRandom = Math.random;
  Math.random = () => (dadi.length ? dadi.shift() : 0.5);
  game.rollDice('a');
  Math.random = realRandom;
  check('il tiro apre la proposta d\'acquisto', game.pendingAction?.type === 'awaiting_buy', JSON.stringify(game.pendingAction));

  const fine = game.endTurn();
  check('"Fine" è rifiutato finché non si decide', !!fine.error, JSON.stringify(fine));
  check('la proposta d\'acquisto resta aperta', game.pendingAction?.type === 'awaiting_buy');
  check('e il turno non è passato a nessuno', game.currentPlayer.id === 'a');

  // Rinunciando si passa dalla strada giusta: la casella va all'asta, come
  // deve, e chiunque può prendersela.
  game.declineBuy('a');
  check('rinunciando la casella va all\'asta, non sparisce', game.pendingAction?.type === 'awaiting_auction');
  check('l\'asta è sulla casella su cui era atterrato', game.pendingAction.position === 3, `posizione=${game.pendingAction?.position}`);

  // La controprova dall'altro lato: comprando, il turno si chiude da sé e
  // "Fine" non serve nemmeno.
  const g2 = new GameEngine('FINE-ACQUISTO-2');
  g2.addPlayer('a', 'Anna', '🎩');
  g2.addPlayer('b', 'Bruno', '🐕');
  g2.start();
  const dadi2 = [0, 0.2];
  Math.random = () => (dadi2.length ? dadi2.shift() : 0.5);
  g2.rollDice('a');
  Math.random = realRandom;
  g2.buyProperty('a');
  check('comprando la finestra si chiude', g2.pendingAction === null);
  check('e il turno passa da sé, senza premere "Fine"', g2.currentPlayer.id === 'b', `turno di ${g2.currentPlayer.name}`);
}

// ---------------------------------------------------------------------------
section('33. Regole della casa: si scelgono prima del via, solo dall\'host');
{
  const game = new GameEngine('RULES');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');

  check('di default il Via paga 500', game.rules.goAmount === 500);
  check('di default il montepremi è acceso', game.rules.freeParkingEnabled === true);
  check('di default l\'asta è accesa', game.rules.auctionEnabled === true);
  check('di default il saldo iniziale è 1500', game.rules.startingBalance === 1500);

  const nonHost = game.setRules('b', { goAmount: 200 });
  check('solo chi ha creato il tavolo cambia le regole', !!nonHost.error, nonHost.error);
  check('il tentativo di un non-host non cambia nulla', game.rules.goAmount === 500);

  const goNonValido = game.setRules('a', { goAmount: 999 });
  check('un importo del Via non fra le opzioni ammesse è rifiutato', !!goNonValido.error, goNonValido.error);

  const res = game.setRules('a', {
    goAmount: 200,
    freeParkingEnabled: false,
    auctionEnabled: false,
    startingBalance: 1000,
  });
  check('l\'host può impostare le regole prima del via', !res.error, JSON.stringify(res));
  check('il Via è cambiato a 200', game.rules.goAmount === 200);
  check('il montepremi è spento', game.rules.freeParkingEnabled === false);
  check('l\'asta è spenta', game.rules.auctionEnabled === false);
  check('il saldo iniziale è 1000', game.rules.startingBalance === 1000);
  check(
    'i saldi di chi è già seduto si aggiornano subito',
    game.players.every((p) => p.balance === 1000),
    JSON.stringify(game.players.map((p) => p.balance))
  );

  game.addPlayer('c', 'Luca', '🚗');
  check('chi si unisce dopo la scelta trova già le nuove regole', game.players[2].balance === 1000);

  game.start();
  const dopoIlVia = game.setRules('a', { goAmount: 500 });
  check('a partita iniziata le regole non si cambiano', !!dopoIlVia.error, dopoIlVia.error);
  check('il Via resta quello scelto prima del via', game.rules.goAmount === 200);
}

// ---------------------------------------------------------------------------
section('33b. Via: si incassa l\'importo scelto dalle regole, non il default');
{
  const game = new GameEngine('RULES-GO');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  game.setRules('a', { goAmount: 200 });
  game.start();
  const mario = game.players[0];
  mario.position = 38;
  const prima = mario.balance;
  game.movePlayer(mario, 4); // 38 -> 2, quindi passa dal Via
  check('il Via paga l\'importo scelto (200), non il default (500)', mario.balance === prima + 200, `+${mario.balance - prima}`);

  // Il punto più delicato nel rendere GO_AMOUNT una regola della casa invece
  // di una costante fissa: il testo della carta "Avanza fino al Via" deve
  // citare l'importo di QUESTA partita, non il default cablato in board.js.
  const advanceToGo = game.chanceDeck.find((c) => c.action === 'advance_to' && c.target === 0);
  check(
    'la carta "Avanza fino al Via" cita l\'importo scelto (200)',
    advanceToGo?.text?.includes('200'),
    advanceToGo?.text
  );
  check('e non cita più il default (500)', !advanceToGo?.text?.includes('500'), advanceToGo?.text);
}

// ---------------------------------------------------------------------------
section('33c. Montepremi della Sosta Gratuita: si può spegnere');
{
  const game = new GameEngine('RULES-POT');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  game.setRules('a', { freeParkingEnabled: false });
  game.start();
  const mario = game.players[0];

  mario.position = 0;
  game.movePlayer(mario, 4); // casella 4: Tassa patrimoniale, 200
  game.payTax('a');
  check(
    'con la regola spenta la tassa alla banca non gonfia il montepremi',
    game.freeParkingPot === 0,
    `pot=${game.freeParkingPot}`
  );

  const saldoDopoLaTassa = mario.balance;
  mario.position = 10;
  game.turnResolved = false;
  game.movePlayer(mario, 10); // casella 20: Sosta Gratuita
  check(
    'la Sosta Gratuita non paga nulla con la regola spenta',
    mario.balance === saldoDopoLaTassa,
    `saldo=${mario.balance}`
  );
}

// ---------------------------------------------------------------------------
section('33d. Asta sulla proprietà rifiutata: si può spegnere');
{
  const game = new GameEngine('RULES-AUCTION');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  game.setRules('a', { auctionEnabled: false });
  game.start();
  const mario = game.players[0];

  game.movePlayer(mario, 1); // Vicolo Corto, marrone, libera
  check('atterrando su una libera si apre comunque la proposta d\'acquisto', game.pendingAction?.type === 'awaiting_buy');

  game.declineBuy('a');
  check('con l\'asta spenta la rinuncia non apre un\'asta', game.pendingAction === null);
  check('la casella resta semplicemente libera, come prima che l\'asta esistesse', !game.ownership[1]);
  check('il turno riprende subito dopo la rinuncia', game.turnIndex === 1, `turnIndex=${game.turnIndex}`);
}

// ---------------------------------------------------------------------------
section('33e. Saldo iniziale: si può scegliere fra le opzioni ammesse');
{
  const game = new GameEngine('RULES-BALANCE');
  game.addPlayer('a', 'Mario', '🎩');

  const nonValido = game.setRules('a', { startingBalance: 1234 });
  check('un saldo iniziale non fra le opzioni ammesse è rifiutato', !!nonValido.error, nonValido.error);

  game.setRules('a', { startingBalance: 2000 });
  game.addPlayer('b', 'Giulia', '🐕'); // si unisce dopo la scelta
  game.start();
  check('chi era già seduto parte con il nuovo saldo', game.players[0].balance === 2000, `balance=${game.players[0].balance}`);
  check(
    'chi si unisce dopo la scelta trova lo stesso saldo',
    game.players[1].balance === 2000,
    `balance=${game.players[1].balance}`
  );
}

// ---------------------------------------------------------------------------
section('33f. Le regole della casa sopravvivono alla rivincita');
{
  const game = new GameEngine('RULES-REMATCH');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  game.setRules('a', {
    goAmount: 200,
    freeParkingEnabled: false,
    auctionEnabled: false,
    startingBalance: 2000,
  });
  game.start();

  game.abandonGame('b');
  check('la partita è finita', game.finished === true);

  game.requestRematch('a');
  game.requestRematch('b');
  check('col secondo voto si riparte', game.finished === false);

  check('il Via resta quello scelto', game.rules.goAmount === 200);
  check('il montepremi resta spento', game.rules.freeParkingEnabled === false);
  check('l\'asta resta spenta', game.rules.auctionEnabled === false);
  check('il saldo iniziale resta quello scelto', game.rules.startingBalance === 2000);
  check(
    'i saldi ripartono dal valore scelto, non dal default',
    game.players.every((p) => p.balance === 2000),
    JSON.stringify(game.players.map((p) => p.balance))
  );
}

// ---------------------------------------------------------------------------
section('33g. Le regole della casa sono nello stato serializzato per il client');
{
  const game = newGame();
  const state = game.serialize();
  check('le regole sono esposte al client', !!state.rules);
  check('il Via di default è 500', state.rules.goAmount === 500);
  check('il montepremi di default è acceso', state.rules.freeParkingEnabled === true);
  check('l\'asta di default è accesa', state.rules.auctionEnabled === true);
  check('il saldo iniziale di default è 1500', state.rules.startingBalance === 1500);
}

// ---------------------------------------------------------------------------
section('34. Patrimonio: contanti e proprietà a prezzo pieno');
{
  const game = newGame({ balanceA: 730 });
  const mario = game.players[0];
  check('con solo contanti il patrimonio coincide col saldo', game.netWorth(mario) === 730);

  give(game, 'a', ORANGE[0]); // 180 di prezzo
  check(
    'una proprietà pesa per il prezzo pieno, non per il valore d\'ipoteca dimezzato',
    game.netWorth(mario) === 730 + board[ORANGE[0]].price,
    `atteso ${730 + board[ORANGE[0]].price}, ottenuto ${game.netWorth(mario)}`
  );
}

// ---------------------------------------------------------------------------
section('34b. Comprare a prezzo di listino lascia il patrimonio invariato');
{
  // Scelta di design (l'alternativa era lecita, vedi netWorth in
  // gameEngine.js): il patrimonio pieno valuta una proprietà appena comprata
  // esattamente quanto costa, quindi trasformare contanti in proprietà a
  // prezzo di listino è un pareggio, non un guadagno né una perdita — a
  // differenza di liquidationValue, che la sconterebbe subito a metà prezzo.
  const game = newGame({ balanceA: 1000 });
  const mario = game.players[0];
  const before = game.netWorth(mario);

  game.pendingAction = { type: 'awaiting_buy', playerId: 'a', position: 21, price: board[21].price };
  game.buyProperty('a');

  check('il saldo è sceso del prezzo', mario.balance === 1000 - board[21].price);
  check(
    'il patrimonio resta lo stesso: contanti convertiti in un bene di pari valore',
    game.netWorth(mario) === before,
    `prima ${before}, dopo ${game.netWorth(mario)}`
  );
}

// ---------------------------------------------------------------------------
section('34c. Le case aumentano il patrimonio');
{
  const game = newGame({ balanceA: 500 });
  const mario = game.players[0];
  give(game, 'a', ORANGE[0]);
  const before = game.netWorth(mario);

  // Casa aggiunta direttamente (come fa give() con la proprietà): conta il
  // costo pieno di costruzione, non il rimborso dimezzato di liquidationValue.
  game.ownership[ORANGE[0]].houses = 2;
  const after = game.netWorth(mario);

  check(
    'le case aumentano il patrimonio del loro costo pieno',
    after === before + 2 * board[ORANGE[0]].houseCost,
    `prima ${before}, dopo ${after}`
  );
}

// ---------------------------------------------------------------------------
section('34d. Un\'ipoteca riduce il patrimonio, ma non lo azzera');
{
  const game = newGame({ balanceA: 500 });
  const mario = game.players[0];
  give(game, 'a', BROWN[0]); // prezzo 60
  const beforeMortgage = game.netWorth(mario);
  const square = board[BROWN[0]];
  const value = game.mortgageValue(square);
  const interest = game.mortgageInterest(square);

  game.mortgageProperty('a', BROWN[0]);
  const afterMortgage = game.netWorth(mario);

  check('l\'ipoteca accredita subito metà prezzo in contanti', mario.balance === 500 + value);
  check(
    'il patrimonio scende, non resta invariato',
    afterMortgage < beforeMortgage,
    `prima ${beforeMortgage}, dopo ${afterMortgage}`
  );
  check(
    'ipotecare costa esattamente l\'interesse di riscatto, non il valore intero della proprietà',
    afterMortgage === beforeMortgage - interest,
    `atteso ${beforeMortgage - interest}, ottenuto ${afterMortgage}`
  );
}

// ---------------------------------------------------------------------------
section('34e. Un giocatore fallito vale zero');
{
  const game = newGame({ balanceA: 50 });
  give(game, 'a', BROWN[0]); // vale 60, ipotecabile per 30: non basta comunque
  const mario = game.players[0];
  const giulia = game.players[1];

  game.chargePlayer(mario, 5000, giulia); // debito impossibile da coprire: bancarotta diretta
  check('il giocatore è fallito', mario.bankrupt);
  check('il patrimonio di un fallito è zero', game.netWorth(mario) === 0, `netWorth=${game.netWorth(mario)}`);
}

// ---------------------------------------------------------------------------
section('34f. Il patrimonio è nello stato serializzato per il client');
{
  const game = newGame({ balanceA: 800 });
  give(game, 'a', ORANGE[0]);
  const mario = game.players[0];
  const state = game.serialize();
  const serialized = state.players.find((p) => p.id === 'a');

  check('ogni giocatore serializzato porta il proprio patrimonio', typeof serialized.netWorth === 'number');
  check(
    'il patrimonio serializzato coincide con quello calcolato dal motore',
    serialized.netWorth === game.netWorth(mario),
    `serializzato=${serialized.netWorth}, calcolato=${game.netWorth(mario)}`
  );
  check(
    'serializzare non sporca gli oggetti giocatore interni del motore',
    !('netWorth' in mario)
  );
}

// ---------------------------------------------------------------------------
section('35. Regola della casa: modalità grattacieli, spenta per default');
{
  const game = new GameEngine('SKY-RULE');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');

  check('di default la modalità grattacieli è spenta', game.rules.skyscraperEnabled === false);

  const nonHost = game.setRules('b', { skyscraperEnabled: true });
  check('solo l\'host la accende', !!nonHost.error, nonHost.error);
  check('il tentativo di un non-host non cambia nulla', game.rules.skyscraperEnabled === false);

  const res = game.setRules('a', { skyscraperEnabled: true });
  check('l\'host può accenderla prima del via', !res.error, JSON.stringify(res));
  check('la regola è accesa', game.rules.skyscraperEnabled === true);

  game.start();
  const dopoIlVia = game.setRules('a', { skyscraperEnabled: false });
  check('a partita iniziata non si cambia più', !!dopoIlVia.error, dopoIlVia.error);
  check('resta accesa', game.rules.skyscraperEnabled === true);

  const state = game.serialize();
  check('la regola è esposta al client', state.rules.skyscraperEnabled === true);
}

// ---------------------------------------------------------------------------
section('36. Modalità grattacieli spenta: si ferma al primo hotel, come sempre');
{
  const game = newGame({ balanceA: 5000 }); // skyscraper spenta di default
  ORANGE.forEach((pos) => give(game, 'a', pos, { houses: 4 }));
  const mario = game.players[0];

  const primoHotel = game.buildHouse('a', ORANGE[0]);
  check('il primo hotel si costruisce normalmente', !primoHotel.error, primoHotel.error);
  check('costa come una casa (100), non di più', mario.balance === 5000 - 100, `saldo=${mario.balance}`);
  check('ownership registra un hotel', game.ownership[ORANGE[0]].hotels === 1);
  check('le case tornano a zero', game.ownership[ORANGE[0]].houses === 0);

  const secondoHotel = game.buildHouse('a', ORANGE[0]);
  check('a modalità spenta non si costruisce un secondo hotel', !!secondoHotel.error, secondoHotel.error);
  check('l\'errore è lo stesso di sempre', secondoHotel.error === "C'è già un hotel", secondoHotel.error);
  check('resta un hotel solo, non due', game.ownership[ORANGE[0]].hotels === 1);
  check(
    'l\'affitto resta quello dell\'hotel singolo (950, rents[5] di Via Verdi), non un livello superiore',
    game.calculateRent(board[ORANGE[0]], game.ownership[ORANGE[0]]) === 950
  );

  const rimborso = game.sellHouse('a', ORANGE[0]);
  check('vendere l\'unico hotel riesce', !rimborso.error, rimborso.error);
  check('rende la metà di houseCost (50), il rimborso di sempre', mario.balance === 5000 - 100 + 50);
  check('tornano le quattro case, come sempre', game.ownership[ORANGE[0]].houses === 4 && game.ownership[ORANGE[0]].hotels === 0);
}

// ---------------------------------------------------------------------------
section('37. Modalità grattacieli: costi esatti dei quattro livelli di hotel (tabella concordata)');
{
  // Arancioni, houseCost 100 (riga "rosa/arancione" della tabella): 2°=1.500,
  // 3°=2.200, 4°=3.000. Si parte già al 1° hotel su tutte e tre, così ogni
  // costruzione qui sotto è esattamente il livello che si vuole misurare.
  const game = newGame({ balanceA: 25000, skyscraper: true });
  ORANGE.forEach((pos) => give(game, 'a', pos, { hotels: 1 }));
  const mario = game.players[0];
  let saldo = mario.balance;

  ORANGE.forEach((pos) => {
    const res = game.buildHouse('a', pos);
    check(`il 2° hotel su ${board[pos].name} si costruisce`, !res.error, res.error);
    check('il 2° hotel costa esattamente 1.500', saldo - mario.balance === 1500, `speso=${saldo - mario.balance}`);
    saldo = mario.balance;
  });
  check('tutte e tre hanno 2 hotel', ORANGE.every((pos) => game.ownership[pos].hotels === 2));

  ORANGE.forEach((pos) => {
    const res = game.buildHouse('a', pos);
    check(`il 3° hotel su ${board[pos].name} si costruisce`, !res.error, res.error);
    check('il 3° hotel costa esattamente 2.200', saldo - mario.balance === 2200, `speso=${saldo - mario.balance}`);
    saldo = mario.balance;
  });
  check('tutte e tre hanno 3 hotel', ORANGE.every((pos) => game.ownership[pos].hotels === 3));

  ORANGE.forEach((pos) => {
    const res = game.buildHouse('a', pos);
    check(`il 4° hotel su ${board[pos].name} si costruisce`, !res.error, res.error);
    check('il 4° hotel costa esattamente 3.000', saldo - mario.balance === 3000, `speso=${saldo - mario.balance}`);
    saldo = mario.balance;
  });
  check('tutte e tre hanno 4 hotel: il massimo', ORANGE.every((pos) => game.ownership[pos].hotels === 4));

  const oltre = game.buildHouse('a', ORANGE[0]);
  check('oltre il 4° hotel non si costruisce', !!oltre.error, oltre.error);
  check(
    'l\'errore dice che è già al massimo, non "c\'è già un hotel" (testo da modalità spenta)',
    oltre.error === 'Hai già il massimo di hotel su questa proprietà',
    oltre.error
  );
}

// ---------------------------------------------------------------------------
section('38. Modalità grattacieli: affitti esatti per livello di hotel');
{
  const game = newGame({ skyscraper: true });
  const parco = board[BLUE[1]]; // Parco della Vittoria: rents[5] = 2000
  const giardini = board[BLUE[0]]; // Viale dei Giardini: rents[5] = 1500
  check('Parco della Vittoria è quella giusta', parco.name === 'Parco della Vittoria', parco.name);

  const affittoParco = { 1: 2000, 2: 3400, 3: 5000, 4: 7000 };
  const affittoGiardini = { 1: 1500, 2: 2550, 3: 3750, 4: 5250 };

  [1, 2, 3, 4].forEach((n) => {
    const owned = { ownerId: 'b', houses: 0, hotels: n, mortgaged: false };
    check(
      `Parco della Vittoria con ${n} hotel rende ${affittoParco[n]}`,
      game.calculateRent(parco, owned) === affittoParco[n],
      `ottenuto ${game.calculateRent(parco, owned)}`
    );
    check(
      `Viale dei Giardini con ${n} hotel rende ${affittoGiardini[n]}`,
      game.calculateRent(giardini, owned) === affittoGiardini[n],
      `ottenuto ${game.calculateRent(giardini, owned)}`
    );
  });
}

// ---------------------------------------------------------------------------
section('39. Modalità grattacieli: l\'edificazione uniforme si estende agli hotel oltre il primo');
{
  const game = newGame({ balanceA: 10000, skyscraper: true });
  ORANGE.forEach((pos) => give(game, 'a', pos));
  // Solo la prima è già al 1° hotel; le altre due sono ancora terreno scoperto.
  game.ownership[ORANGE[0]].hotels = 1;

  const salto = game.buildHouse('a', ORANGE[0]);
  check(
    'non si può costruire il 2° hotel finché le altre del colore sono scoperte',
    !!salto.error,
    salto.error
  );
  check('resta un hotel solo, il salto è stato rifiutato', game.ownership[ORANGE[0]].hotels === 1);

  // Pareggiando le altre due al 1° hotel, ora il salto al 2° è consentito.
  game.ownership[ORANGE[1]].hotels = 1;
  game.ownership[ORANGE[2]].hotels = 1;
  const ora = game.buildHouse('a', ORANGE[0]);
  check('col gruppo pareggiato il 2° hotel si costruisce', !ora.error, ora.error);
  check('ora ha 2 hotel', game.ownership[ORANGE[0]].hotels === 2);
}

// ---------------------------------------------------------------------------
section('40. Modalità grattacieli: vendere un hotel oltre il primo non fa comparire case fantasma');
{
  const game = newGame({ skyscraper: true });
  ORANGE.forEach((pos) => give(game, 'a', pos, { hotels: 2 }));
  const mario = game.players[0];
  const saldoPrima = mario.balance;

  const res = game.sellHouse('a', ORANGE[0]);
  check('la vendita del 2° hotel riesce', !res.error, res.error);
  check('resta un hotel, non sparisce del tutto', game.ownership[ORANGE[0]].hotels === 1);
  check(
    'le case NON tornano: non era l\'ultimo hotel rimasto (il difetto delle case fantasma)',
    game.ownership[ORANGE[0]].houses === 0,
    `houses=${game.ownership[ORANGE[0]].houses}`
  );
  check(
    'il rimborso è quello del 2° hotel (750), non la metà di houseCost (50)',
    mario.balance === saldoPrima + 750,
    `saldo=${mario.balance}`
  );
}

// ---------------------------------------------------------------------------
section('41. Modalità grattacieli: vendere l\'ultimo hotel rimasto fa tornare quattro case');
{
  const game = newGame({ skyscraper: true });
  give(game, 'a', ORANGE[0], { hotels: 1 });
  const mario = game.players[0];
  const saldoPrima = mario.balance;

  const res = game.sellHouse('a', ORANGE[0]);
  check('la vendita riesce', !res.error, res.error);
  check('l\'hotel è sparito', game.ownership[ORANGE[0]].hotels === 0);
  check('tornano le quattro case', game.ownership[ORANGE[0]].houses === 4);
  check(
    'il rimborso è la metà di houseCost (50), non di una cifra da grattacielo',
    mario.balance === saldoPrima + 50,
    `saldo=${mario.balance}`
  );
}

// ---------------------------------------------------------------------------
section('42. Modalità grattacieli: liquidationValue somma il rimborso di ogni hotel davvero costruito');
{
  const game = newGame({ balanceA: 500, skyscraper: true });
  give(game, 'a', BLUE[1], { hotels: 4 }); // Parco della Vittoria, houseCost 200, prezzo 400
  const mario = game.players[0];

  // Rimborso di ogni livello scritto a mano (metà del costo di ciascuno, dalla
  // tabella): 4°=3.000 (metà di 6.000), 3°=2.200 (metà di 4.400), 2°=1.500
  // (metà di 3.000), 1°=100 (metà di houseCost, 200). In tutto 6.800.
  const rimborsoEdifici = 3000 + 2200 + 1500 + 100;
  check('il rimborso a mano dei quattro hotel è 6.800', rimborsoEdifici === 6800);

  const ipoteca = 200; // metà del prezzo di Parco della Vittoria (400), non ipotecata
  const atteso = 500 + rimborsoEdifici + ipoteca;
  check(
    'liquidationValue somma contanti, il rimborso di ogni livello di hotel e l\'ipoteca',
    game.liquidationValue(mario) === atteso,
    `atteso ${atteso}, ottenuto ${game.liquidationValue(mario)}`
  );

  // La vecchia formula (unità × rimborso fisso) userebbe unitCount=8 (4
  // "case equivalenti" + 4 livelli di hotel) per un rimborso singolo fisso di
  // 100 (houseCost/2): 8 × 100 = 800, altro che 6.800 — un giocatore con
  // settemila euro di alberghi sotto i piedi verrebbe giudicato quasi al verde.
  check(
    'non vale più la vecchia formula sbagliata (unità × rimborso fisso = 800)',
    game.liquidationValue(mario) !== 500 + 8 * 100 + ipoteca,
    `liquidationValue=${game.liquidationValue(mario)}`
  );
}

// ---------------------------------------------------------------------------
section('43. Modalità grattacieli: netWorth somma il costo pieno di ogni hotel davvero costruito');
{
  const game = newGame({ balanceA: 500, skyscraper: true });
  give(game, 'a', BLUE[1], { hotels: 4 }); // Parco della Vittoria
  const mario = game.players[0];

  // Costo pieno di ogni livello scritto a mano (dalla tabella): 1°=200 (houseCost),
  // 2°=3.000, 3°=4.400, 4°=6.000. In tutto 13.600.
  const costoEdifici = 200 + 3000 + 4400 + 6000;
  check('il costo pieno a mano dei quattro hotel è 13.600', costoEdifici === 13600);

  const prezzoTerreno = 400; // Parco della Vittoria, non ipotecata: prezzo pieno
  const atteso = 500 + costoEdifici + prezzoTerreno;
  check(
    'netWorth somma contanti, il costo pieno di ogni livello di hotel e il terreno',
    game.netWorth(mario) === atteso,
    `atteso ${atteso}, ottenuto ${game.netWorth(mario)}`
  );

  // La vecchia formula (unità × houseCost) userebbe 8 unità × 200 = 1.600,
  // molto meno dei 13.600 veri.
  check(
    'non vale più la vecchia formula sbagliata (unità × houseCost = 1.600)',
    game.netWorth(mario) !== 500 + 8 * 200 + prezzoTerreno,
    `netWorth=${game.netWorth(mario)}`
  );
}

// ---------------------------------------------------------------------------
section('44. Il test che conta di più: costruire quattro hotel su un colore intero e smontarli rende esattamente metà della spesa');
{
  const game = newGame({ balanceA: 30000, skyscraper: true });
  BLUE.forEach((pos) => give(game, 'a', pos)); // le due caselle blu, terreno scoperto
  const mario = game.players[0];
  const saldoIniziale = mario.balance;

  // Otto livelli (4 case + 4 hotel) su entrambe le blu, alternando le due per
  // rispettare l'edificazione uniforme: si costruisce solo dove ce n'è di
  // meno, quindi alternare basta a tenerle sempre pari.
  for (let livello = 1; livello <= 8; livello++) {
    for (const pos of BLUE) {
      const res = game.buildHouse('a', pos);
      check(`costruzione ${livello}/8 su ${board[pos].name} riesce`, !res.error, res.error);
    }
  }
  check('entrambe le blu hanno 4 hotel', BLUE.every((pos) => game.ownership[pos].hotels === 4));
  check('nessuna casa residua', BLUE.every((pos) => game.ownership[pos].houses === 0));

  const totaleSpeso = saldoIniziale - mario.balance;
  // Numeri scritti a mano, NON ricavati da buildingCost: per ciascuna delle
  // due caselle blu (houseCost 200) — 4 case a 200 l'una (800) + 1° hotel a
  // 200 (200, come una casa) + 2° a 3.000 + 3° a 4.400 + 4° a 6.000 = 14.400
  // a casella. Per il colore intero (due caselle): 28.800.
  check('il totale speso per il colore intero è esattamente 28.800', totaleSpeso === 28800, `speso=${totaleSpeso}`);

  const saldoPreVendita = mario.balance;
  // Smonta tutto, un edificio alla volta: alternare le due basta anche qui,
  // sono appaiate e la regola di vendita guarda solo verso il basso.
  for (let livello = 1; livello <= 8; livello++) {
    for (const pos of BLUE) {
      const res = game.sellHouse('a', pos);
      check(`vendita ${livello}/8 su ${board[pos].name} riesce`, !res.error, res.error);
    }
  }
  check(
    'nessun hotel né casa resta su nessuna delle due',
    BLUE.every((pos) => game.ownership[pos].hotels === 0 && game.ownership[pos].houses === 0)
  );

  const totaleRimborsato = mario.balance - saldoPreVendita;
  // Di nuovo a mano, metà di ciascun costo sopra: 4 case a 100 (400) + 1°
  // hotel a 100 + 2° a 1.500 + 3° a 2.200 + 4° a 3.000 = 7.200 a casella,
  // 14.400 per il colore intero.
  check('il totale rimborsato per il colore intero è esattamente 14.400', totaleRimborsato === 14400, `rimborsato=${totaleRimborsato}`);

  check(
    'il denaro tornato è esattamente la metà di quello speso: non un euro in più o in meno',
    totaleRimborsato === totaleSpeso / 2,
    `speso=${totaleSpeso}, rimborsato=${totaleRimborsato}`
  );
  check(
    'il saldo finale coincide col saldo iniziale meno esattamente metà della spesa',
    mario.balance === saldoIniziale - totaleSpeso / 2,
    `saldoIniziale=${saldoIniziale}, saldoFinale=${mario.balance}`
  );
}

// ---------------------------------------------------------------------------
// Chi lascia il tavolo non deve bloccare la partita agli altri
// ---------------------------------------------------------------------------
// I primi tre casi sono stati trovati da invariant-test.js, non a mano: sono la
// ragione per cui quel file esiste. Restano fissati qui perché il fuzzer è
// probabilistico — con un altro seme potrebbe non ripassare da queste strade —
// mentre una regressione su un blocco di partita non deve poter tornare in
// silenzio.
//
// I casi dal 6 in poi arrivano dalla direzione opposta, e vale la pena
// ricordarlo: il fuzzer aveva mostrato uno stato di PASSAGGIO che sembrava
// innocuo (il turno intestato a chi era appena uscito, con un'asta ancora
// aperta fra gli altri), e a guardarlo da vicino l'asta si è rivelata l'unico
// caso davvero sicuro dei tre possibili. Le altre due finestre che possono
// riguardare giocatori diversi da chi ha il turno — lo scambio e il debito
// altrui — congelavano la partita per sempre non appena si chiudevano. Quelle
// due sequenze il fuzzer non le ha mai pescate in milioni di mosse: servono
// tre giocatori che fanno la cosa giusta nell'ordine giusto.
{
  console.log('\n--- Abbandoni che congelavano la partita ---');

  const tavolo = (n) => {
    const g = new GameEngine('LEAVE');
    ['Anna', 'Bruno', 'Carla', 'Dino'].slice(0, n).forEach((nome, i) => {
      g.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗', '🚢'][i]);
    });
    g.start();
    return g;
  };

  // 1. Chi abbandona PRIMA di tirare, nel proprio turno. `turnResolved` è
  // ancora alzato dalla chiusura del turno precedente (si azzera solo quando si
  // tira), quindi endTurn si fermava subito e il turno restava intestato a chi
  // era appena uscito: con tre o più giocatori nessuno poteva più muovere, per
  // sempre. Ora il turno avanza a mano (advanceTurn).
  {
    const g = tavolo(3);
    g.rollDice('a');
    while (g.pendingAction) {
      const pa = g.pendingAction;
      if (pa.type === 'awaiting_buy') g.declineBuy(pa.playerId);
      else if (pa.type === 'awaiting_card') g.acknowledgeCard(pa.playerId);
      else if (pa.type === 'awaiting_rent') g.payRent(pa.playerId);
      else if (pa.type === 'awaiting_tax') g.payTax(pa.playerId);
      else if (pa.type === 'awaiting_auction') g.passAuction(pa.playerId);
      else break;
    }
    if (g.currentPlayer?.id === 'a') g.endTurn();
    const diTurno = g.currentPlayer.id;
    check('prima dell\'abbandono il turno non è ancora stato "risolto" da un tiro', g.turnResolved === true);
    g.abandonGame(diTurno);
    check(
      'chi abbandona prima di tirare non si tiene il turno: la partita va avanti',
      !g.currentPlayer.bankrupt,
      `il turno è rimasto a ${g.currentPlayer.name}, in bancarotta`
    );
  }

  // 2. Affitto verso chi non è più il padrone di casa. La finestra dell'affitto
  // si apre col proprietario congelato dentro; se quello abbandona prima che
  // l'affitto venga confermato, le sue proprietà tornano libere — ma l'affitto
  // veniva pagato comunque a lui: soldi tolti a chi paga per una casella di
  // nessuno, e accreditati a un giocatore in bancarotta, che deve stare a zero.
  {
    const g = tavolo(3);
    g.ownership[1] = { ownerId: 'b', houses: 0, hotels: 0, mortgaged: false };
    // Anna finisce sulla casella di Bruno e si apre la richiesta d'affitto.
    g.players.find((p) => p.id === 'a').position = 1;
    g.resolveLanding(g.players.find((p) => p.id === 'a'));
    check('la richiesta d\'affitto è aperta verso Bruno', g.pendingAction?.type === 'awaiting_rent');
    const saldoAnna = g.players.find((p) => p.id === 'a').balance;
    g.abandonGame('b');
    check('abbandonando, la casella di Bruno torna libera', !g.ownership[1]);
    g.payRent('a');
    const bruno = g.players.find((p) => p.id === 'b');
    check('Anna non paga l\'affitto di una casella che non è più di nessuno',
      g.players.find((p) => p.id === 'a').balance === saldoAnna,
      `saldo passato da ${saldoAnna} a ${g.players.find((p) => p.id === 'a').balance}`);
    check('e Bruno, in bancarotta, resta a saldo zero', bruno.balance === 0, `saldo=${bruno.balance}`);
    check('la finestra dell\'affitto si chiude comunque', g.pendingAction?.type !== 'awaiting_rent');
  }

  // 3. Proposta di scambio di chi poi esce dal tavolo. Restava aperta: chi
  // l'aveva ricevuta, premendo "accetta", otteneva solo un errore che non
  // poteva risolvere in alcun modo — l'unica via d'uscita era indovinare che
  // andasse rifiutata.
  {
    const g = tavolo(3);
    g.ownership[1] = { ownerId: 'a', houses: 0, hotels: 0, mortgaged: false };
    g.proposeTrade('a', { toId: 'b', offerProperties: [1], offerMoney: 0, requestProperties: [], requestMoney: 100 });
    check('la proposta è in sospeso', g.pendingAction?.type === 'awaiting_trade');
    g.abandonGame('a');
    check(
      'la proposta di chi lascia il tavolo decade da sé',
      g.pendingAction === null,
      `resta ${g.pendingAction?.type}`
    );
  }

  // 4. Il rovescio: un abbandono durante il turno di un ALTRO non deve
  // interrompere quel turno. È la ragione per cui la correzione è condizionata
  // e non incondizionata.
  {
    const g = tavolo(3);
    const primo = g.currentPlayer.id;
    g.abandonGame(primo === 'c' ? 'a' : 'c');
    check('chi abbandona fuori dal proprio turno non sposta il turno di nessuno', g.currentPlayer.id === primo);
  }

  // 5. A partita finita non deve restare aperta nessuna finestra: verrebbe
  // mostrata sopra la schermata di fine partita, chiedendo una decisione che
  // non si può più prendere.
  {
    const g = tavolo(2);
    g.players.find((p) => p.id === 'a').position = 5;
    g.resolveLanding(g.players.find((p) => p.id === 'a'));
    const finestraAperta = g.pendingAction?.type;
    g.abandonGame('a');
    check('con l\'abbandono in due la partita finisce', g.finished === true);
    check(
      `nessuna finestra sopravvive alla fine della partita (era ${finestraAperta || 'nessuna'})`,
      g.pendingAction === null,
      `resta ${g.pendingAction?.type}`
    );
  }

  // 6. Asta in corso fra gli ALTRI mentre chi l'ha aperta abbandona. Il turno
  // resta formalmente suo fino alla chiusura dell'asta — abandonGame non lo
  // sposta, perché una finestra aperta congela comunque la partita — e a
  // rimetterlo in moto ci pensa closeAuction con finishRoll. Funziona per una
  // ragione precisa, che questo test fissa: quando un'asta è aperta
  // `turnResolved` è SEMPRE false. L'asta si apre solo da declineBuy, cioè con
  // una finestra d'acquisto aperta, e una finestra d'acquisto esiste solo
  // dentro la risoluzione di un tiro — rollDice azzera `turnResolved` come
  // prima cosa, ed endTurn (l'unico che lo rialza) quando ci riesce chiude
  // anche la finestra, il che renderebbe impossibile la rinuncia. Se un giorno
  // qualcuno riuscisse ad aprire un'asta a turno già chiuso, endTurn si
  // fermerebbe sulla sua guardia e la partita resterebbe bloccata su un
  // giocatore che non c'è più: è la ragione per cui il controllo su
  // `turnResolved` sta qui dentro e non è un dettaglio.
  {
    const g = tavolo(3);
    // Si arriva alla casella libera tirando davvero i dadi, non spostando la
    // pedina a mano: è il tiro che azzera `turnResolved`, ed è esattamente lo
    // stato che questo test vuole osservare. 1+2 = Vicolo Stretto, libera, e
    // non è un doppio (che darebbe un tiro extra e cambierebbe il finale).
    const dadi = [0, 0.2];
    const realRandom = Math.random;
    Math.random = () => (dadi.length ? dadi.shift() : 0.5);
    g.rollDice('a');
    Math.random = realRandom;
    check('il tiro porta su una casella libera', g.pendingAction?.type === 'awaiting_buy', JSON.stringify(g.pendingAction));

    g.declineBuy('a');
    check('la rinuncia apre l\'asta', g.pendingAction?.type === 'awaiting_auction');
    check(
      'con un\'asta aperta il turno non è mai "già risolto": è ciò che rende sicura l\'attesa',
      g.turnResolved === false
    );

    // Anna rilancia (così resta in coda) e poi lascia il tavolo: l'asta
    // prosegue fra Bruno e Carla.
    g.bidAuction('a', g.pendingAction.minBid);
    g.abandonGame('a');
    check('l\'asta prosegue fra i rimanenti', g.pendingAction?.type === 'awaiting_auction');
    check('e chi ha abbandonato non è più in gara', !g.pendingAction.queue.includes('a'));
    check('il turno resta formalmente suo finché l\'asta è aperta', g.currentPlayer.id === 'a');
    check(
      'ma il turno non risulta risolto, altrimenti la chiusura non potrebbe spostarlo',
      g.turnResolved === false
    );

    while (g.pendingAction?.type === 'awaiting_auction') g.passAuction(g.pendingAction.playerId);
    check('chiusa l\'asta non resta nessuna finestra aperta', g.pendingAction === null);
    check(
      'e il turno è passato a chi è ancora in partita',
      !g.currentPlayer.bankrupt,
      `il turno è rimasto a ${g.currentPlayer.name}, in bancarotta`
    );
  }

  // 7. Scambio aperto fra gli ALTRI due mentre chi ha il turno abbandona.
  // Qui l'attesa non era affatto innocua: respondTrade, per come è fatto, non
  // tocca mai il turno (giustamente: uno scambio si può proporre in qualunque
  // momento e non deve consumare il turno di nessuno). Chiusa la proposta non
  // restava quindi nessuna finestra aperta e nessuno spostava il turno, fermo
  // su chi aveva appena lasciato il tavolo: partita bloccata per sempre.
  {
    const g = tavolo(3);
    g.ownership[1] = { ownerId: 'b', houses: 0, hotels: 0, mortgaged: false };
    // La proposta è fra Bruno e Carla: Anna, che ha il turno, non c'entra
    // nulla — è la differenza col caso 3, dove usciva chi aveva proposto e la
    // proposta decadeva da sé.
    g.proposeTrade('b', { toId: 'c', offerProperties: [1], offerMoney: 0, requestProperties: [], requestMoney: 50 });
    check('la proposta fra gli altri due è in sospeso', g.pendingAction?.type === 'awaiting_trade');

    g.abandonGame('a');
    check('la proposta fra gli altri due sopravvive all\'abbandono', g.pendingAction?.type === 'awaiting_trade');
    check('e il turno resta intestato a chi è uscito finché la finestra è aperta', g.currentPlayer.id === 'a');

    g.respondTrade('c', false);
    check('rispondere allo scambio chiude la finestra', g.pendingAction === null);
    check(
      'e a quel punto il turno passa a chi è ancora in partita',
      !g.currentPlayer.bankrupt,
      `il turno è rimasto a ${g.currentPlayer.name}, in bancarotta: nessuno può più muovere`
    );
  }

  // 8. Debito di un ALTRO giocatore aperto dall'abbandono stesso. Chi eredita
  // le proprietà di un fallito paga subito il 10% sulle ipotecate, e
  // quell'addebito è diretto: può lasciarlo in rosso senza aprire nessun
  // debito (eccezione dichiarata del motore, vedi bankruptPlayer). Il primo
  // che chiama settleNextDebt gli apre la finestra, e uno di quei punti è
  // proprio abandonGame. Il risultato era la stessa trappola del caso 7 per
  // un'altra strada: la finestra è di un altro, il turno resta a chi è uscito,
  // e chi salda il debito non lo sposta — checkDebtResolved passa da
  // finishRoll, ma endTurn si ferma sulla guardia `turnResolved`, alzata dalla
  // chiusura del turno precedente perché chi ha abbandonato non aveva ancora
  // tirato.
  {
    const g = tavolo(4);
    const bruno = g.players.find((p) => p.id === 'b');
    const carla = g.players.find((p) => p.id === 'c');
    // Anna ha il turno e non ha ancora tirato: `turnResolved` è quello alzato
    // dalla chiusura del turno precedente.
    g.turnResolved = true;

    // Carla fallisce verso Bruno lasciandogli una casella ipotecata: Bruno
    // eredita, paga l'interesse e resta in rosso senza debito aperto.
    g.ownership[39] = { ownerId: 'c', houses: 0, hotels: 0, mortgaged: true };
    bruno.balance = 5;
    carla.balance = 0;
    g.bankruptPlayer(carla, bruno);
    check('chi eredita un\'ipoteca può restare in rosso senza debito aperto', bruno.balance < 0 && !g.pendingAction, `saldo=${bruno.balance}`);

    g.abandonGame('a');
    check('l\'abbandono apre il debito rimasto in sospeso di Bruno', g.pendingAction?.type === 'awaiting_debt' && g.pendingAction.playerId === 'b', JSON.stringify(g.pendingAction));
    // Qui il turno si sposta già subito: quando bankruptPlayer richiama
    // finishRoll il debito non è ancora stato aperto (settleNextDebt viene
    // dopo), quindi endTurn arriva in fondo e la rete di sicurezza scatta lì.
    // Prima della correzione si fermava sulla guardia `turnResolved` e il turno
    // restava ad Anna: da lì in poi non si sbloccava più.
    check('il turno non resta a chi è appena uscito', !g.currentPlayer.bankrupt, `il turno è rimasto a ${g.currentPlayer.name}`);

    g.ownership[1] = { ownerId: 'b', houses: 0, hotels: 0, mortgaged: false }; // qualcosa da liquidare
    g.resolveDebtAuto('b');
    check('saldato il debito non resta nessuna finestra aperta', g.pendingAction === null, JSON.stringify(g.pendingAction));
    check(
      'e il turno passa a chi è ancora in partita',
      !g.currentPlayer.bankrupt,
      `il turno è rimasto a ${g.currentPlayer.name}, in bancarotta: nessuno può più muovere`
    );
  }

  // 9. La stessa trappola del caso 8 quando il debito dell'altro giocatore è
  // già aperto PRIMA dell'abbandono. Qui il turno non si può spostare subito —
  // endTurn si ferma, giustamente, sul debito in sospeso — e resta davvero
  // intestato a chi è uscito finché quel debito non si chiude. È il caso che
  // esercita la guardia `turnResolved`: chi salda passa da checkDebtResolved ->
  // finishRoll -> endTurn, e lì il turno risultava già chiuso dal giro
  // precedente, perché chi ha abbandonato non aveva ancora tirato.
  {
    const g = tavolo(3);
    const carla = g.players.find((p) => p.id === 'c');
    g.turnResolved = true; // Anna ha il turno e non ha ancora tirato

    // Bruno cede a Carla Parco della Vittoria ipotecata: chi riceve
    // un'ipotecata paga subito il 10% alla banca, e a Carla quel che ha non
    // basta. Lo scambio si può proporre in qualunque momento e non consuma il
    // turno di nessuno: è così che il debito di un altro giocatore può aprirsi
    // fuori dalla risoluzione di un tiro.
    g.ownership[39] = { ownerId: 'b', houses: 0, hotels: 0, mortgaged: true };
    g.ownership[3] = { ownerId: 'c', houses: 0, hotels: 0, mortgaged: false }; // qualcosa da liquidare
    carla.balance = 5;
    g.proposeTrade('b', { toId: 'c', offerProperties: [39], offerMoney: 0, requestProperties: [], requestMoney: 0 });
    g.respondTrade('c', true);
    check(
      'l\'interesse sull\'ipoteca ricevuta apre il debito di Carla',
      g.pendingAction?.type === 'awaiting_debt' && g.pendingAction.playerId === 'c',
      JSON.stringify(g.pendingAction)
    );

    g.abandonGame('a');
    check('col debito di un altro aperto il turno resta formalmente a chi è uscito', g.currentPlayer.id === 'a');
    check('e il debito di Carla non viene toccato dall\'abbandono', g.pendingAction?.type === 'awaiting_debt' && g.pendingAction.playerId === 'c');

    g.resolveDebtAuto('c');
    check('saldato il debito non resta nessuna finestra aperta', g.pendingAction === null, JSON.stringify(g.pendingAction));
    check(
      'e il turno riparte da chi è ancora in partita',
      !g.currentPlayer.bankrupt,
      `il turno è rimasto a ${g.currentPlayer.name}, in bancarotta: nessuno può più muovere`
    );
  }
}

// ---------------------------------------------------------------------------
// Chi è collegato risulta collegato, e chi non lo è no
// ---------------------------------------------------------------------------
// Segnalato giocando: uno dei giocatori compariva "Disconnesso" mentre stava
// giocando normalmente. Un giocatore può avere PIÙ socket vivi nello stesso
// momento (seconda scheda, telefono che si riconnette prima che la vecchia
// connessione cada, link d'invito riaperto), e il vecchio attachSocket
// cancellava quello precedente pur essendo ancora vivo: chiudendo la seconda
// scheda non restava nessun socket per lui e finiva offline pur continuando a
// giocare dalla prima.
//
// La direzione opposta conta quanto questa: un disconnesso vero deve ancora
// risultare disconnesso, altrimenti "correggendo" il difetto si sarebbe solo
// spenta la funzione.
{
  console.log('\n--- Stato di connessione con più socket per lo stesso giocatore ---');
  const { RoomManager } = require('./src/rooms');

  const rm = new RoomManager();
  const code = rm.createRoom();
  const room = rm.getRoom(code);
  room.game.addPlayer('mario', 'Mario', '🎩');
  room.game.addPlayer('giulia', 'Giulia', '🐕');
  const mario = () => room.game.players.find((p) => p.id === 'mario');

  rm.attachSocket(code, 'sock-A', 'mario');
  rm.attachSocket(code, 'sock-G', 'giulia');
  check('collegandosi risulta collegato', mario().connected === true);

  // Seconda scheda dello stesso giocatore.
  rm.attachSocket(code, 'sock-B', 'mario');
  check('con due schede aperte resta collegato', mario().connected === true);

  // Chiude la seconda: la prima è ancora viva.
  rm.detachSocket('sock-B');
  check(
    'chiudendo la seconda scheda resta collegato: la prima è ancora aperta',
    mario().connected === true,
    'risultava disconnesso pur avendo un socket vivo'
  );

  // Chiude anche la prima: adesso è offline davvero.
  rm.detachSocket('sock-A');
  check(
    'chiuse tutte le schede risulta finalmente disconnesso',
    mario().connected === false,
    'continuava a risultare collegato senza nessun socket'
  );
  check('e la disconnessione di uno non tocca gli altri', room.game.players.find((p) => p.id === 'giulia').connected === true);

  // Rientro.
  rm.attachSocket(code, 'sock-C', 'mario');
  check('rientrando torna collegato', mario().connected === true);

  // La rete di sicurezza: se per qualunque ragione lo stato divergesse, una
  // mossa lo rimette in pari (è quello che fa withGame a ogni azione).
  room.game.setConnected('mario', false);
  room.sockets.delete('sock-C');
  const cambiato = rm.ensureConnected(code, 'sock-C', 'mario');
  check('una mossa rimette in pari uno stato divergente', mario().connected === true && cambiato === true);
  check(
    'e non fa nulla se era già tutto a posto',
    rm.ensureConnected(code, 'sock-C', 'mario') === false
  );
}

// ---------------------------------------------------------------------------
// Il minimo d'asta pubblicato è quello che il motore accetta davvero
// ---------------------------------------------------------------------------
// Il contratto fra motore e interfaccia: `pendingAction.minBid` è l'importo che
// chi deve rispondere può offrire ADESSO, e offrirlo deve funzionare sempre.
// Serve un test su OGNI casella e non su una sola perché il minimo non è fisso
// ma cresce col listino: un controllo su una casella da 60 passa anche con la
// formula sbagliata, ed è precisamente come il difetto è sopravvissuto due
// volte — prima nei bot, che si bloccavano, poi nel client, dove il bottone
// "Rilancia" mandava 10 su 24 caselle su 28 e il motore rifiutava in silenzio.
{
  console.log('\n--- Il rilancio minimo pubblicato è sempre valido ---');

  const acquistabili = board.filter((s) => s.price);
  let primoOk = 0;
  let secondoOk = 0;
  let coerenteConIncremento = 0;

  for (const square of acquistabili) {
    const g = new GameEngine('AST');
    g.addPlayer('a', 'Anna', '🎩');
    g.addPlayer('b', 'Bruno', '🐕');
    g.addPlayer('c', 'Carla', '🚗');
    g.setRules(g.hostId, { auctionEnabled: true, startingBalance: 2000 });
    g.start();

    // openAuction vuole l'oggetto giocatore che ha rifiutato, non il suo id.
    g.openAuction(square.position, g.players.find((p) => p.id === 'a'));
    const pa = g.pendingAction;
    if (pa?.type !== 'awaiting_auction') continue;

    // I valori vanno letti PRIMA di offrire: pendingAction è lo stesso oggetto
    // che bidAuction modifica sul posto, quindi dopo il rilancio minBid è già
    // quello del giro successivo.
    const minBidIniziale = pa.minBid;
    const incrementoIniziale = pa.minIncrement;
    // Primo rilancio: esattamente il minimo pubblicato.
    if (!g.bidAuction(pa.playerId, minBidIniziale).error) primoOk += 1;
    // Secondo rilancio: il minimo si è aggiornato e vale ancora.
    const dopo = g.pendingAction;
    if (dopo?.type === 'awaiting_auction' && !g.bidAuction(dopo.playerId, dopo.minBid).error) secondoOk += 1;
    // E il minimo dev'essere l'offerta corrente più lo scatto, non un fisso.
    const atteso = g.auctionMinIncrement(square);
    if (incrementoIniziale === atteso && minBidIniziale === atteso) coerenteConIncremento += 1;
  }

  check(
    `offrire il minimo pubblicato riesce su tutte e ${acquistabili.length} le caselle acquistabili`,
    primoOk === acquistabili.length,
    `riuscito su ${primoOk}`
  );
  check(
    'e riesce anche al secondo rilancio, quando il minimo si è già alzato',
    secondoOk === acquistabili.length,
    `riuscito su ${secondoOk}`
  );
  check(
    'il minimo iniziale è lo scatto proporzionale al listino, non un valore fisso',
    coerenteConIncremento === acquistabili.length,
    `coerente su ${coerenteConIncremento}`
  );

  // La prova che un valore fisso NON basta: è la formula che aveva il client.
  const conFormulaFissa = acquistabili.filter((s) => g0MinFisso(s) < g0MinVero(s)).length;
  function g0MinFisso() { return 10; }
  function g0MinVero(square) {
    const g = new GameEngine('AST2');
    return g.auctionMinIncrement(square);
  }
  check(
    `su ${conFormulaFissa} caselle un rilancio fisso da 10 sarebbe sotto il minimo (era il difetto)`,
    conFormulaFissa === 24,
    `contate ${conFormulaFissa}`
  );
}

// ---------------------------------------------------------------------------
section('45. Turno bloccato: saltare il turno di chi è disconnesso');
{
  /**
   * Tavolo pronto con Anna di turno e già caduta: è la situazione che prima
   * bloccava la partita per tutti senza rimedio. `giocatori` serve a provare
   * sia il caso in due (dove chi salta è per forza l'unico altro) sia quello in
   * tre (dove a saltare può essere qualcuno che non ha creato il tavolo).
   */
  function tavoloFermo({ giocatori = 3, connessa = false, regole = null } = {}) {
    const g = new GameEngine('SKIP');
    g.addPlayer('a', 'Anna', '🎩');
    g.addPlayer('b', 'Bruno', '🐕');
    if (giocatori >= 3) g.addPlayer('c', 'Carla', '🚗');
    // Le regole della casa si scelgono solo prima del via (vedi setRules):
    // dopo start() qualunque cambiamento verrebbe rifiutato in silenzio.
    if (regole) g.setRules('a', regole);
    g.start();
    if (!connessa) g.setConnected('a', false);
    return g;
  }
  // Un'attesa abbondantemente scaduta e una che non lo è ancora: il tempo lo
  // misura la stanza (vedi rooms.js), qui si passa il numero e basta.
  const SCADUTA = SKIP_TURN_DELAY_MS;
  const NON_SCADUTA = SKIP_TURN_DELAY_MS - 1;

  // --- Il caso felice ---
  {
    const g = tavoloFermo();
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('un altro giocatore può saltare il turno di chi è disconnesso', !esito.error, esito.error);
    check('il turno passa al giocatore successivo', g.currentPlayer.id === 'b');
    check('il registro dice chi ha saltato chi',
      g.log.some((l) => l.message.includes('Bruno') && l.message.includes('Anna')));
  }

  // --- La direzione opposta: quando NON si deve poter saltare ---
  {
    const g = tavoloFermo({ connessa: true });
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('non si salta il turno di un giocatore COLLEGATO', !!esito.error, 'nessun errore');
    check('e il turno resta suo', g.currentPlayer.id === 'a');
  }
  {
    const g = tavoloFermo();
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: NON_SCADUTA });
    check('non si salta un millisecondo prima della soglia', !!esito.error, 'nessun errore');
    check('l\'errore dice quanti secondi mancano', /\d+s/.test(esito.error || ''), esito.error);
    check('e il turno resta suo', g.currentPlayer.id === 'a');
  }
  {
    const g = tavoloFermo();
    check('non si salta a tempo zero (appena caduto)', !!g.skipDisconnectedTurn('b', { fermoDaMs: 0 }).error);
    check('e nemmeno senza passare affatto il tempo (parametro omesso)',
      !!g.skipDisconnectedTurn('b').error);
    check('il turno è ancora di Anna dopo tutti i rifiuti', g.currentPlayer.id === 'a');
  }
  {
    const g = tavoloFermo();
    g.setConnected('b', false);
    check('un giocatore a sua volta disconnesso non può saltare nessuno',
      !!g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA }).error);
  }
  {
    const g = tavoloFermo();
    // Anna prova a saltare sé stessa: non è un caso reale (chi manda l'evento è
    // collegato), ma il motore non deve fidarsi di chi lo chiama.
    check('non si salta il proprio turno', !!g.skipDisconnectedTurn('a', { fermoDaMs: SCADUTA }).error);
    check('e nemmeno da fuori dal tavolo', !!g.skipDisconnectedTurn('sconosciuto', { fermoDaMs: SCADUTA }).error);
  }
  {
    const g = tavoloFermo();
    g.players.find((p) => p.id === 'c').bankrupt = true;
    check('chi è fallito non decide più: non può saltare',
      !!g.skipDisconnectedTurn('c', { fermoDaMs: SCADUTA }).error);
  }
  {
    const g = new GameEngine('SKIP');
    g.addPlayer('a', 'Anna', '🎩');
    g.addPlayer('b', 'Bruno', '🐕');
    g.setConnected('a', false);
    check('prima del via non c\'è nessun turno da saltare',
      !!g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA }).error);
    g.start();
    g.finished = true;
    check('a partita finita nemmeno',
      !!g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA }).error);
  }
  {
    // Una finestra intestata a un ALTRO giocatore, che è collegato e può
    // rispondere: la partita non è ferma per colpa del disconnesso, e saltare
    // il turno la lascerebbe congelata lo stesso.
    const g = tavoloFermo();
    give(g, 'c', 39);
    g.pendingAction = { type: 'awaiting_rent', playerId: 'c', position: 39, amount: 50, ownerId: 'b', doubled: false };
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('non si salta se il tavolo aspetta la risposta di un altro', !!esito.error, 'nessun errore');
    check('l\'errore nomina chi deve rispondere', (esito.error || '').includes('Carla'), esito.error);
    check('e la finestra dell\'altro resta aperta', g.pendingAction?.playerId === 'c');
  }

  // --- Non è un'espulsione: non gli si toglie niente ---
  {
    const g = tavoloFermo();
    const anna = g.players.find((p) => p.id === 'a');
    give(g, 'a', 1);
    give(g, 'a', 3, { houses: 0 });
    anna.balance = 1234;
    anna.position = 17;
    anna.jailCards = 2;
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('chi viene saltato resta al tavolo', g.players.some((p) => p.id === 'a'));
    check('non va in bancarotta', anna.bankrupt === false);
    check('tiene il suo denaro', anna.balance === 1234);
    check('tiene le sue proprietà', g.propertiesOf('a').length === 2);
    check('tiene la sua posizione sul tabellone', anna.position === 17);
    check('tiene le sue carte "esci di prigione"', anna.jailCards === 2);
    check('resta segnato come disconnesso, non come uscito', anna.connected === false);
    check('la partita non finisce', g.finished === false);
  }
  {
    // In prigione: saltare non consuma un tentativo di uscita. Sarebbe un
    // danno vero, e per un motivo che non dipende da lui.
    const g = tavoloFermo();
    const anna = g.players.find((p) => p.id === 'a');
    anna.inJail = true;
    anna.jailTurns = 1;
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('chi è in prigione ci resta senza consumare un tentativo',
      anna.inJail === true && anna.jailTurns === 1);
  }

  // --- Chi può chiedere il salto ---
  {
    const g = tavoloFermo();
    check('l\'host del tavolo è Anna, quella caduta', g.hostId === 'a');
    const esito = g.skipDisconnectedTurn('c', { fermoDaMs: SCADUTA });
    check('anche chi NON ha creato il tavolo può sbloccare la partita', !esito.error, esito.error);
    check('il turno è passato', g.currentPlayer.id === 'b');
  }
  {
    const g = tavoloFermo({ giocatori: 2 });
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('funziona anche in due, dove chi salta è l\'unico rimasto sveglio', !esito.error, esito.error);
    check('e la mano passa a lui', g.currentPlayer.id === 'b');
  }

  // --- Le finestre aperte a suo nome: il modo in cui la partita si congelava ---
  {
    // Proposta d'acquisto: rinuncia. Con l'asta accesa la casella va all'asta
    // fra gli altri, esattamente come se avesse detto "no, grazie".
    const g = tavoloFermo({ regole: { auctionEnabled: false } });
    const anna = g.players.find((p) => p.id === 'a');
    anna.position = 1;
    g.resolveLanding(anna);
    check('preparazione: Anna ha una proposta d\'acquisto aperta', g.pendingAction?.type === 'awaiting_buy');
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('la proposta d\'acquisto del disconnesso si chiude', !esito.error && g.pendingAction === null, esito.error);
    check('non compra nulla al posto suo', g.ownership[1] === undefined);
    check('e il turno prosegue', g.currentPlayer.id === 'b');
  }
  {
    // Stessa cosa con l'asta accesa: rinunciando si apre l'asta, dove Anna è
    // la prima a dover parlare — e passa. La partita resta in mano a chi c'è.
    const g = tavoloFermo({ regole: { auctionEnabled: true } });
    const anna = g.players.find((p) => p.id === 'a');
    anna.position = 39;
    g.resolveLanding(anna);
    check('preparazione: proposta d\'acquisto su Parco della Vittoria', g.pendingAction?.type === 'awaiting_buy');
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    const dopo = g.pendingAction;
    check('con l\'asta accesa la casella va all\'asta fra gli altri',
      dopo === null || (dopo.type === 'awaiting_auction' && dopo.playerId !== 'a'),
      JSON.stringify(dopo));
    check('e non è più Anna a dover parlare', dopo === null || dopo.playerId !== 'a');
  }
  {
    // Affitto: si paga per lui. Chiudere e basta la finestra vorrebbe dire
    // regalargli l'affitto e derubare il padrone di casa — e diventerebbe una
    // scorciatoia da usare apposta.
    const g = tavoloFermo();
    give(g, 'b', 39);
    const anna = g.players.find((p) => p.id === 'a');
    const bruno = g.players.find((p) => p.id === 'b');
    anna.balance = 1000;
    bruno.balance = 1000;
    anna.position = 37;
    g.movePlayer(anna, 2);
    check('preparazione: Anna deve un affitto a Bruno', g.pendingAction?.type === 'awaiting_rent');
    const dovuto = g.pendingAction.amount;
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('l\'affitto viene pagato lo stesso, non cancellato', anna.balance === 1000 - dovuto);
    check('e il padrone di casa lo incassa', bruno.balance === 1000 + dovuto);
    check('nessuna finestra resta aperta', g.pendingAction === null);
    check('il turno prosegue', g.currentPlayer.id === 'b');
  }
  {
    // Tassa: identica all'affitto, e con una coda — il saldo non basta, quindi
    // si apre un debito sempre intestato a lui, che va risolto nello stesso
    // giro o la partita resta ferma esattamente come prima.
    const g = tavoloFermo();
    const anna = g.players.find((p) => p.id === 'a');
    anna.balance = 10;
    give(g, 'a', 39); // patrimonio da liquidare: 200 di ipoteca, più che sufficienti
    anna.position = 2;
    g.movePlayer(anna, 2); // casella 4: Tassa patrimoniale, 200
    check('preparazione: Anna ha una tassa da pagare', g.pendingAction?.type === 'awaiting_tax');
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('la tassa si paga e il debito che ne segue si liquida da sé',
      !esito.error && g.pendingAction === null, `${esito.error || ''} ${JSON.stringify(g.pendingAction)}`);
    check('il saldo torna in pari senza bancarotta', anna.balance >= 0 && anna.bankrupt === false);
    check('ha pagato ipotecando, non perdendo la proprietà', g.ownership[39]?.ownerId === 'a');
    check('e la proprietà risulta ipotecata', g.ownership[39]?.mortgaged === true);
    check('il turno prosegue', g.currentPlayer.id === 'b');
  }
  {
    // Debito già aperto: si liquida, non ci si arrende mai al posto suo.
    const g = tavoloFermo();
    const anna = g.players.find((p) => p.id === 'a');
    give(g, 'a', 39);
    anna.balance = 0;
    g.chargePlayer(anna, 150);
    check('preparazione: Anna ha un debito aperto', g.pendingAction?.type === 'awaiting_debt');
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('il debito viene coperto liquidando, non con la bancarotta',
      anna.bankrupt === false && anna.balance >= 0);
    check('la partita riparte', g.pendingAction === null && g.currentPlayer.id === 'b');
  }
  {
    // Carta pescata e mai letta: è la finestra che blocca tutti pur non
    // chiedendo nessuna decisione.
    const g = tavoloFermo();
    const anna = g.players.find((p) => p.id === 'a');
    g.drawCard(anna, 'community');
    check('preparazione: Anna ha una carta da leggere', g.pendingAction?.type === 'awaiting_card');
    const esito = g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('la carta viene letta e applicata al posto suo', !esito.error, esito.error);
    check('e non resta una finestra intestata ad Anna',
      g.pendingAction === null || g.pendingAction.playerId !== 'a', JSON.stringify(g.pendingAction));
  }
  {
    // Scambio proposto a chi è caduto: si rifiuta. Accettare al posto suo
    // vorrebbe dire firmare un contratto per un altro.
    const g = tavoloFermo();
    give(g, 'b', 1);
    const esito0 = g.proposeTrade('b', { toId: 'a', offerProperties: [1], requestMoney: 100 });
    check('preparazione: c\'è uno scambio in attesa della risposta di Anna',
      !esito0.error && g.pendingAction?.type === 'awaiting_trade', esito0.error);
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('lo scambio viene rifiutato, mai accettato al posto suo',
      g.pendingAction === null && g.ownership[1].ownerId === 'b');
    check('e nessun denaro cambia mano', g.players.find((p) => p.id === 'a').balance === 1500);
  }
  {
    // Asta in cui tocca a lui rilanciare: passa. Offrire per un altro
    // significherebbe spendere i suoi soldi.
    const g = tavoloFermo();
    const anna = g.players.find((p) => p.id === 'a');
    g.openAuction(39, anna);
    check('preparazione: tocca ad Anna rilanciare', g.pendingAction?.type === 'awaiting_auction' && g.pendingAction.playerId === 'a');
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('passa l\'asta invece di offrire al posto suo', anna.balance === 1500);
    check('e l\'asta non aspetta più lei',
      g.pendingAction === null || g.pendingAction.playerId !== 'a', JSON.stringify(g.pendingAction));
  }

  // --- Il giro dopo ---
  {
    const g = tavoloFermo({ giocatori: 2 });
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('preparazione: tocca a Bruno', g.currentPlayer.id === 'b');
    g.rollDice('b');
    while (g.pendingAction) {
      const pa = g.pendingAction;
      if (pa.type === 'awaiting_buy') g.declineBuy(pa.playerId);
      else if (pa.type === 'awaiting_auction') g.passAuction(pa.playerId);
      else if (pa.type === 'awaiting_card') g.acknowledgeCard(pa.playerId);
      else if (pa.type === 'awaiting_rent') g.payRent(pa.playerId);
      else if (pa.type === 'awaiting_tax') g.payTax(pa.playerId);
      else if (pa.type === 'awaiting_debt') g.resolveDebtAuto(pa.playerId);
      else break;
    }
    if (g.currentPlayer.id === 'b') g.endTurn();
    check('il giro torna al disconnesso: la partita non lo esclude',
      g.currentPlayer.id === 'a' || g.finished, `turno di ${g.currentPlayer.id}`);
    if (!g.finished && g.currentPlayer.id === 'a') {
      check('e lo si può saltare di nuovo, se ancora non è tornato',
        !g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA }).error);
    }
  }
  {
    const g = tavoloFermo({ giocatori: 2 });
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    // Anna rientra: da qui in poi gioca lei, e nessuno può più saltarla.
    g.setConnected('a', true);
    g.endTurn();
    check('preparazione: il turno è tornato ad Anna, che è rientrata', g.currentPlayer.id === 'a');
    check('rientrata, non la si salta più', !!g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA }).error);
    check('e può giocare normalmente', !g.rollDice('a').error);
  }
  {
    // Il tiro extra da doppio non protegge dal salto: se è caduto non lo
    // giocherà nessuno, e il turno deve andare avanti lo stesso.
    const g = tavoloFermo({ giocatori: 2 });
    g.lastRollWasDouble = true;
    g.skipDisconnectedTurn('b', { fermoDaMs: SCADUTA });
    check('nemmeno un doppio tiene fermo il tavolo su chi è caduto', g.currentPlayer.id === 'b');
  }

  check('la soglia esportata dal motore è un minuto', SKIP_TURN_DELAY_MS === 60 * 1000);
}

// ---------------------------------------------------------------------------
section('46. Turno bloccato: l\'orologio della stanza (rooms.js)');
{
  const { RoomManager } = require('./src/rooms');
  const rooms = new RoomManager();
  const code = rooms.createRoom();
  const room = rooms.getRoom(code);
  room.game.addPlayer('a', 'Anna', '🎩');
  room.game.addPlayer('b', 'Bruno', '🐕');
  rooms.attachSocket(code, 's-a', 'a');
  rooms.attachSocket(code, 's-b', 'b');
  room.game.start();

  const T0 = 1_000_000; // un istante qualunque: tutti i conti sono relativi
  rooms.noteTurn(code, T0);

  check('con tutti collegati non c\'è nessun turno fermo', rooms.stalledTurnMs(code, T0 + 999_999) === null);
  check('e non c\'è niente da dire al client', rooms.blockedTurn(code, T0 + 999_999) === null);

  // Anna cade mezzo minuto dopo l'inizio del suo turno.
  rooms.detachSocket('s-a', T0 + 30_000);
  check('appena caduta, il turno risulta fermo da zero',
    rooms.stalledTurnMs(code, T0 + 30_000) === 0);
  check('l\'attesa NON parte dall\'inizio del turno ma dalla caduta',
    rooms.stalledTurnMs(code, T0 + 40_000) === 10_000);
  check('il client riceve quanto manca, non un istante di scadenza',
    rooms.blockedTurn(code, T0 + 40_000)?.attesaRimanenteMs === SKIP_TURN_DELAY_MS - 10_000);
  check('e riceve di chi si tratta', rooms.blockedTurn(code, T0 + 40_000)?.playerId === 'a');
  check('passato il minuto l\'attesa è finita',
    rooms.blockedTurn(code, T0 + 30_000 + SKIP_TURN_DELAY_MS)?.attesaRimanenteMs === 0);
  check('e non scende mai sotto zero',
    rooms.blockedTurn(code, T0 + 10_000_000)?.attesaRimanenteMs === 0);

  // Rientra: l'orologio dell'assenza si azzera del tutto.
  rooms.attachSocket(code, 's-a2', 'a');
  check('rientrando non c\'è più niente di fermo', rooms.stalledTurnMs(code, T0 + 10_000_000) === null);

  // Chi era offline da un'ora prima ancora che gli toccasse: l'attesa parte da
  // quando la mano è arrivata a lui, non da quando era caduto.
  rooms.detachSocket('s-b', T0);
  room.game.endTurn(); // ora tocca a Bruno, che è offline da un pezzo
  rooms.noteTurn(code, T0 + 3_600_000);
  check('chi era già offline non si salta all\'istante: l\'attesa parte dal suo turno',
    rooms.stalledTurnMs(code, T0 + 3_600_000 + 5_000) === 5_000);

  check('una stanza inesistente non ha orologi da leggere', rooms.stalledTurnMs('XXXXX') === null);
  rooms.closeRoom(code);
}

// ---------------------------------------------------------------------------
// Rete di sicurezza: l'asta non chiude mai un conto scoperto in silenzio
// ---------------------------------------------------------------------------
// Oggi non ci si arriva giocando: l'offerta viene confrontata con la cassa
// quando la si fa, e finché l'asta è aperta nessuno può spendere
// (auctionFreezeBlocker). Il punto è che quella garanzia sta ALTROVE rispetto
// al momento in cui il denaro viene davvero scalato, e una volta si era già
// rotta — la multa della prigione non attraversava il congelamento, e chi
// vinceva l'asta finiva a saldo negativo senza nessun debito aperto.
//
// Lo stato di partenza qui sotto è quindi costruito a mano di proposito: è
// impossibile per il motore di oggi, ed è esattamente quello che questa rete
// deve saper reggere se un domani tornasse possibile.
{
  console.log('\n--- L\'asta non lascia mai un conto scoperto ---');
  const game = new GameEngine('ASTA-CASSA');
  ['Anna', 'Bruno', 'Carla', 'Dino'].forEach((nome, i) => {
    game.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗', '🚢'][i]);
  });
  game.start();
  const carla = game.players[2];
  carla.balance = 200;

  game.turnResolved = false;
  game.movePlayer(game.players[0], 1); // Vicolo Corto, libera
  game.declineBuy('a');
  game.passAuction('a');
  game.passAuction('b');
  game.bidAuction('c', 200); // offre tutto quello che ha: fin qui è tutto lecito

  // La spesa impossibile, forzata: è il buco che la multa della prigione apriva.
  carla.balance = 150;
  game.ownership[3] = { ownerId: 'c', houses: 0, hotels: 0, mortgaged: false }; // qualcosa da liquidare
  game.passAuction('d');

  check('la casella va comunque a chi ha vinto l\'asta', game.ownership[1]?.ownerId === 'c');
  check('il conto scoperto non passa in silenzio: si apre un debito', game.pendingAction?.type === 'awaiting_debt' && game.pendingAction.playerId === 'c', JSON.stringify(game.pendingAction));
  check('il debito è dell\'importo mancante', game.pendingAction?.amount === 50, `${game.pendingAction?.amount}`);
  check('e il turno non avanza finché il conto è scoperto', game.currentPlayer.id === 'a');

  game.resolveDebtAuto('c');
  check('saldato il debito il giocatore torna in pari', carla.balance >= 0, `saldo=${carla.balance}`);
  check('nessuna finestra resta aperta', game.pendingAction === null, JSON.stringify(game.pendingAction));
  check('e la partita riprende dal prossimo giocatore', !game.currentPlayer.bankrupt, `turno di ${game.currentPlayer.name}`);

  // Controprova: l'asta normale, dove la cassa basta, non deve aprire proprio
  // nulla — la rete non deve trasformare un acquisto riuscito in un debito.
  const g2 = new GameEngine('ASTA-CASSA-2');
  ['Anna', 'Bruno', 'Carla'].forEach((nome, i) => {
    g2.addPlayer(String.fromCharCode(97 + i), nome, ['🎩', '🐕', '🚗'][i]);
  });
  g2.start();
  g2.turnResolved = false;
  g2.movePlayer(g2.players[0], 1);
  g2.declineBuy('a');
  g2.bidAuction('a', 50);
  g2.passAuction('b');
  g2.passAuction('c');
  check('un\'asta pagabile si chiude senza aprire nessun debito', g2.pendingAction === null, JSON.stringify(g2.pendingAction));
  check('e il prezzo è scalato per intero', g2.players[0].balance === 1450, `${g2.players[0].balance}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
