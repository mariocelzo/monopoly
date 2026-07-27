# Bot giocatori artificiali — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere di riempire il tavolo con giocatori artificiali gestiti dal server, che giocano con un'euristica curata a mano — gratuita, senza chiavi API — e che sembrino umani senza essere imbattibili.

**Architettura:** Il `GameEngine` resta puro e sincrono. I bot vivono in `server/src/bot.js`, un modulo che decide le mosse chiamando gli stessi metodi pubblici del motore che userebbe un client umano. Il collegamento sta in `server.js`: dopo ogni `broadcastState`, se un bot deve muovere si schedula la sua mossa con `setTimeout`.

**Tech Stack:** Node 20, CommonJS, nessuna dipendenza nuova. Test con lo script `smoke-test.js` esistente (asserzioni a mano, niente framework).

---

## Struttura dei file

| File | Responsabilità |
| --- | --- |
| `server/src/botStrategy.js` (nuovo) | Funzioni pure di valutazione: quanto vale una proprietà, conviene comprare, conviene accettare uno scambio. Nessuno stato, nessun timer — facilissimo da testare. |
| `server/src/bot.js` (nuovo) | Decide **una** mossa dato lo stato del gioco e la esegue chiamando il motore. Usa `botStrategy` per le valutazioni. |
| `server/src/gameEngine.js` (modifica) | Campo `isBot` sui giocatori, metodo `addBot`, metodo `removeBot`. |
| `server/src/server.js` (modifica) | Eventi socket `add_bot`/`remove_bot`; aggancio del ciclo bot dopo `broadcastState`. |
| `server/src/rooms.js` (modifica) | Contatore per generare id bot univoci per stanza. |
| `server/smoke-test.js` (modifica) | Sezione di test sulle decisioni del bot. |
| `server/bot-calibration.js` (nuovo) | Simulazione di centinaia di partite bot-contro-bot per tarare le soglie. |
| `client/src/socket.ts` (modifica) | Campo `isBot` nel tipo `Player`. |
| `client/src/components/Lobby.tsx` (modifica) | *Nessuna*: i bot si aggiungono dalla schermata di attesa, non dalla lobby d'ingresso. |
| `client/src/components/GamePanel.tsx` (modifica) | Etichetta "BOT"; bottone "+ Aggiungi bot" e "✕" per l'host prima dell'inizio. |
| `client/src/components/MobileBar.tsx` (modifica) | Stesse aggiunte, versione compatta. |

La divisione fra `botStrategy.js` (puro) e `bot.js` (esegue) è deliberata: le valutazioni si testano senza costruire una partita intera, e l'esecuzione si testa senza duplicare la matematica.

---

## Task 1: Campo `isBot` e metodo `addBot` nel motore

**Files:**
- Modify: `server/src/gameEngine.js`
- Test: `server/smoke-test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `smoke-test.js`, subito prima della riga
`console.log(\`\n${passed} test superati...\`)`:

```javascript
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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd server && node smoke-test.js 2>&1 | grep -A12 "^24\."`
Expected: FAIL, con un errore tipo `game.addBot is not a function`

- [ ] **Step 3: Implementare `isBot`, `addBot` e `removeBot`**

In `gameEngine.js`, dentro `addPlayer`, aggiungere il campo al giocatore creato
(subito dopo `connected: true,`):

```javascript
      // Un giocatore artificiale: le sue mosse arrivano da bot.js invece che
      // da un socket. Per il resto è un giocatore come tutti gli altri.
      isBot: false,
```

Aggiungere subito dopo il metodo `addPlayer` (cioè dopo la sua `}` di
chiusura, prima di `start()`):

```javascript
  /**
   * Siede un giocatore artificiale. Riusa addPlayer per la validazione, così
   * il tetto di sei giocatori e il pedone già occupato valgono anche per lui.
   */
  addBot(name, token) {
    this.botCounter += 1;
    const id = `bot-${this.botCounter}`;
    const added = this.addPlayer(id, name, token);
    if (added.error) return added;
    this.players.find((p) => p.id === id).isBot = true;
    return { botId: id };
  }

  /** Toglie un bot dal tavolo. Solo prima dell'inizio della partita. */
  removeBot(botId) {
    if (this.started) return { error: 'La partita è già iniziata' };
    const i = this.players.findIndex((p) => p.id === botId && p.isBot);
    if (i === -1) return { error: 'Bot non trovato' };
    const [rimosso] = this.players.splice(i, 1);
    this.addLog(`${rimosso.name} lascia il tavolo.`);
    return {};
  }
```

Nel costruttore, accanto agli altri contatori (dopo `this.rematchVotes = [];`):

```javascript
    // Progressivo per generare id univoci ai bot di questa stanza.
    this.botCounter = 0;
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd server && node smoke-test.js 2>&1 | tail -1`
Expected: `216 test superati, 0 falliti` (204 esistenti + 12 nuovi)

- [ ] **Step 5: Commit**

```bash
git add server/src/gameEngine.js server/smoke-test.js
git commit -m "feat(server): campo isBot e metodi addBot/removeBot nel motore"
```

---

## Task 2: Valutazioni pure in `botStrategy.js`

**Files:**
- Create: `server/src/botStrategy.js`
- Test: `server/smoke-test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in `smoke-test.js` dopo la sezione 24. Serve anche l'import in
cima al file, sotto gli altri require:

```javascript
const { groupWeight, propertyScore, evaluateTrade } = require('./src/botStrategy');
```

E la sezione:

```javascript
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
  const game = newGame();
  give(game, 'b', ORANGE[0]);   // di Giulia, la vuole il bot
  give(game, 'a', BROWN[0]);    // del bot, di scarso valore

  // Offerta generosa verso il bot: riceve una proprietà cara, dà una scarsa.
  const buona = evaluateTrade(game, 'a', {
    offerProperties: [BROWN[0]], offerMoney: 0, offerJailCards: 0,
    requestProperties: [ORANGE[0]], requestMoney: 0, requestJailCards: 0,
  });
  check('uno scambio vantaggioso è accettato', buona === true);

  // Offerta assurda: il bot dà una proprietà cara e 500, riceve una scarsa.
  const g2 = newGame();
  give(g2, 'a', ORANGE[0]);
  give(g2, 'b', BROWN[0]);
  const pessima = evaluateTrade(g2, 'a', {
    offerProperties: [ORANGE[0]], offerMoney: 500, offerJailCards: 0,
    requestProperties: [BROWN[0]], requestMoney: 0, requestJailCards: 0,
  });
  check('uno scambio nettamente in perdita è rifiutato', pessima === false);

  // Rompere un monopolio già posseduto è da rifiutare anche a prezzo pieno.
  const g3 = newGame();
  ORANGE.forEach((pos) => give(g3, 'a', pos));
  const rompeMonopolio = evaluateTrade(g3, 'a', {
    offerProperties: [ORANGE[0]], offerMoney: 0, offerJailCards: 0,
    requestProperties: [], requestMoney: 250, requestJailCards: 0,
  });
  check('non si rompe un proprio monopolio per poco denaro', rompeMonopolio === false);
}
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd server && node smoke-test.js 2>&1 | head -5`
Expected: FAIL con `Cannot find module './src/botStrategy'`

- [ ] **Step 3: Implementare `botStrategy.js`**

```javascript
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

  // "offer" è ciò che propone chi ha fatto l'offerta, quindi ciò che il bot
  // riceve; "request" è ciò che chiede, quindi ciò che il bot dà.
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
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd server && node smoke-test.js 2>&1 | grep -E "^2[56]\.|FAIL|superati"`
Expected: le sezioni 25 e 26 tutte `ok`, e il totale a `226 test superati, 0 falliti`

- [ ] **Step 5: Commit**

```bash
git add server/src/botStrategy.js server/smoke-test.js
git commit -m "feat(server): valutazioni pure della strategia dei bot"
```

---

## Task 3: Il decisore in `bot.js`

**Files:**
- Create: `server/src/bot.js`
- Test: `server/smoke-test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Import in cima a `smoke-test.js`:

```javascript
const { botMove, isBotTurn } = require('./src/bot');
```

Sezione nuova:

```javascript
section('27. Bot: decisioni durante il turno');
{
  // Tira i dadi quando tocca a lui.
  const game = new GameEngine('B1');
  game.addPlayer('umano', 'Mario', '🎩');
  game.addBot('Bot Aurelio', '🐕');
  game.start();
  game.turnIndex = 1; // tocca al bot
  const botId = game.players[1].id;

  check('riconosce che tocca al bot', isBotTurn(game) === true);
  const posPrima = game.players[1].position;
  botMove(game);
  check('il bot ha tirato i dadi', game.lastRoll !== null);
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
  g6.lastRollWasDouble = true;
  g6.turnResolved = false;
  bot6.doublesInARow = 1;
  botMove(g6);
  check('dopo un doppio il bot ritira', g6.lastRoll.seq === 2, `seq=${g6.lastRoll.seq}`);
  check('il tiro extra è suo', g6.lastRoll.playerId === bot6.id);

  // Senza doppio invece non deve ritirare: chiude il turno e passa la mano.
  const g7 = new GameEngine('B8');
  g7.addPlayer('umano', 'Mario', '🎩');
  g7.addBot('Bot Aurelio', '🐕');
  g7.start();
  g7.turnIndex = 1;
  const bot7 = g7.players[1];
  g7.lastRoll = { playerId: bot7.id, dice: [2, 5], seq: 1 };
  g7.lastRollWasDouble = false;
  g7.turnResolved = false;
  botMove(g7);
  check('senza doppio non ritira', g7.lastRoll.seq === 1, `seq=${g7.lastRoll.seq}`);
  check('senza doppio passa la mano', g7.turnIndex === 0, `turnIndex=${g7.turnIndex}`);
}

section('28. Bot: risposta agli scambi');
{
  const game = new GameEngine('B5');
  game.addPlayer('umano', 'Mario', '🎩');
  game.addBot('Bot Aurelio', '🐕');
  game.start();
  const botId = game.players[1].id;

  // Offerta generosa: l'umano dà una proprietà cara e non chiede nulla.
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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd server && node smoke-test.js 2>&1 | head -5`
Expected: FAIL con `Cannot find module './src/bot'`

- [ ] **Step 3: Implementare `bot.js`**

```javascript
// Il giocatore artificiale. Non ha accesso privilegiato al motore: chiama gli
// stessi metodi pubblici che chiamerebbe un client umano, e vale per lui ogni
// regola e ogni rifiuto.
//
// Ogni chiamata a botMove esegue UNA sola mossa e ritorna. Il ciclo che le
// concatena, con le pause fra una e l'altra, sta in server.js: qui non ci sono
// timer, così le decisioni si testano in modo sincrono.
const { board } = require('./data/board');
const { propertyScore, evaluateTrade, propertiesValue } = require('./botStrategy');

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
    return true;
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
      return true;

    case 'awaiting_rent':
      game.payRent(bot.id);
      return true;

    case 'awaiting_tax':
      game.payTax(bot.id);
      return true;

    case 'awaiting_debt':
      // La liquidazione automatica del motore vende gli edifici e ipoteca
      // sacrificando i monopoli per ultimi: è già la strategia giusta.
      game.resolveDebtAuto(bot.id);
      return true;

    case 'awaiting_buy': {
      const square = board[pa.position];
      const punteggio = propertyScore(game, bot.id, square, bot.balance);
      // Margine casuale del ±10% sulla soglia: due situazioni quasi identiche
      // non danno sempre la stessa decisione, come per un giocatore vero.
      const soglia = 0 + (Math.random() - 0.5) * 0.2;
      if (punteggio > soglia && bot.balance - square.price >= RISERVA) {
        game.buyProperty(bot.id);
      } else {
        game.declineBuy(bot.id);
      }
      return true;
    }

    case 'awaiting_trade':
      game.respondTrade(bot.id, evaluateTrade(game, bot.id, pa));
      return true;

    default:
      return false;
  }
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
    if (provaACostruire(game, bot)) return true;
    if (provaAProporreScambio(game, bot)) return true;
    game.rollDice(bot.id);
    return true;
  }

  // Ha tirato un doppio: il motore ha lasciato il turno aperto apposta e gli
  // spetta un altro tiro.
  if (!game.turnResolved && game.lastRollWasDouble) {
    game.rollDice(bot.id);
    return true;
  }

  // Rete di sicurezza: se si arriva qui col turno ancora aperto lo si chiude.
  // endTurn del motore non controlla di chi sia il turno (per gli umani lo fa
  // il gestore socket), quindi lo si verifica qui.
  if (game.currentPlayer?.id === bot.id) game.endTurn();
  return true;
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
  return mappa[bot.id] === (game.lastRoll?.seq || 0);
}

function segnaCostruito(game, bot) {
  const mappa = ultimaCostruzione.get(game) || {};
  mappa[bot.id] = game.lastRoll?.seq || 0;
  ultimaCostruzione.set(game, mappa);
}

/** In prigione: carta, multa o tentativo coi dadi. */
function gestisciPrigione(game, bot) {
  if (bot.jailCards > 0) {
    game.useJailCard(bot.id);
    return true;
  }
  // Con case in giro conviene uscire subito e incassare; a inizio partita
  // restare dentro è quasi un vantaggio. Nel 20% dei casi tenta comunque i
  // dadi anche potendo pagare: un umano ogni tanto rischia per gusto.
  const puoPagare = bot.balance - 50 >= RISERVA;
  if (puoPagare && Math.random() > 0.2) {
    game.payJailFine(bot.id);
    return true;
  }
  game.rollDice(bot.id);
  return true;
}

/** Costruisce al massimo una casa per turno, se la cassa lo consente. */
function provaACostruire(game, bot) {
  if (haGiaCostruito(game, bot)) return false;

  const candidate = game.propertiesOf(bot.id)
    .filter(({ square, owned }) =>
      square.type === 'property' &&
      !owned.mortgaged &&
      game.ownsFullGroup(bot.id, square.group) &&
      bot.balance - square.houseCost >= RISERVA + 100
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

  // Cerca una casella altrui che completerebbe un colore del bot.
  for (const square of board) {
    if (!square.group) continue;
    const owned = game.ownership[square.position];
    if (!owned || owned.ownerId === bot.id) continue;
    const proprietario = game.players.find((p) => p.id === owned.ownerId);
    if (!proprietario || proprietario.bankrupt) continue;

    const gruppo = board.filter((s) => s.group === square.group);
    const mie = gruppo.filter(
      (s) => s.position !== square.position && game.ownership[s.position]?.ownerId === bot.id
    ).length;
    if (mie !== gruppo.length - 1) continue;

    // Merce di scambio: una propria proprietà fuori dai colori già completi.
    const scarto = game.propertiesOf(bot.id)
      .filter(({ square: s, owned: o }) =>
        !o.mortgaged && o.houses === 0 && !o.hotel &&
        (!s.group || !game.ownsFullGroup(bot.id, s.group))
      )
      .sort((a, b) => (a.square.price || 0) - (b.square.price || 0))[0];

    // Offerta onesta: un po' sopra il listino, perché sta chiedendo un favore.
    const target = Math.round(square.price * 1.2);
    const valoreScarto = scarto ? scarto.square.price : 0;
    const denaro = Math.max(0, Math.min(bot.balance - RISERVA, target - valoreScarto));
    if (denaro + valoreScarto < square.price) continue; // non può permetterselo

    const res = game.proposeTrade(bot.id, {
      toId: proprietario.id,
      offerProperties: scarto ? [scarto.position] : [],
      offerMoney: denaro,
      requestProperties: [square.position],
    });
    if (!res.error) return true;
  }
  return false;
}

module.exports = { botMove, botHasMove, isBotTurn, botMustAnswer };
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd server && node smoke-test.js 2>&1 | grep -E "^2[78]\.|FAIL|superati"`
Expected: le sezioni 27 e 28 tutte `ok`, totale `246 test superati, 0 falliti`

- [ ] **Step 5: Eseguire i test 20 volte, perché il bot usa la casualità**

Run: `cd server && for i in $(seq 1 20); do node smoke-test.js > /tmp/o.txt 2>&1 || { echo "RUN $i FALLITA"; grep FAIL /tmp/o.txt; }; done; echo fatto`
Expected: nessuna riga "RUN n FALLITA"

- [ ] **Step 6: Commit**

```bash
git add server/src/bot.js server/smoke-test.js
git commit -m "feat(server): decisore del bot, una mossa per chiamata"
```

---

## Task 4: Ciclo dei bot in `server.js`

**Files:**
- Modify: `server/src/server.js`
- Modify: `server/src/rooms.js`

- [ ] **Step 1: Aggiungere il flag anti-sovrapposizione in `rooms.js`**

In `createRoom`, cambiare la riga che crea la stanza:

```javascript
    this.rooms.set(code, { game, sockets: new Map(), emptySince: null, botTimer: null });
```

E aggiornare il commento della mappa in cima alla classe:

```javascript
    // code -> { game, sockets: Map<socketId, playerId>, emptySince, botTimer }
```

- [ ] **Step 2: Agganciare il ciclo in `server.js`**

Aggiungere l'import in cima al file, sotto gli altri require:

```javascript
const { botMove, botHasMove } = require('./bot');
```

Sostituire la funzione `broadcastState` con:

```javascript
// Pausa fra una mossa del bot e la successiva: abbastanza per seguire il
// registro senza sembrare lento.
const BOT_PAUSA_MS = 1000;

function broadcastState(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit('state', room.game.serialize());
  scheduleBotMove(roomCode);
}

/**
 * Se un bot ha una mossa da fare, la schedula. Una sola alla volta per stanza:
 * il timer viene azzerato prima di ogni nuova schedulazione, così più
 * broadcast ravvicinati non generano mosse sovrapposte.
 */
function scheduleBotMove(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room || room.botTimer) return;
  if (!botHasMove(room.game)) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    // La stanza può essere sparita nel frattempo (tavolo chiuso, scaduta).
    const ancora = roomManager.getRoom(roomCode);
    if (!ancora) return;
    if (botMove(ancora.game)) broadcastState(roomCode);
  }, BOT_PAUSA_MS);
  room.botTimer.unref?.();
}
```

- [ ] **Step 3: Aggiungere gli eventi socket per aggiungere e togliere bot**

Subito prima di `socket.on('start_game', ...)`:

```javascript
  // I bot li gestisce solo chi ha creato il tavolo, e solo prima del via.
  socket.on('add_bot', (payload, cb) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (room.game.hostId !== socket.data.playerId) {
      return cb?.({ error: 'Solo chi ha creato il tavolo può aggiungere bot' });
    }
    if (room.game.started) return cb?.({ error: 'La partita è già iniziata' });

    const usati = room.game.takenTokens();
    const token = BOT_TOKENS.find((t) => !usati.includes(t));
    if (!token) return cb?.({ error: 'Nessun pedone libero' });
    const nome = BOT_NAMES[room.game.botCounter % BOT_NAMES.length];

    const res = room.game.addBot(nome, token);
    broadcastState(socket.data.roomCode);
    cb?.(res);
  });

  socket.on('remove_bot', ({ botId }, cb) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    if (!room) return cb?.({ error: 'Stanza non trovata' });
    if (room.game.hostId !== socket.data.playerId) {
      return cb?.({ error: 'Solo chi ha creato il tavolo può togliere i bot' });
    }
    const res = room.game.removeBot(botId);
    broadcastState(socket.data.roomCode);
    cb?.(res);
  });
```

E in cima al file, accanto alle altre costanti:

```javascript
// Nomi e pedoni per i bot, assegnati in ordine.
const BOT_NAMES = ['Bot Aurelio', 'Bot Cleopatra', 'Bot Fulvio', 'Bot Ottavia', 'Bot Silvio'];
const BOT_TOKENS = ['🐕', '🎩', '🚗', '🚢', '🐈', '🎸'];
```

- [ ] **Step 4: Verificare che il server si avvii**

Run: `cd server && timeout 3 node src/server.js; echo "uscita: $?"`
Expected: stampa `Monopoly server listening on port 3001`, poi esce per il timeout

- [ ] **Step 5: Verificare a mano una partita con un bot**

Run:
```bash
cd server && node -e "
const { io } = require('../client/node_modules/socket.io-client');
const s = io('http://localhost:3001');
let visto = 0;
s.on('state', (st) => {
  visto++;
  if (visto === 1) console.log('giocatori:', st.players.map(p => p.name + (p.isBot ? ' [BOT]' : '')).join(', '));
  if (st.started && visto < 30) console.log('turno di:', st.players[st.turnIndex].name, '| saldi:', st.players.map(p=>p.balance).join('/'));
});
s.on('connect', () => {
  s.emit('create_room', { name: 'Mario', token: '🎩', clientId: 'u1' }, () => {
    s.emit('add_bot', {}, (r) => {
      console.log('add_bot:', JSON.stringify(r));
      s.emit('start_game');
      setTimeout(() => { console.log('--- fine osservazione ---'); process.exit(0); }, 12000);
    });
  });
});
" &
sleep 1 && node src/server.js
```
Expected: si vede il bot aggiunto, poi il suo turno che avanza da solo ogni
secondo circa, con i saldi che cambiano.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.js server/src/rooms.js
git commit -m "feat(server): ciclo dei bot e eventi add_bot/remove_bot"
```

---

## Task 5: Interfaccia — etichetta BOT e gestione in attesa

**Files:**
- Modify: `client/src/socket.ts`
- Modify: `client/src/components/GamePanel.tsx`
- Modify: `client/src/components/MobileBar.tsx`

- [ ] **Step 1: Aggiungere `isBot` al tipo `Player`**

In `client/src/socket.ts`, dentro `interface Player`, dopo `connected: boolean;`:

```typescript
  /** Vero per i giocatori artificiali gestiti dal server. */
  isBot: boolean;
```

- [ ] **Step 2: Etichetta BOT e controlli nel pannello desktop**

In `GamePanel.tsx`, sostituire il blocco che disegna il nome del giocatore
(la riga `<div style={{ fontWeight: 600 }}>{p.name}...`) con:

```tsx
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.name}{p.id === myId ? ' (tu)' : ''}
                {p.isBot && <span style={styles.botTag}>BOT</span>}
                {p.isBot && !state.started && state.hostId === myId && (
                  <button
                    style={styles.removeBot}
                    title="Togli questo bot"
                    onClick={() => socket.emit('remove_bot', { botId: p.id })}
                  >
                    ✕
                  </button>
                )}
              </div>
```

Subito dopo la chiusura del blocco `<div style={styles.players}>`, aggiungere
il bottone per aggiungerli:

```tsx
      {!state.started && state.hostId === myId && state.players.length < 6 && (
        <button
          className="btn-ghost"
          style={styles.addBot}
          onClick={() => socket.emit('add_bot', {})}
        >
          + Aggiungi bot
        </button>
      )}
```

E negli stili:

```typescript
  botTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.58rem',
    letterSpacing: '0.08em',
    padding: '1px 5px',
    borderRadius: 4,
    border: '1px solid rgba(126,200,227,0.5)',
    color: '#7EC8E3',
  },
  removeBot: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: 'rgba(243,234,216,0.45)',
    fontSize: '0.85rem',
    cursor: 'pointer',
    padding: '0 4px',
  },
  addBot: { width: '100%', fontSize: '0.82rem', padding: '8px 14px' },
```

- [ ] **Step 3: Stesse aggiunte nella barra mobile**

In `MobileBar.tsx`, dentro la pastiglia del giocatore, dopo lo `<span>` del
saldo:

```tsx
              {p.isBot && <span style={styles.botTag}>BOT</span>}
```

E nel blocco `{!state.started && (...)}` che mostra il codice tavolo, dopo
`<InviteLink ... />`:

```tsx
            {state.hostId === myId && state.players.length < 6 && (
              <button
                className="btn-ghost"
                style={styles.addBot}
                onClick={() => socket.emit('add_bot', {})}
              >
                + Aggiungi bot
              </button>
            )}
```

Negli stili:

```typescript
  botTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.55rem',
    letterSpacing: '0.06em',
    color: '#7EC8E3',
  },
  addBot: { minHeight: 42, fontSize: '0.88rem' },
```

- [ ] **Step 4: Verificare che il client compili**

Run: `cd client && npm run build 2>&1 | tail -3`
Expected: `✓ built in ...`, nessun errore TypeScript

- [ ] **Step 5: Commit**

```bash
git add client/src/socket.ts client/src/components/GamePanel.tsx client/src/components/MobileBar.tsx
git commit -m "feat(client): etichetta BOT e aggiunta/rimozione dalla schermata di attesa"
```

---

## Task 6: Calibrazione su partite simulate

**Files:**
- Create: `server/bot-calibration.js`

- [ ] **Step 1: Scrivere lo script di calibrazione**

```javascript
// Calibrazione dei bot: fa giocare centinaia di partite bot-contro-bot e
// riporta le statistiche che servono a tarare le soglie di botStrategy.js.
//
// Non è un test pass/fail come smoke-test.js: è uno strumento di misura. Si
// lancia con `node bot-calibration.js [numero-partite]` dalla cartella server.
const { GameEngine } = require('./src/gameEngine');
const { botMove, botHasMove } = require('./src/bot');

const PARTITE = Number(process.argv[2]) || 200;
// Oltre questo numero di mosse la partita si considera senza fine: succede
// quando nessuno riesce a mettere insieme un monopolio.
const MOSSE_MAX = 4000;

function giocaUnaPartita(numeroBot) {
  const game = new GameEngine('CAL');
  const pedoni = ['🎩', '🐕', '🚗', '🚢', '🐈', '🎸'];
  for (let i = 0; i < numeroBot; i++) game.addBot(`Bot ${i + 1}`, pedoni[i]);
  game.start();

  let mosse = 0;
  while (!game.finished && mosse < MOSSE_MAX) {
    if (!botHasMove(game)) break; // situazione bloccata: si esce
    botMove(game);
    mosse += 1;
  }

  return {
    finita: game.finished,
    vincitore: game.winnerId,
    mosse,
    saldi: game.players.map((p) => p.balance),
    falliti: game.players.filter((p) => p.bankrupt).length,
    proprietaAssegnate: Object.keys(game.ownership).length,
  };
}

console.log(`Simulazione di ${PARTITE} partite a due bot...\n`);

const vittorie = {};
let finite = 0;
let mosseTotali = 0;
let proprietaTotali = 0;

for (let i = 0; i < PARTITE; i++) {
  const r = giocaUnaPartita(2);
  if (r.finita) {
    finite += 1;
    vittorie[r.vincitore] = (vittorie[r.vincitore] || 0) + 1;
  }
  mosseTotali += r.mosse;
  proprietaTotali += r.proprietaAssegnate;
}

const conteggi = Object.entries(vittorie).sort((a, b) => b[1] - a[1]);
console.log(`Partite concluse:        ${finite}/${PARTITE} (${Math.round(finite / PARTITE * 100)}%)`);
console.log(`Mosse medie per partita: ${Math.round(mosseTotali / PARTITE)}`);
console.log(`Proprietà assegnate:     ${(proprietaTotali / PARTITE).toFixed(1)} su 28`);
console.log('\nVittorie per posizione al tavolo:');
conteggi.forEach(([id, n]) => {
  console.log(`  ${id.padEnd(8)} ${n} (${Math.round(n / finite * 100)}%)`);
});

console.log('\nCosa guardare:');
console.log('- le vittorie fra bot identici dovrebbero stare vicino al 50/50;');
console.log('  uno sbilanciamento forte segnala un vantaggio del primo di turno');
console.log('- se le proprietà assegnate sono poche, i bot comprano troppo poco');
console.log('- se poche partite si concludono, non riescono mai a fare monopoli');
```

- [ ] **Step 2: Eseguire la calibrazione**

Run: `cd server && node bot-calibration.js 200`
Expected: un report con percentuali. I numeri sani sono: oltre il 70% di
partite concluse, vittorie fra il 40% e il 60% per ciascun bot, almeno 20
proprietà su 28 assegnate.

- [ ] **Step 3: Aggiustare le soglie se i numeri sono fuori range**

Se meno del 40% delle proprietà viene comprato, il bot è troppo prudente:
abbassare il termine costante in `propertyScore` (`- 0.35`) verso `- 0.2`.

Se le partite non si concludono quasi mai, i bot non costruiscono abbastanza:
abbassare la soglia in `provaACostruire` da `RISERVA + 100` a `RISERVA + 50`.

Se un bot vince molto più dell'altro a parità di strategia, il vantaggio è di
posizione e non di parametri: annotarlo, non è un difetto da correggere.

Dopo ogni modifica rilanciare `node bot-calibration.js 200` e rieseguire
`node smoke-test.js` per assicurarsi che nulla si sia rotto.

- [ ] **Step 4: Commit**

```bash
git add server/bot-calibration.js server/src/botStrategy.js server/src/bot.js
git commit -m "feat(server): script di calibrazione dei bot su partite simulate"
```

---

## Task 7: Verifica nel browser e documentazione

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Avviare server e client**

```bash
cd server && node src/server.js &
cd client && npm run dev &
```

- [ ] **Step 2: Provare il flusso completo nel browser**

Aprire `http://localhost:5173`, creare un tavolo, premere "+ Aggiungi bot" due
volte, verificare che compaiano con l'etichetta BOT e la "✕", togliere un bot,
premere "Inizia partita" e osservare che il bot giochi da solo: tira, compra o
rinuncia, e passa il turno. Poi proporgli uno scambio e verificare che
risponda entro un paio di secondi.

- [ ] **Step 3: Aggiornare il README**

Nella sezione "Stato", sostituire la riga "Fatto:" con:

```markdown
Fatto: motore completo, bancarotta con liquidazione, costruzioni e ipoteche,
scambi, tre doppi, riconnessione, assetto mobile, bot giocanti.
```

E aggiungere alla sezione "Test", dopo il blocco di `smoke-test.js`:

```markdown
Per tarare la strategia dei bot c'è invece uno strumento di misura, che fa
giocare centinaia di partite bot-contro-bot e riporta le statistiche:

```bash
cd server && node bot-calibration.js 200
```
```

- [ ] **Step 4: Eseguire l'intera suite un'ultima volta**

Run: `cd server && for i in $(seq 1 20); do node smoke-test.js > /tmp/o.txt 2>&1 || { echo "RUN $i FALLITA"; grep FAIL /tmp/o.txt; }; done; node smoke-test.js | tail -1; cd ../client && npm run build 2>&1 | tail -2`
Expected: nessuna esecuzione fallita, totale test verde, build del client riuscita

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: bot giocanti nel README e strumento di calibrazione"
```

---

## Note di verifica finale

Prima di dichiarare finito, controllare a mano questi casi, che i test
automatici non coprono:

1. **Un bot che fallisce** durante una partita con più bot: la partita deve
   proseguire fra i rimanenti, non bloccarsi.
2. **Tavolo di soli bot** più un umano che abbandona: i bot devono continuare
   a giocare fra loro fino alla fine.
3. **Rivincita** con bot al tavolo: premendo "Rivincita" da umano, i bot devono
   votare entro un paio di secondi e la partita ripartire.
4. **Chiusura del tavolo** mentre un bot ha un timer schedulato: non deve
   comparire alcun errore nei log del server (la stanza sparisce e il timer
   trova `getRoom` vuoto — è il caso che `scheduleBotMove` gestisce già).
