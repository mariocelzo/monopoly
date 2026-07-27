// Smoke test del motore di gioco. Nessun framework: si lancia con `node smoke-test.js`
// dalla cartella server. Va eseguito prima e dopo ogni modifica sostanziale a
// gameEngine.js, come da convenzioni del progetto.
const { GameEngine } = require('./src/gameEngine');
const { board } = require('./src/data/board');

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
  give(game, 'a', 5); // King's Cross Station, fuori da ogni monopolio
  give(game, 'a', 15); // Marylebone Station, idem
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
  // Whitechapel: prezzo 60, valore d'ipoteca 30, interesse dovuto 3.
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
  // King's Cross: prezzo 200, ipoteca 100, interesse 10, riscatto 110.
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
  // Whitechapel: prezzo 60, ipoteca 30, interesse 3.
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
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
