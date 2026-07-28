// Smoke test del motore di gioco. Nessun framework: si lancia con `node smoke-test.js`
// dalla cartella server. Va eseguito prima e dopo ogni modifica sostanziale a
// gameEngine.js, come da convenzioni del progetto.
const { GameEngine } = require('./src/gameEngine');
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

/** Partita a due pronta al via, con saldi impostati a piacere. */
function newGame({ balanceA = 1500, balanceB = 1500 } = {}) {
  const game = new GameEngine('TEST');
  game.addPlayer('a', 'Mario', '🎩');
  game.addPlayer('b', 'Giulia', '🐕');
  game.start();
  game.players[0].balance = balanceA;
  game.players[1].balance = balanceB;
  return game;
}

/** Assegna una casella a un giocatore senza passare dall'acquisto. */
function give(game, playerId, position, extra = {}) {
  game.ownership[position] = { ownerId: playerId, houses: 0, hotel: false, mortgaged: false, ...extra };
}

// Le tre caselle arancioni: monopolio comodo per i test sull'edificazione.
const ORANGE = board.filter((s) => s.group === 'orange').map((s) => s.position);
const BROWN = board.filter((s) => s.group === 'brown').map((s) => s.position);

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
    if (game.pendingAction?.type === 'awaiting_buy') game.declineBuy('a');
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
  if (game.pendingAction?.type === 'awaiting_buy') game.declineBuy('a');
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
  give(game, 'b', ORANGE[0], { hotel: true }); // affitto da hotel: 950
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

  // Una seconda scheda con la stessa identità sostituisce la prima.
  rooms.attachSocket(code, 'socket-4', 'client-mario');
  check('la seconda scheda subentra alla prima', !room.sockets.has('socket-3') && room.sockets.has('socket-4'));
  check('i giocatori restano due', room.game.players.length === 2);

  // Con tutti scollegati la stanza scade, ma solo dopo il tempo di grazia.
  rooms.detachSocket('socket-4');
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
  g3.ownership[ORANGE[0]] = { ownerId: 'umano', houses: 0, hotel: false, mortgaged: false };
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
  g4.ownership[ORANGE[0]] = { ownerId: bot4.id, houses: 0, hotel: false, mortgaged: false };
  g4.ownership[ORANGE[1]] = { ownerId: bot4.id, houses: 0, hotel: false, mortgaged: false };
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
    g5.ownership[pos] = { ownerId: bot5.id, houses: 0, hotel: false, mortgaged: false };
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
  check('dopo un doppio il bot ritira', g6.lastRoll.seq === 2, `seq=${g6.lastRoll.seq}`);
  check('il tiro extra è suo', g6.lastRoll.playerId === bot6.id);

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
  game.ownership[ORANGE[0]] = { ownerId: 'umano', houses: 0, hotel: false, mortgaged: false };
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
    g.ownership[ORANGE[0]] = { ownerId: bot.id, houses: 0, hotel: false, mortgaged: false };
    g.ownership[ORANGE[1]] = { ownerId: bot.id, houses: 0, hotel: false, mortgaged: false };
    g.ownership[ORANGE[2]] = { ownerId: 'umano', houses: 0, hotel: false, mortgaged: false };
    return { g, bot };
  }

  // Il bot non ripropone lo stesso baratto a chi l'ha appena rifiutato: prima
  // ricalcolava ogni turno la stessa identica offerta e la ripeteva all'infinito.
  {
    const { g, bot } = tavoloDaScambio();
    // Una proprietà di scarto da mettere sul piatto.
    g.ownership[BROWN[0]] = { ownerId: bot.id, houses: 0, hotel: false, mortgaged: false };

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
    g.ownership[LIGHTBLUE[0]] = { ownerId: 'umano', houses: 0, hotel: false, mortgaged: false };
    g.ownership[LIGHTBLUE[1]] = { ownerId: 'umano', houses: 0, hotel: false, mortgaged: false };
    // Il bot possiede sia quella pericolosa sia una marrone innocua.
    g.ownership[LIGHTBLUE[2]] = { ownerId: bot.id, houses: 0, hotel: false, mortgaged: false };
    g.ownership[BROWN[0]] = { ownerId: bot.id, houses: 0, hotel: false, mortgaged: false };

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
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
