const {
  board,
  GO_AMOUNT,
  STATION_RENT,
  UTILITY_MULTIPLIER,
  CHANCE_CARDS,
  COMMUNITY_CARDS,
} = require('./data/board');

const STARTING_BALANCE = 1500;
const JAIL_POSITION = 10;
const GO_TO_JAIL_POSITION = 30;
const JAIL_FINE = 50;
const MAX_JAIL_TURNS = 3;
// Oltre sei il tabellone diventa illeggibile e i colori finiscono.
const MAX_PLAYERS = 6;

// Regole della casa: valori ammessi per le opzioni a scelta multipla (vedi
// setRules). Un solo elenco, letto sia dalla validazione sia da chi genera i
// default: così un valore "inventato" da un client malevolo o da un bug non
// può mai finire dentro this.rules, a differenza degli interruttori on/off
// (freeParkingEnabled, auctionEnabled) che sono booleani e non hanno bisogno
// di un elenco. 200 è l'importo da regolamento, 500 è quello con cui il
// tavolo ha sempre giocato finora (vedi GO_AMOUNT in board.js, che resta il
// default). Il saldo iniziale ufficiale è 1500; 1000 accorcia la partita
// (si fallisce prima), 2000 la allunga (più margine prima della bancarotta).
const GO_AMOUNT_OPTIONS = [200, 500];
const STARTING_BALANCE_OPTIONS = [1000, 1500, 2000];

// Al terzo doppio consecutivo si va in prigione senza muoversi.
const MAX_DOUBLES = 3;
// Interesse del 10% che la banca trattiene sulle ipoteche: si paga per
// riscattare una proprietà e per riceverne una già ipotecata, sia in uno
// scambio sia in una bancarotta. È espresso come frazione intera perché con i
// decimali `100 * 1.1` vale 110.00000000000001 e Math.ceil arrotonda a 111.
const MORTGAGE_INTEREST_NUM = 1;
const MORTGAGE_INTEREST_DEN = 10;

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
    // Regole della casa: si scelgono al tavolo prima del via (vedi setRules,
    // solo l'host può cambiarle e solo finché `started` è falso) e restano
    // quelle per tutta la partita, rivincita compresa — rematch() non le
    // tocca apposta. I default sono quelli con cui il tavolo ha sempre
    // giocato finora, così una partita creata senza toccare nulla si
    // comporta esattamente come prima che queste regole fossero scegliibili.
    this.rules = {
      goAmount: GO_AMOUNT, // 500: quanto si incassa passando dal Via
      freeParkingEnabled: true, // il montepremi della Sosta Gratuita
      auctionEnabled: true, // l'asta sulla proprietà rifiutata
      startingBalance: STARTING_BALANCE, // 1500: saldo di partenza
    };
    // Il mazzo si costruisce qui, non si importa già pronto da board.js:
    // alcune carte citano a parole l'importo del Via (vedi buildDeck) e
    // quel testo deve rispecchiare `this.rules.goAmount` di QUESTA partita.
    this.chanceDeck = shuffle(this.buildDeck(CHANCE_CARDS));
    this.communityDeck = shuffle(this.buildDeck(COMMUNITY_CARDS));
    // { type: 'awaiting_buy' | 'awaiting_card' | 'awaiting_rent' | 'awaiting_tax' |
    //   'awaiting_debt' | 'awaiting_trade' | 'awaiting_auction',
    //   playerId, ... }
    // Blocca il flusso del turno finché il giocatore indicato da playerId non
    // risolve: compra o rinuncia, legge la carta, paga l'affitto, salda il
    // debito, risponde allo scambio, rilancia o passa all'asta.
    this.pendingAction = null;
    this.finished = false;
    this.winnerId = null;
    // Come è finita: bancarotta, abbandono o chiusura da parte di chi ha
    // creato il tavolo. Serve al client per dire la cosa giusta.
    this.endedReason = null;
    // Il creatore del tavolo, cioè il primo che si siede.
    this.hostId = null;
    // Chi ha chiesto la rivincita a partita finita: serve il consenso di
    // entrambi, così nessuno si ritrova la partita azzerata sotto il naso.
    this.rematchVotes = [];
    // Progressivo per generare id univoci ai bot di questa stanza. Non si
    // azzera alla rivincita: i bot restano quelli, con gli id che hanno.
    this.botCounter = 0;
    // Alzata mentre resolveDebtAuto sta liquidando in serie: evita che ogni
    // singola vendita chiuda il debito e faccia girare il turno a metà loop.
    this.liquidating = false;
    // Garantisce che il turno venga chiuso una volta sola per tiro di dadi.
    this.turnResolved = false;
    // Se l'ultimo tiro era un doppio il giocatore ha diritto a rigiocare, anche
    // se nel frattempo ha dovuto comprare o saldare un debito.
    this.lastRollWasDouble = false;
    // Carta pescata e non ancora letta: l'effetto scatta alla conferma.
    this.pendingCard = null;
    // Moltiplicatore d'affitto per il prossimo atterraggio (carte "paga il
    // doppio"). Torna a 1 subito dopo.
    this.rentMultiplier = 1;
    // Ultimo tiro mostrato al centro del tabellone. `seq` cresce a ogni lancio
    // così il client riconosce un tiro nuovo anche se i dadi ripetono i valori.
    // Si azzera a fine turno (vedi endTurn) perché è uno stato di *visualizzazione*:
    // a turno chiuso quel tiro non è più quello in corso e non va più mostrato.
    this.lastRoll = null;
    // Contatore di lanci che invece non si azzera mai a fine turno (solo alla
    // rivincita): genera i `seq` di lastRoll e, soprattutto, resta disponibile
    // anche quando lastRoll è già stato ripulito per il tabellone. Serve al bot
    // per sapere se ha già costruito dopo il proprio ultimo tiro (vedi bot.js),
    // un controllo che altrimenti si romperebbe non appena lastRoll torna null.
    this.rollCount = 0;
    // Regola della casa (rules.freeParkingEnabled): quando è accesa, il
    // denaro che i giocatori pagano alla banca - tasse, multe delle carte,
    // multa di prigione - non sparisce ma si accumula qui, e chi atterra
    // sulla Sosta Gratuita lo incassa tutto. Se la regola è spenta questo
    // resta sempre a zero (vedi chargePlayer): la Sosta torna una casella
    // che non fa nulla, come da regolamento.
    this.freeParkingPot = 0;
    // Contatori per il riepilogo di fine partita (vedi resetStats). Il
    // registro (`log`) da solo non basta: è tappato alle ultime 200 righe, e
    // una partita lunga ne genera molte di più. Questi contatori crescono nei
    // punti in cui le cose succedono già, così restano sempre esatti anche
    // dopo migliaia di eventi, senza dover rileggere il registro.
    this.resetStats();
  }

  /**
   * Azzera i contatori statistici. Separato dal costruttore perché va
   * richiamato anche da rematch(): senza, la rivincita si porterebbe dietro i
   * numeri della partita precedente (lo stesso errore già capitato con altri
   * campi di questa classe, vedi il commento in rematch()).
   */
  resetStats() {
    this.stats = {
      // Timestamp di inizio/fine, per calcolare la durata mostrata a fine
      // partita. `null` finché non sono impostati (partita non ancora
      // iniziata, o non ancora finita).
      startedAt: null,
      finishedAt: null,
      // Tutte le mappe sotto sono playerId -> numero (tranne `landings`, che è
      // posizione -> numero), create al volo dal primo evento: un giocatore
      // che non compare vale 0 (vedi bumpStat).
      rentPaid: {}, // affitti pagati, per chi li paga
      rentCollected: {}, // affitti incassati, per chi li riceve
      bankPaid: {}, // denaro finito alla banca: tasse, multe di prigione, carte "paga", riparazioni, interessi
      purchases: {}, // proprietà comprate, sia a prezzo di listino sia all'asta
      housesBuilt: {}, // case e hotel costruiti (ogni costruzione conta 1, hotel incluso)
      landings: {}, // atterraggi per casella: la più visitata si legge cercando il massimo
      laps: {}, // giri di tabellone completati (passaggi dal Via)
      tradesCompleted: 0, // scambi andati a buon fine, conteggio unico e globale
    };
  }

  /** Incrementa un contatore in una mappa chiave -> numero, creandolo se serve. */
  bumpStat(map, key, amount = 1) {
    map[key] = (map[key] || 0) + amount;
  }

  /**
   * Costruisce un mazzo (Probabilità o Imprevisti) a partire dai modelli di
   * board.js, risolvendo il testo delle carte che citano l'importo del Via.
   * In board.js quelle carte hanno `text` come funzione di `goAmount` invece
   * che una stringa già pronta, proprio per poter essere risolte qui, contro
   * la regola scelta per QUESTA partita — le altre carte hanno già `text`
   * come stringa e passano invariate. Si richiama sia dal costruttore sia da
   * rematch(): in entrambi i casi `this.rules.goAmount` è già quello giusto
   * (le regole non cambiano più una volta iniziata la partita).
   */
  buildDeck(templates) {
    return templates.map((card) => ({
      ...card,
      text: typeof card.text === 'function' ? card.text(this.rules.goAmount) : card.text,
    }));
  }

  /**
   * Chiude un tiro di dadi: chi ha fatto doppio gioca ancora, gli altri passano
   * la mano. Chi è finito in prigione o in bancarotta passa comunque, anche col
   * doppio. Va chiamata da ogni punto in cui la risoluzione del tiro si
   * completa: subito dopo il movimento, ma anche dopo un acquisto o un debito
   * che avevano messo il turno in pausa.
   */
  finishRoll(player) {
    if (this.finished) return;
    if (this.lastRollWasDouble && player && !player.inJail && !player.bankrupt) {
      this.addLog(`${player.name} ha fatto doppio: gioca ancora.`);
      return;
    }
    this.endTurn();
  }

  addLog(message) {
    this.log.push({ message, at: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  /** Pedoni già assegnati: servono al client per disabilitarli nella lobby. */
  takenTokens() {
    return this.players.map((p) => p.token);
  }

  hasPlayer(playerId) {
    return this.players.some((p) => p.id === playerId);
  }

  /** Segna un giocatore come connesso o meno, senza toccarne lo stato di gioco. */
  setConnected(playerId, connected) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this.addLog(connected ? `${player.name} è tornato.` : `${player.name} si è disconnesso.`);
  }

  addPlayer(id, name, token) {
    if (this.players.find((p) => p.id === id)) return { error: 'Sei già al tavolo' };
    if (this.players.some((p) => p.token === token)) {
      return { error: 'Pedone già scelto dall\'altro giocatore', takenTokens: this.takenTokens() };
    }
    if (this.players.length >= MAX_PLAYERS) {
      return { error: `Il tavolo è al completo (${MAX_PLAYERS} giocatori)` };
    }
    if (this.players.length === 0) this.hostId = id;
    this.players.push({
      id, name, token,
      // Il saldo iniziale è una regola della casa (vedi setRules): si legge
      // sempre da this.rules, mai dalla costante, così chi si unisce dopo che
      // l'host l'ha cambiata trova già il valore giusto.
      balance: this.rules.startingBalance,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
      doublesInARow: 0,
      // A chi va il denaro del debito in corso: serve quando il debito resta
      // in coda dietro a quello di un altro giocatore.
      debtTo: null,
      // Un giocatore disconnesso resta al tavolo con le sue proprietà: può
      // rientrare con lo stesso id. Serve solo a segnalarlo nell'interfaccia.
      connected: true,
      // Un giocatore artificiale: le sue mosse arrivano da bot.js invece che
      // da un socket. Per il resto è un giocatore come tutti gli altri.
      isBot: false,
    });
    this.addLog(`${name} si è unito alla partita.`);
    return {};
  }

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

  /**
   * Aggiorna le regole della casa scelte per questo tavolo. `changes` è
   * parziale: si passano solo i campi che si vogliono cambiare, gli altri
   * restano quelli di prima. Due controlli, entrambi ripetuti qui dentro
   * invece di fidarsi solo di chi chiama (server.js fa comunque lo stesso
   * controllo dell'host prima di arrivare qui, stesso schema di
   * addBot/removeBot — ma questo metodo deve rifiutare anche se qualcosa lo
   * chiamasse direttamente, scavalcando quel controllo, esattamente come fa
   * già endGame più sotto):
   *  - solo chi ha creato il tavolo può cambiarle;
   *  - solo prima del via: a partita iniziata le regole sono quelle, per non
   *    cambiarle sotto ai giocatori già seduti a metà partita.
   */
  setRules(playerId, changes = {}) {
    if (playerId !== this.hostId) {
      return { error: 'Solo chi ha creato il tavolo può cambiare le regole' };
    }
    if (this.started) return { error: 'La partita è già iniziata' };

    const next = { ...this.rules };
    if (changes.goAmount !== undefined) {
      const goAmount = Number(changes.goAmount);
      if (!GO_AMOUNT_OPTIONS.includes(goAmount)) return { error: 'Importo del Via non valido' };
      next.goAmount = goAmount;
    }
    if (changes.freeParkingEnabled !== undefined) {
      next.freeParkingEnabled = Boolean(changes.freeParkingEnabled);
    }
    if (changes.auctionEnabled !== undefined) {
      next.auctionEnabled = Boolean(changes.auctionEnabled);
    }
    if (changes.startingBalance !== undefined) {
      const startingBalance = Number(changes.startingBalance);
      if (!STARTING_BALANCE_OPTIONS.includes(startingBalance)) return { error: 'Saldo iniziale non valido' };
      next.startingBalance = startingBalance;
    }

    this.rules = next;
    // Chi è già seduto ha già un saldo assegnato con la regola precedente
    // (addPlayer lo legge al momento di sedersi): se il saldo iniziale
    // cambia va aggiornato anche a chi è già al tavolo, non solo a chi si
    // unirà dopo. Il montepremi e l'asta invece si applicano da soli a
    // eventi futuri (il prossimo accumulo, la prossima rinuncia): cambiare
    // `this.rules` basta, senza altro da aggiustare qui.
    if (changes.startingBalance !== undefined) {
      this.players.forEach((p) => { p.balance = next.startingBalance; });
    }
    // I mazzi sono già pronti dal costruttore, con l'importo del Via di
    // ALLORA impresso nel testo delle carte che lo citano (vedi buildDeck):
    // se l'host cambia goAmount dopo essersi seduto, senza questo
    // ricalcolo quel testo resterebbe quello vecchio finché non si pesca la
    // carta giusta. Si può rifare tranquillamente qui (nuovo rimescolamento
    // compreso): siamo ancora prima del via, nessuna carta è stata pescata.
    if (changes.goAmount !== undefined) {
      this.chanceDeck = shuffle(this.buildDeck(CHANCE_CARDS));
      this.communityDeck = shuffle(this.buildDeck(COMMUNITY_CARDS));
    }
    this.addLog('Le regole della casa sono state aggiornate.');
    return {};
  }

  start() {
    if (this.players.length < 1) return;
    this.started = true;
    this.turnIndex = 0;
    this.stats.startedAt = Date.now();
    this.addLog('La partita è iniziata!');
  }

  get currentPlayer() {
    return this.players[this.turnIndex];
  }

  serialize() {
    // Il valore di liquidazione cambia a ogni vendita, quindi si ricalcola qui
    // invece di duplicare la regola nel client.
    let pendingAction = this.pendingAction;
    if (pendingAction?.type === 'awaiting_debt') {
      const debtor = this.players.find((p) => p.id === pendingAction.playerId);
      pendingAction = { ...pendingAction, liquidationValue: debtor ? this.liquidationValue(debtor) : 0 };
    }
    return {
      roomCode: this.roomCode,
      players: this.players,
      ownership: this.ownership,
      turnIndex: this.turnIndex,
      started: this.started,
      log: this.log.slice(-30),
      pendingAction,
      finished: this.finished,
      winnerId: this.winnerId,
      endedReason: this.endedReason,
      hostId: this.hostId,
      rematchVotes: this.rematchVotes,
      lastRoll: this.lastRoll,
      freeParkingPot: this.freeParkingPot,
      stats: this.stats,
      // Le regole della casa scelte per questo tavolo: servono al client sia
      // per lasciarle scegliere all'host prima del via, sia per mostrarle
      // (sola lettura) a chi si siede senza poterle cambiare.
      rules: this.rules,
    };
  }

  // ---- Proprietà e patrimonio ----

  /** Tutte le caselle possedute da un giocatore, con casella e stato di possesso. */
  propertiesOf(playerId) {
    return Object.entries(this.ownership)
      .filter(([, owned]) => owned.ownerId === playerId)
      .map(([position, owned]) => ({ position: Number(position), square: board[Number(position)], owned }));
  }

  /**
   * Edifici presenti su una casella espressi in "unità casa". L'hotel vale 5
   * perché costa una casa in più rispetto alle quattro che sostituisce: così il
   * confronto per la regola dell'edificazione uniforme è un semplice numero.
   */
  unitCount(owned) {
    return owned.hotel ? 5 : owned.houses;
  }

  /** Quanto ricava il giocatore vendendo un edificio: metà del costo di costruzione. */
  buildingRefund(square) {
    return Math.floor(square.houseCost / 2);
  }

  /** Valore d'ipoteca di una proprietà: metà del prezzo d'acquisto. */
  mortgageValue(square) {
    return Math.floor(square.price / 2);
  }

  /** Interesse del 10% dovuto alla banca su una proprietà ipotecata. */
  mortgageInterest(square) {
    return Math.ceil((this.mortgageValue(square) * MORTGAGE_INTEREST_NUM) / MORTGAGE_INTEREST_DEN);
  }

  /** Costo per riscattare un'ipoteca: il valore più il 10% di interesse. */
  unmortgageCost(square) {
    return this.mortgageValue(square) + this.mortgageInterest(square);
  }

  /**
   * Quanto avrebbe il giocatore se liquidasse tutto: contanti, più il rimborso di
   * ogni edificio, più l'ipoteca su ogni proprietà non ancora ipotecata.
   * Se questo valore è negativo il debito è impossibile da coprire.
   */
  liquidationValue(player) {
    return this.propertiesOf(player.id).reduce((total, { square, owned }) => {
      // Stazioni e società non hanno houseCost: contano solo per l'ipoteca.
      const units = this.unitCount(owned);
      let extra = units > 0 ? units * this.buildingRefund(square) : 0;
      if (!owned.mortgaged) extra += this.mortgageValue(square);
      return total + extra;
    }, player.balance);
  }

  hasPendingDebt() {
    return this.pendingAction?.type === 'awaiting_debt';
  }

  hasPendingTrade() {
    return this.pendingAction?.type === 'awaiting_trade';
  }

  hasPendingCard() {
    return this.pendingAction?.type === 'awaiting_card';
  }

  hasPendingRent() {
    return this.pendingAction?.type === 'awaiting_rent';
  }

  hasPendingTax() {
    return this.pendingAction?.type === 'awaiting_tax';
  }

  hasPendingAuction() {
    return this.pendingAction?.type === 'awaiting_auction';
  }

  /**
   * Con uno scambio in sospeso le proprietà si congelano: non ha senso poter
   * cambiare la merce dopo aver fatto l'offerta.
   */
  tradeFreezeBlocker() {
    return this.hasPendingTrade() ? { error: 'Prima rispondi allo scambio proposto' } : null;
  }

  /**
   * Con un'asta in corso il denaro di chi ci partecipa deve restare certo:
   * costruire o riscattare un'ipoteca a metà asta potrebbe rendere
   * inaffrontabile un'offerta già fatta, e il conto tornerebbe scoperto solo
   * all'aggiudicazione. Si congela la spesa libera per tutti finché non si
   * chiude, come già succede per lo scambio.
   */
  auctionFreezeBlocker() {
    return this.hasPendingAuction() ? { error: 'Prima risolvi l\'asta in corso' } : null;
  }

  // ---- Turn flow ----

  rollDice(playerId) {
    const player = this.currentPlayer;
    if (this.finished) return { error: 'La partita è finita' };
    if (!player || player.id !== playerId || player.bankrupt) return { error: 'Non è il tuo turno' };
    if (this.pendingAction) return { error: 'Azione in sospeso da risolvere prima' };

    this.turnResolved = false;
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    const isDouble = d1 === d2;
    // Uscire di prigione col doppio non dà il tiro extra: si esce e basta.
    this.lastRollWasDouble = isDouble && !player.inJail;
    this.rollCount += 1;
    this.lastRoll = {
      playerId: player.id,
      dice: [d1, d2],
      seq: this.rollCount,
    };

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
          player.inJail = false;
          player.jailTurns = 0;
          this.addLog(`${player.name} paga ${JAIL_FINE} per uscire dopo 3 tentativi.`);
          this.chargePlayer(player, JAIL_FINE);
          // Se la multa lo ha mandato in bancarotta non c'è più nessuno da
          // muovere; se ha aperto un debito si salda quello e il turno finisce,
          // altrimenti l'atterraggio sovrascriverebbe il debito in sospeso.
          if (!player.bankrupt && !this.hasPendingDebt()) this.movePlayer(player, d1 + d2);
        } else {
          this.endTurn();
        }
      }
      return { dice: [d1, d2] };
    }

    // Tre doppi di fila mandano in prigione, e si va senza muoversi: il
    // controllo va fatto prima di spostare la pedina.
    if (isDouble) {
      player.doublesInARow += 1;
      if (player.doublesInARow >= MAX_DOUBLES) {
        player.doublesInARow = 0;
        this.addLog(`${player.name} fa il terzo doppio di fila (${d1},${d2}).`);
        this.sendToJail(player);
        this.endTurn();
        return { dice: [d1, d2] };
      }
    } else {
      player.doublesInARow = 0;
    }

    this.movePlayer(player, d1 + d2);

    // Con un'azione in sospeso il tiro non è ancora finito: lo chiuderà chi
    // risolve l'acquisto o il debito.
    if (!this.pendingAction) this.finishRoll(player);

    return { dice: [d1, d2] };
  }

  movePlayer(player, spaces) {
    const prev = player.position;
    let next = (prev + spaces) % 40;
    if (next < prev) {
      // L'importo è una regola della casa (rules.goAmount): 200 o 500 a
      // scelta dell'host, mai più la costante fissa di board.js.
      player.balance += this.rules.goAmount;
      this.addLog(`${player.name} passa dal Via e incassa ${this.rules.goAmount}.`);
      // Passare dal Via è, per definizione, chiudere un giro di tabellone.
      this.bumpStat(this.stats.laps, player.id);
    }
    player.position = next;
    this.resolveLanding(player);
  }

  /**
   * Porta la pedina su una casella precisa muovendosi **in avanti**, girando dal
   * Via se necessario. Le carte "avanza fino a" non teletrasportano indietro: se
   * la meta è alle spalle si fa il giro, incassando il Via come qualunque
   * passaggio. L'unico movimento a ritroso del gioco è la carta "vai indietro".
   */
  movePlayerTo(player, target) {
    const spaces = (target - player.position + 40) % 40;
    if (spaces === 0) {
      this.resolveLanding(player);
      return;
    }
    this.movePlayer(player, spaces);
  }

  resolveLanding(player) {
    const square = board[player.position];
    // Unico punto attraverso cui la pedina "atterra" davvero su una casella
    // (movePlayer, movePlayerTo e la carta "vai indietro" ci passano tutti):
    // il posto giusto per contare gli atterraggi una volta sola a testa.
    this.bumpStat(this.stats.landings, player.position);
    switch (square.type) {
      case 'go':
        break;
      case 'tax':
        // Come l'affitto: prima si mostra quanto, poi si paga. Prima il denaro
        // spariva in silenzio.
        this.pendingAction = {
          type: 'awaiting_tax',
          playerId: player.id,
          position: square.position,
          amount: square.amount,
        };
        this.addLog(`${player.name} è su ${square.name}: deve ${square.amount}.`);
        break;
      case 'go_to_jail':
        this.sendToJail(player);
        break;
      case 'jail':
        break;
      case 'free_parking':
        // Se il montepremi è vuoto non c'è nulla da incassare: nessun log, per
        // non riempire il registro con un evento che di fatto non è successo.
        if (this.freeParkingPot > 0) {
          player.balance += this.freeParkingPot;
          this.addLog(`${player.name} incassa il montepremi della Sosta Gratuita: ${this.freeParkingPot}.`);
          this.freeParkingPot = 0;
        }
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
    // Con un debito o una carta già in sospeso non si apre una proposta
    // d'acquisto: sovrascriverebbe quel pendingAction e lo farebbe sparire.
    if (this.hasPendingDebt() || this.hasPendingCard() || this.hasPendingTax()) return;
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
    // L'affitto si calcola qui e si congela nel pendingAction: al momento del
    // pagamento il moltiplicatore della carta è già tornato a 1, e per le
    // società il conto dipende da un tiro di dadi che non va rifatto.
    const rent = this.calculateRent(square, owned) * this.rentMultiplier;
    const owner = this.players.find((p) => p.id === owned.ownerId);
    this.pendingAction = {
      type: 'awaiting_rent',
      playerId: player.id,
      position: square.position,
      amount: rent,
      ownerId: owner.id,
      doubled: this.rentMultiplier > 1,
    };
    this.addLog(`${player.name} è su ${square.name}: deve ${rent} di affitto a ${owner.name}.`);
  }

  /** Il giocatore conferma il pagamento della tassa. */
  payTax(playerId) {
    if (this.pendingAction?.type !== 'awaiting_tax') return { error: 'Nessuna tassa da pagare' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };

    const { amount, position } = this.pendingAction;
    const player = this.players.find((p) => p.id === playerId);
    this.pendingAction = null;
    this.addLog(`${player.name} paga ${amount} di ${board[position].name}.`);
    this.chargePlayer(player, amount);

    if (!this.pendingAction) this.finishRoll(this.currentPlayer);
    return {};
  }

  /**
   * Il giocatore conferma il pagamento dell'affitto. Prima veniva addebitato da
   * solo: il denaro spariva senza che nessuno lo vedesse, e sembrava che non si
   * pagasse affatto.
   */
  payRent(playerId) {
    if (this.pendingAction?.type !== 'awaiting_rent') return { error: 'Nessun affitto da pagare' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };

    const { amount, ownerId, position } = this.pendingAction;
    const player = this.players.find((p) => p.id === playerId);
    const owner = this.players.find((p) => p.id === ownerId);
    // Si sgombra prima: se il saldo non basta, chargePlayer deve poter aprire
    // il debito al posto suo.
    this.pendingAction = null;
    this.addLog(`${player.name} paga ${amount} di affitto a ${owner.name} per ${board[position].name}.`);
    this.chargePlayer(player, amount, owner);
    // Si conta l'importo nominale dell'affitto, non quanto il proprietario
    // finisce davvero a incassare se il debitore fallisce subito dopo: è
    // un'approssimazione accettabile per un riepilogo, non un bilancio contabile.
    this.bumpStat(this.stats.rentPaid, player.id, amount);
    this.bumpStat(this.stats.rentCollected, owner.id, amount);

    if (!this.pendingAction) this.finishRoll(this.currentPlayer);
    return {};
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
    this.bumpStat(this.stats.purchases, playerId);
    this.pendingAction = null;
    this.finishRoll(player);
    return {};
  }

  /**
   * Chi rinuncia non lascia sempre la casella semplicemente libera: come nel
   * Monopoli vero, va all'asta — ma solo se `rules.auctionEnabled` è acceso
   * (è la regola aggiunta più di recente, quindi l'unica delle quattro che
   * qualcuno potrebbe voler giocare "alla vecchia", cioè spenta). Con l'asta
   * accesa il turno resta congelato (vedi endTurn) finché non si chiude: a
   * riprendere la risoluzione del tiro ci pensa closeAuction. Con l'asta
   * spenta non c'è nulla da congelare: si riprende subito, esattamente come
   * prima che l'asta esistesse.
   */
  declineBuy(playerId) {
    if (!this.pendingAction || this.pendingAction.type !== 'awaiting_buy') return { error: 'Nessun acquisto in sospeso' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };
    const { position } = this.pendingAction;
    const decliner = this.players.find((p) => p.id === playerId);
    this.addLog(`${decliner.name} rinuncia all'acquisto di ${board[position].name}.`);
    this.pendingAction = null;
    if (this.rules.auctionEnabled) {
      this.openAuction(position, decliner);
    } else {
      this.finishRoll(decliner);
    }
    return {};
  }

  // ---- Asta sulla proprietà rifiutata ----

  /**
   * Ordine di turno dell'asta: parte da chi ha rinunciato e prosegue in ordine
   * di tavolo, saltando chi è già fallito. I falliti non partecipano perché
   * non hanno più cassa con cui offrire.
   */
  auctionOrderFrom(startId) {
    const startIdx = this.players.findIndex((p) => p.id === startId);
    if (startIdx === -1) return [];
    const order = [];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[(startIdx + i) % this.players.length];
      if (!p.bankrupt) order.push(p.id);
    }
    return order;
  }

  /**
   * Incremento minimo di un'asta, calcolato sul prezzo di listino invece che
   * fisso a 10. Un incremento fisso va bene su Vicolo Corto (60: ~6 rilanci
   * per arrivare al listino) ma su Parco della Vittoria (400) costringe a una
   * quarantina di rilanci da 10 per arrivare a una cifra sensata, con i bot
   * che si alternano ogni paio di secondi: un'eternità che nessuno, giocando,
   * ha voglia di stare a guardare. Si divide il prezzo per 80 e si arrotonda
   * al multiplo di 10 più vicino: la frazione (1/8 del prezzo, poi arrotondata
   * a decina) è scelta per tenere il numero di rilanci necessari a coprire il
   * listino sempre fra le 6 e le 8 volte, poco o tanto costi la casella,
   * mantenendo comunque un salto ragionevole (mai da zero a una cifra fuori
   * mercato al primo rilancio: anche sulla casella più cara del tabellone
   * l'incremento resta 50, un ottavo del listino). Si arrotonda al multiplo di
   * 10 più vicino perché nel Monopoli si offre a decine e cinquantine, mai a
   * cifre come 37. Il minimo di 10 è solo una rete di sicurezza per una
   * casella senza prezzo (stazioni e società ce l'hanno, e nessun'altra
   * casella finisce mai all'asta, ma meglio non fidarsi e restare comunque
   * sopra zero).
   */
  auctionMinIncrement(square) {
    const price = square?.price || 0;
    return Math.max(10, Math.round(price / 80) * 10);
  }

  /**
   * Apre l'asta sulla casella appena rifiutata. `decliner` è chi stava
   * giocando il turno (o rigiocando dopo un doppio): non serve per l'asta in
   * sé, ma per sapere chi far riprendere quando si chiude (vedi closeAuction).
   */
  openAuction(position, decliner) {
    const square = board[position];
    const order = this.auctionOrderFrom(decliner.id);
    // Non dovrebbe succedere in partita (con un solo giocatore in piedi la
    // partita sarebbe già finita), ma se capitasse la casella resta libera
    // invece di aprire un'asta senza nessuno che possa offrire.
    if (order.length === 0) {
      this.finishRoll(decliner);
      return;
    }
    // Calcolato una volta sola all'apertura, sul prezzo di listino: resta lo
    // stesso per tutta l'asta, non si ricalcola a ogni rilancio.
    const minIncrement = this.auctionMinIncrement(square);
    this.pendingAction = {
      type: 'awaiting_auction',
      playerId: order[0],
      position,
      price: square.price,
      currentBid: 0,
      currentBidderId: null,
      // Coda di rotazione: chi è in testa deve rilanciare o passare adesso.
      // Chi rilancia torna in fondo; chi passa esce e non rientra più.
      queue: order,
      passedIds: [],
      originalPlayerId: decliner.id,
      // Esposti al client così l'interfaccia può mostrare subito quanto vale
      // il prossimo rilancio, invece di doverlo indovinare o ricalcolare da
      // sola: minIncrement è il passo fisso di quest'asta, minBid è la soglia
      // pronta all'uso (si aggiorna a ogni rilancio in bidAuction).
      minIncrement,
      minBid: minIncrement,
    };
    this.addLog(`${square.name} va all'asta.`);
  }

  /**
   * Rilancio: minimo l'incremento base se non c'è ancora un'offerta,
   * altrimenti almeno un incremento in più dell'offerta corrente. Non si può
   * offrire più di quanto si ha in cassa: il denaro si scala solo alla
   * chiusura dell'asta (closeAuction), ma il tetto va rispettato subito per
   * non promettere ciò che non si ha.
   */
  bidAuction(playerId, rawAmount) {
    if (this.finished) return { error: 'La partita è finita' };
    if (!this.hasPendingAuction()) return { error: 'Nessuna asta in corso' };
    const auction = this.pendingAction;
    if (auction.playerId !== playerId) return { error: 'Non tocca a te' };
    const player = this.players.find((p) => p.id === playerId);
    const amount = Math.floor(Number(rawAmount) || 0);
    const minBid = auction.currentBid === 0 ? auction.minIncrement : auction.currentBid + auction.minIncrement;
    if (amount < minBid) return { error: `Rilancio minimo ${minBid}` };
    if (amount > player.balance) return { error: 'Saldo insufficiente' };

    auction.currentBid = amount;
    auction.currentBidderId = playerId;
    // La soglia per il prossimo rilancio si aggiorna subito: è quella che il
    // client legge per sapere cosa proporre di default.
    auction.minBid = amount + auction.minIncrement;
    this.addLog(`${player.name} offre ${amount} per ${board[auction.position].name}.`);

    // Chi ha appena rilanciato torna in fondo alla coda: tocca al prossimo.
    const idx = auction.queue.indexOf(playerId);
    if (idx !== -1) {
      auction.queue.splice(idx, 1);
      auction.queue.push(playerId);
    }
    auction.playerId = auction.queue[0];
    return {};
  }

  /**
   * Passa: esce dall'asta e non gli viene più chiesto. Quando resta un solo
   * giocatore in coda l'asta si chiude da sé, senza bisogno che risponda.
   */
  passAuction(playerId) {
    if (this.finished) return { error: 'La partita è finita' };
    if (!this.hasPendingAuction()) return { error: 'Nessuna asta in corso' };
    const auction = this.pendingAction;
    if (auction.playerId !== playerId) return { error: 'Non tocca a te' };
    const player = this.players.find((p) => p.id === playerId);

    auction.queue = auction.queue.filter((id) => id !== playerId);
    auction.passedIds.push(playerId);
    this.addLog(`${player.name} passa.`);

    if (auction.queue.length <= 1) {
      this.closeAuction();
      return {};
    }
    auction.playerId = auction.queue[0];
    return {};
  }

  /**
   * Chiude l'asta: se resta un'offerta la casella va a chi l'ha fatta, al
   * prezzo offerto (anche molto sotto il listino); se nessuno ha mai offerto
   * resta libera come prima di questa regola. In ogni caso la risoluzione del
   * tiro riprende da dove l'aveva lasciata declineBuy, tiro extra da doppio
   * compreso: è lo stesso finishRoll che avrebbe chiuso il turno subito, se
   * l'asta non l'avesse messo in pausa.
   */
  closeAuction() {
    const auction = this.pendingAction;
    if (!auction || auction.type !== 'awaiting_auction') return;
    const square = board[auction.position];
    const original = this.players.find((p) => p.id === auction.originalPlayerId);

    if (auction.currentBidderId) {
      const winner = this.players.find((p) => p.id === auction.currentBidderId);
      winner.balance -= auction.currentBid;
      this.ownership[auction.position] = { ownerId: winner.id, houses: 0, hotel: false, mortgaged: false };
      this.addLog(`${winner.name} si aggiudica ${square.name} all'asta per ${auction.currentBid}.`);
      this.bumpStat(this.stats.purchases, winner.id);
    } else {
      this.addLog(`Nessuno fa offerte per ${square.name}: resta libera.`);
    }

    this.pendingAction = null;
    this.finishRoll(original);
  }

  /**
   * Toglie un giocatore fallito da un'asta in corso, se ci stava
   * partecipando. Senza questo aggancio un'asta potrebbe restare in attesa di
   * un'offerta da parte di chi non può più farla, bloccando la partita per
   * tutti — chiamata da bankruptPlayer, l'unico punto in cui si diventa
   * falliti, qualunque sia la causa (multa di prigione, abbandono, debito).
   * Se il fallito era il miglior offerente la sua offerta si annulla: non
   * potrebbe comunque pagarla.
   */
  removeFromAuctionIfPresent(playerId) {
    if (!this.hasPendingAuction()) return;
    const auction = this.pendingAction;
    if (auction.currentBidderId === playerId) {
      auction.currentBid = 0;
      auction.currentBidderId = null;
      // L'offerta annullata torna alla base d'asta: il minimo esposto al
      // client deve tornare a rifletterlo, non restare quello (più alto)
      // calcolato sull'offerta appena azzerata.
      auction.minBid = auction.minIncrement;
    }
    if (!auction.queue.includes(playerId)) return;
    auction.queue = auction.queue.filter((id) => id !== playerId);
    if (auction.queue.length <= 1) {
      this.closeAuction();
      return;
    }
    if (auction.playerId === playerId) auction.playerId = auction.queue[0];
  }

  /**
   * Pesca una carta e la mette in attesa di lettura **senza applicarla**. Prima
   * l'effetto scattava subito: il giocatore vedeva la pedina saltare o il saldo
   * cambiare senza sapere perché, e sembrava un secondo tiro impazzito.
   */
  drawCard(player, deckType) {
    const deck = deckType === 'chance' ? this.chanceDeck : this.communityDeck;
    const card = deck.shift();
    deck.push(card);
    this.addLog(`${player.name} pesca: "${card.text}"`);
    this.pendingCard = card;
    this.pendingAction = {
      type: 'awaiting_card',
      playerId: player.id,
      deck: deckType,
      text: card.text,
    };
  }

  /** Il giocatore ha letto la carta: ora l'effetto si applica. */
  acknowledgeCard(playerId) {
    if (this.pendingAction?.type !== 'awaiting_card') return { error: 'Nessuna carta da leggere' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non è la tua carta' };

    const card = this.pendingCard;
    const player = this.players.find((p) => p.id === playerId);
    this.pendingAction = null;
    this.pendingCard = null;
    if (card && player) this.applyCard(player, card);

    // La carta può aver aperto un'altra cosa da risolvere: un acquisto, un
    // debito, o perfino un'altra carta (con "vai indietro di 3" si può finire
    // su Probabilità). In quel caso il turno resta in attesa.
    if (!this.pendingAction) this.finishRoll(this.currentPlayer);
    return {};
  }

  applyCard(player, card) {
    switch (card.action) {
      case 'collect':
        player.balance += card.amount;
        break;
      case 'pay':
        this.chargePlayer(player, card.amount);
        break;
      case 'pay_each_player':
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          this.chargePlayer(player, card.amount, p);
        });
        break;
      case 'collect_from_each_player':
        // Qui il debitore può essere l'avversario, non chi sta giocando: il
        // pendingAction del debito blocca comunque la partita per entrambi.
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          this.chargePlayer(p, card.amount, player);
        });
        break;
      case 'advance_to':
        // Sempre in avanti, incassando il Via se lo si supera.
        this.movePlayerTo(player, card.target);
        break;
      case 'move_back': {
        // L'unico movimento a ritroso: non si passa dal Via, quindi non si
        // incassa, e movePlayer non va usata.
        player.position = (player.position - card.spaces + 40) % 40;
        this.addLog(`${player.name} torna indietro fino a ${board[player.position].name}.`);
        this.resolveLanding(player);
        break;
      }
      case 'advance_to_nearest_station': {
        const stations = board.filter((s) => s.type === 'station').map((s) => s.position);
        const next = stations.find((pos) => pos > player.position) ?? stations[0];
        // Alcune di queste carte fanno pagare l'affitto raddoppiato: il
        // moltiplicatore vale per il solo atterraggio che segue.
        this.rentMultiplier = card.rentMultiplier || 1;
        this.movePlayerTo(player, next);
        this.rentMultiplier = 1;
        break;
      }
      case 'get_out_of_jail':
        player.jailCards += 1;
        break;
      case 'go_to_jail':
        this.sendToJail(player);
        break;
      case 'repairs': {
        const total = this.propertiesOf(player.id).reduce(
          (sum, { owned }) => sum + owned.houses * card.perHouse + (owned.hotel ? card.perHotel : 0),
          0
        );
        if (total > 0) this.addLog(`${player.name} paga ${total} di riparazioni.`);
        this.chargePlayer(player, total);
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
    // Passa da chargePlayer (creditore nullo) così la multa finisce anche lei
    // nel montepremi della Sosta Gratuita, come quella pagata dopo 3 tentativi.
    this.chargePlayer(player, JAIL_FINE);
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

  /** Numero di unità casa presenti su ogni casella del gruppo di colore. */
  groupUnitCounts(group) {
    return board
      .filter((s) => s.group === group)
      .map((s) => (this.ownership[s.position] ? this.unitCount(this.ownership[s.position]) : 0));
  }

  buildHouse(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!square || square.type !== 'property') return { error: 'Non è una proprietà edificabile' };
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();
    if (!this.ownsFullGroup(playerId, square.group)) return { error: 'Serve il monopolio del colore per costruire' };
    // Regola ufficiale: niente costruzioni su un colore con proprietà ipotecate.
    const groupMortgaged = board.some(
      (s) => s.group === square.group && this.ownership[s.position]?.mortgaged
    );
    if (groupMortgaged) return { error: 'Riscatta prima le ipoteche del colore' };
    if (owned.hotel) return { error: "C'è già un hotel" };
    // Edificazione uniforme: si costruisce solo dove ce n'è di meno nel gruppo.
    if (this.unitCount(owned) > Math.min(...this.groupUnitCounts(square.group))) {
      return { error: 'Costruisci prima sulle altre proprietà del colore' };
    }
    if (player.balance < square.houseCost) return { error: 'Saldo insufficiente' };

    player.balance -= square.houseCost;
    if (owned.houses >= 4) {
      owned.houses = 0;
      owned.hotel = true;
      this.addLog(`${player.name} costruisce un hotel su ${square.name}.`);
    } else {
      owned.houses += 1;
      this.addLog(`${player.name} costruisce una casa su ${square.name} (${owned.houses}/4).`);
    }
    // Conta la costruzione (casa o hotel indifferentemente): quante volte il
    // giocatore ha investito in edifici, non quante unità possiede ora.
    this.bumpStat(this.stats.housesBuilt, playerId);
    return {};
  }

  /**
   * `internal` è alzato da resolveDebtAuto: durante una liquidazione a catena il
   * debito va valutato una volta sola, alla fine.
   */
  sellHouse(playerId, position, internal = false) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (this.unitCount(owned) === 0) return { error: 'Nessuna casa da vendere' };
    // Uniformità anche in vendita: si smonta da dove ce n'è di più.
    if (this.unitCount(owned) < Math.max(...this.groupUnitCounts(square.group))) {
      return { error: 'Vendi prima dalle altre proprietà del colore' };
    }

    const refund = this.buildingRefund(square);
    player.balance += refund;
    if (owned.hotel) {
      owned.hotel = false;
      owned.houses = 4;
      this.addLog(`${player.name} vende l'hotel su ${square.name} per ${refund}.`);
    } else {
      owned.houses -= 1;
      this.addLog(`${player.name} vende una casa su ${square.name} per ${refund}.`);
    }
    if (!internal) this.checkDebtResolved(player);
    return {};
  }

  mortgageProperty(playerId, position, internal = false) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (owned.mortgaged) return { error: 'Già ipotecata' };
    if (this.unitCount(owned) > 0) return { error: 'Vendi prima case/hotel' };

    const value = this.mortgageValue(square);
    owned.mortgaged = true;
    player.balance += value;
    this.addLog(`${player.name} ipoteca ${square.name} per ${value}.`);
    if (!internal) this.checkDebtResolved(player);
    return {};
  }

  unmortgageProperty(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    const player = this.players.find((p) => p.id === playerId);
    if (!owned || owned.ownerId !== playerId) return { error: 'Non possiedi questa proprietà' };
    if (!owned.mortgaged) return { error: 'Non è ipotecata' };
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.tradeFreezeBlocker()) return this.tradeFreezeBlocker();
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();
    const cost = this.unmortgageCost(square);
    if (player.balance < cost) return { error: 'Saldo insufficiente' };
    player.balance -= cost;
    owned.mortgaged = false;
    this.addLog(`${player.name} riscatta ${square.name} per ${cost}.`);
    return {};
  }

  // ---- Debiti e bancarotta ----

  /**
   * Unico punto attraverso cui un giocatore perde denaro. Il debito è modellato
   * come saldo negativo: il creditore viene pagato subito e il debitore resta in
   * rosso finché non liquida abbastanza da rientrare.
   */
  chargePlayer(player, amount, creditor = null) {
    if (amount <= 0) return;
    player.balance -= amount;
    if (creditor) {
      // C'è un creditore preciso (l'affitto, o una carta "paga a ogni
      // giocatore"): il denaro cambia mano fra giocatori, non tocca la banca,
      // quindi non deve gonfiare il montepremi della Sosta Gratuita.
      creditor.balance += amount;
    } else {
      // Nessun creditore = il denaro va alla banca (tasse, multe delle carte,
      // multa di prigione, interessi): è esattamente il denaro che altrimenti
      // sparirebbe nel nulla, quindi finisce nel montepremi — ma solo se la
      // regola della casa è accesa. Spenta, il denaro va semplicemente alla
      // banca e basta, come da regolamento: freeParkingPot resta a zero e la
      // Sosta Gratuita non paga mai nulla (vedi il case in resolveLanding,
      // che già non fa nulla quando il montepremi è vuoto). La statistica di
      // quanto è finito alla banca, invece, non dipende da questa regola: è
      // un dato del riepilogo, non l'effetto della regola stessa.
      if (this.rules.freeParkingEnabled) this.freeParkingPot += amount;
      this.bumpStat(this.stats.bankPaid, player.id, amount);
    }
    if (player.balance >= 0) return;

    // Si ricorda a chi vanno i soldi: se questo debito finisce in coda dietro a
    // quello di un altro, al momento di saldarlo serve sapere chi è il creditore.
    player.debtTo = creditor ? creditor.id : null;

    // Nemmeno svendendo tutto ce la farebbe: bancarotta immediata, nessuna scelta.
    if (this.liquidationValue(player) < 0) {
      this.addLog(`${player.name} non può coprire il debito in alcun modo.`);
      this.bankruptPlayer(player, creditor);
      return;
    }

    this.settleNextDebt();
  }

  /**
   * Apre il debito del primo giocatore rimasto in rosso. Con più di due
   * giocatori una sola carta ("incassa da ogni giocatore") può mandarne sotto
   * parecchi in un colpo solo: si risolvono uno alla volta, altrimenti il
   * secondo debito cancellerebbe il primo e chi lo aveva resterebbe in rosso
   * senza alcun modo di saldare.
   */
  settleNextDebt() {
    if (this.pendingAction || this.finished) return;
    const debitore = this.players.find((p) => !p.bankrupt && p.balance < 0);
    if (!debitore) return;

    const creditore = this.players.find((p) => p.id === debitore.debtTo);
    this.pendingAction = {
      type: 'awaiting_debt',
      playerId: debitore.id,
      amount: -debitore.balance,
      creditorId: creditore ? creditore.id : null,
    };
    this.addLog(`${debitore.name} deve coprire ${-debitore.balance}: vendi, ipoteca o dichiara bancarotta.`);
  }

  /**
   * Se il debitore è tornato in pari chiude il debito e fa ripartire il gioco.
   * Il turno finisce comunque: un debito nasce sempre durante la risoluzione di
   * un turno, anche quando a doverlo pagare è l'avversario (carta "incassa da
   * ogni giocatore").
   */
  checkDebtResolved(player) {
    if (!this.hasPendingDebt() || this.pendingAction.playerId !== player.id) return;
    if (player.balance < 0) {
      this.pendingAction.amount = -player.balance; // il debito residuo si aggiorna
      return;
    }
    this.pendingAction = null;
    player.debtTo = null;
    this.addLog(`${player.name} ha saldato il debito.`);

    // Un altro giocatore può essere ancora in rosso per la stessa carta: il suo
    // debito si apre adesso, non prima, per non sovrascrivere questo.
    this.settleNextDebt();
    if (!this.pendingAction) this.finishRoll(this.currentPlayer);
  }

  /**
   * Liquidazione automatica deterministica: prima gli edifici (partendo da dove
   * ce ne sono di più, così la regola dell'uniformità è rispettata da sé), poi le
   * ipoteche, sacrificando per ultime le proprietà che compongono un monopolio.
   * Si ferma appena il saldo torna positivo.
   */
  resolveDebtAuto(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Giocatore non trovato' };
    if (!this.hasPendingDebt() || this.pendingAction.playerId !== playerId) {
      return { error: 'Non hai debiti da saldare' };
    }

    this.liquidating = true;
    this.addLog(`${player.name} liquida automaticamente per coprire il debito.`);

    // Il contatore è solo una rete di sicurezza: ogni giro vende o ipoteca
    // qualcosa, quindi il loop termina comunque.
    let safety = 0;
    while (player.balance < 0 && safety++ < 200) {
      const withBuildings = this.propertiesOf(playerId)
        .filter((entry) => this.unitCount(entry.owned) > 0)
        .sort((a, b) => this.unitCount(b.owned) - this.unitCount(a.owned));
      if (withBuildings.length > 0) {
        this.sellHouse(playerId, withBuildings[0].position, true);
        continue;
      }

      const mortgageable = this.propertiesOf(playerId)
        .filter((entry) => !entry.owned.mortgaged)
        .sort((a, b) => {
          const aMonopoly = a.square.type === 'property' && this.ownsFullGroup(playerId, a.square.group) ? 1 : 0;
          const bMonopoly = b.square.type === 'property' && this.ownsFullGroup(playerId, b.square.group) ? 1 : 0;
          if (aMonopoly !== bMonopoly) return aMonopoly - bMonopoly; // i monopoli per ultimi
          return a.square.price - b.square.price; // poi dalle più economiche
        });
      if (mortgageable.length === 0) break;
      this.mortgageProperty(playerId, mortgageable[0].position, true);
    }

    this.liquidating = false;

    // Non dovrebbe accadere: chargePlayer fallisce prima se il patrimonio non basta.
    if (player.balance < 0) {
      const creditor = this.players.find((p) => p.id === this.pendingAction?.creditorId) || null;
      this.bankruptPlayer(player, creditor);
      return {};
    }
    this.checkDebtResolved(player);
    return {};
  }

  /** Resa volontaria del giocatore che ha un debito aperto. */
  declareBankruptcy(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Giocatore non trovato' };
    if (!this.hasPendingDebt() || this.pendingAction.playerId !== playerId) {
      return { error: 'Non hai debiti da saldare' };
    }
    const creditor = this.players.find((p) => p.id === this.pendingAction.creditorId) || null;
    this.bankruptPlayer(player, creditor);
    return {};
  }

  /**
   * Esecuzione della bancarotta, sia volontaria sia forzata. Gli edifici tornano
   * alla banca senza rimborso; le proprietà passano al creditore mantenendo
   * l'ipoteca, e su ognuna di quelle ipotecate il creditore paga subito alla
   * banca il 10% di interesse, come da regolamento. Senza creditore (tasse,
   * carte) le caselle tornano libere.
   */
  bankruptPlayer(player, creditor = null, motivo = 'bankruptcy') {
    if (player.bankrupt) return;
    player.bankrupt = true;

    let interestDue = 0;
    this.propertiesOf(player.id).forEach(({ position, square, owned }) => {
      if (creditor) {
        owned.ownerId = creditor.id;
        owned.houses = 0;
        owned.hotel = false;
        if (owned.mortgaged) interestDue += this.mortgageInterest(square);
      } else {
        delete this.ownership[position];
      }
    });

    if (creditor) {
      // Addebito diretto e non a cascata: se anche l'interesse mandasse il
      // creditore in rosso non ha senso aprirgli un secondo debito nel mezzo di
      // una bancarotta altrui.
      if (interestDue > 0) {
        creditor.balance -= interestDue;
        this.addLog(`${creditor.name} paga ${interestDue} di interessi sulle ipoteche ereditate.`);
      }
      // chargePlayer ha già accreditato al creditore l'intero importo dovuto, ma
      // il debitore quei soldi non li aveva: col saldo negativo si restituisce la
      // differenza, così il creditore incassa solo quanto esisteva davvero.
      creditor.balance += player.balance;
      this.addLog(`${player.name} è in bancarotta: tutto passa a ${creditor.name}.`);
    } else if (motivo === 'abandoned') {
      this.addLog(`${player.name} lascia il tavolo: le sue proprietà tornano libere.`);
    } else {
      this.addLog(`${player.name} è in bancarotta: le sue proprietà tornano alla banca.`);
    }

    player.balance = 0;
    player.debtTo = null;
    if (this.hasPendingDebt() && this.pendingAction.playerId === player.id) this.pendingAction = null;
    // Se stava partecipando a un'asta (o doveva rispondere lei) va tolto
    // subito: altrimenti l'asta resterebbe ad aspettare un'offerta da chi non
    // può più farla.
    this.removeFromAuctionIfPresent(player.id);
    this.checkWinner(motivo);

    // Il turno si chiude solo se a uscire è stato chi stava giocando. Quando a
    // fallire è un altro (carta "incassa da ogni giocatore") il turno in corso
    // prosegue, e a chiuderlo sarà chi lo ha iniziato.
    if (!this.finished && this.currentPlayer?.bankrupt) this.finishRoll(this.currentPlayer);
  }

  // ---- Scambi fra giocatori ----

  /** Vero se esiste anche un solo edificio sul gruppo di colore della casella. */
  groupHasBuildings(group) {
    return board.some((s) => s.group === group && this.unitCount(this.ownership[s.position] || { houses: 0 }) > 0);
  }

  /**
   * Controlla che una casella sia scambiabile da un certo giocatore. Il
   * regolamento vieta di cedere una proprietà finché sul suo colore c'è anche
   * un solo edificio: prima vanno venduti tutti.
   */
  tradeBlocker(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    if (!square || !owned) return `Casella ${position} non è di nessuno`;
    if (owned.ownerId !== playerId) return `${square.name} non è di chi la offre`;
    if (square.group && this.groupHasBuildings(square.group)) {
      return `Vendi prima gli edifici sul colore di ${square.name}`;
    }
    return null;
  }

  /**
   * Apre una proposta di scambio. Non consuma il turno: chiunque può proporre,
   * anche fuori dal proprio turno, ma la proposta congela il gioco finché
   * l'altro non risponde.
   */
  proposeTrade(fromId, {
    toId,
    offerProperties = [],
    offerMoney = 0,
    offerJailCards = 0,
    requestProperties = [],
    requestMoney = 0,
    requestJailCards = 0,
  } = {}) {
    const from = this.players.find((p) => p.id === fromId);
    const to = this.players.find((p) => p.id === toId);
    if (!this.started || this.finished) return { error: 'La partita non è in corso' };
    if (!from || !to || from.id === to.id) return { error: 'Destinatario non valido' };
    if (from.bankrupt || to.bankrupt) return { error: 'Un giocatore è fallito' };
    if (this.pendingAction) return { error: 'Prima risolvi l\'azione in sospeso' };

    const amounts = [offerMoney, requestMoney, offerJailCards, requestJailCards].map(
      (n) => Math.floor(Number(n) || 0)
    );
    if (amounts.some((n) => n < 0)) return { error: 'Gli importi non possono essere negativi' };
    const [offered, requested, offeredCards, requestedCards] = amounts;
    if (offered > from.balance) return { error: 'Non hai abbastanza denaro' };
    if (requested > to.balance) return { error: `${to.name} non ha abbastanza denaro` };
    if (offeredCards > from.jailCards) return { error: 'Non hai così tante carte uscita' };
    if (requestedCards > to.jailCards) return { error: `${to.name} non ha così tante carte uscita` };
    const isEmpty =
      offerProperties.length + requestProperties.length === 0 &&
      offered + requested + offeredCards + requestedCards === 0;
    if (isEmpty) return { error: 'Lo scambio è vuoto' };

    for (const position of offerProperties) {
      const blocker = this.tradeBlocker(fromId, position);
      if (blocker) return { error: blocker };
    }
    for (const position of requestProperties) {
      const blocker = this.tradeBlocker(toId, position);
      if (blocker) return { error: blocker };
    }

    this.pendingAction = {
      type: 'awaiting_trade',
      playerId: to.id, // tocca al destinatario rispondere
      fromId: from.id,
      toId: to.id,
      offerProperties: [...offerProperties],
      offerMoney: offered,
      offerJailCards: offeredCards,
      requestProperties: [...requestProperties],
      requestMoney: requested,
      requestJailCards: requestedCards,
    };
    this.addLog(`${from.name} propone uno scambio a ${to.name}.`);
    return {};
  }

  /** Il destinatario accetta o rifiuta. In nessun caso il turno cambia. */
  respondTrade(playerId, accept) {
    if (!this.hasPendingTrade()) return { error: 'Nessuno scambio in sospeso' };
    const trade = this.pendingAction;
    if (trade.toId !== playerId) return { error: 'Non tocca a te rispondere' };

    const from = this.players.find((p) => p.id === trade.fromId);
    const to = this.players.find((p) => p.id === trade.toId);

    if (!accept) {
      this.pendingAction = null;
      this.addLog(`${to.name} rifiuta lo scambio.`);
      return {};
    }

    // Ricontrolla al momento dell'accettazione: fra proposta e risposta i due
    // possono aver costruito o ipotecato.
    for (const position of trade.offerProperties) {
      const blocker = this.tradeBlocker(trade.fromId, position);
      if (blocker) return { error: blocker };
    }
    for (const position of trade.requestProperties) {
      const blocker = this.tradeBlocker(trade.toId, position);
      if (blocker) return { error: blocker };
    }
    if (trade.offerMoney > from.balance) return { error: `${from.name} non ha più abbastanza denaro` };
    if (trade.requestMoney > to.balance) return { error: 'Non hai abbastanza denaro' };
    if (trade.offerJailCards > from.jailCards) return { error: `${from.name} non ha più quelle carte` };
    if (trade.requestJailCards > to.jailCards) return { error: 'Non hai più quelle carte' };

    trade.offerProperties.forEach((position) => { this.ownership[position].ownerId = to.id; });
    trade.requestProperties.forEach((position) => { this.ownership[position].ownerId = from.id; });

    const netCards = trade.offerJailCards - trade.requestJailCards;
    from.jailCards -= netCards;
    to.jailCards += netCards;

    // Solo la differenza cambia di mano, così non si creano saldi negativi
    // intermedi se entrambi mettono denaro sul piatto.
    const net = trade.offerMoney - trade.requestMoney;
    from.balance -= net;
    to.balance += net;

    this.addLog(`${from.name} e ${to.name} concludono lo scambio.`);
    this.stats.tradesCompleted += 1;
    this.pendingAction = null;

    // Chi riceve una proprietà ipotecata paga subito il 10% alla banca. Si fa
    // dopo aver chiuso il pendingAction perché l'interesse può aprire un debito.
    this.chargeMortgageInterest(to, trade.offerProperties);
    this.chargeMortgageInterest(from, trade.requestProperties);
    return {};
  }

  /** Interesse del 10% dovuto da chi riceve proprietà ipotecate in uno scambio. */
  chargeMortgageInterest(player, positions) {
    const due = positions.reduce(
      (sum, position) => sum + (this.ownership[position]?.mortgaged ? this.mortgageInterest(board[position]) : 0),
      0
    );
    if (due <= 0) return;
    this.addLog(`${player.name} paga ${due} di interessi sulle ipoteche ricevute.`);
    this.chargePlayer(player, due);
  }

  // ---- Fine anticipata ----

  /**
   * Un giocatore lascia il tavolo: l'avversario vince a tavolino. Diverso dalla
   * bancarotta, dove si perde per esaurimento; qui si sceglie di smettere.
   */
  abandonGame(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Giocatore non trovato' };
    if (this.finished) return { error: 'La partita è già finita' };

    if (player.bankrupt) return { error: 'Sei già fuori dalla partita' };

    // Chi si ritira esce come chi fallisce: le sue proprietà tornano libere e la
    // partita prosegue fra i rimanenti. In due questo coincide con la vittoria
    // a tavolino dell'altro, perché resta lui solo.
    const eraDiTurno = this.currentPlayer?.id === playerId;
    const suoDebito = this.hasPendingDebt() && this.pendingAction.playerId === playerId;
    if (suoDebito) this.pendingAction = null;

    this.addLog(`${player.name} abbandona la partita.`);
    this.bankruptPlayer(player, null, 'abandoned');

    // Il turno si tocca solo se se n'è andato chi stava giocando: un abbandono
    // durante il turno altrui non deve interromperlo.
    if (!this.finished && (eraDiTurno || suoDebito)) {
      this.settleNextDebt();
      if (!this.pendingAction) this.endTurn();
    }
    return {};
  }

  /** Chi ha creato il tavolo lo chiude per entrambi, senza vincitori. */
  endGame(playerId) {
    if (playerId !== this.hostId) {
      return { error: 'Solo chi ha creato il tavolo può chiudere la partita' };
    }
    if (this.finished) return { error: 'La partita è già finita' };
    this.finished = true;
    this.endedReason = 'closed';
    this.winnerId = null;
    this.pendingAction = null;
    this.stats.finishedAt = Date.now();
    this.addLog('Il tavolo è stato chiuso da chi lo ha creato.');
    return {};
  }

  /**
   * Chiede la rivincita. Quando entrambi l'hanno chiesta la partita riparte da
   * zero. Non è possibile se il tavolo è stato chiuso: quel bottone significa
   * "abbiamo finito", e la stanza non esiste più.
   */
  requestRematch(playerId) {
    if (!this.finished) return { error: 'La partita non è ancora finita' };
    if (this.endedReason === 'closed') return { error: 'Il tavolo è stato chiuso' };
    if (!this.hasPlayer(playerId)) return { error: 'Non sei a questo tavolo' };
    if (this.rematchVotes.includes(playerId)) return { error: 'Hai già chiesto la rivincita' };

    this.rematchVotes.push(playerId);
    const player = this.players.find((p) => p.id === playerId);
    this.addLog(`${player.name} chiede la rivincita.`);

    if (this.players.every((p) => this.rematchVotes.includes(p.id))) this.rematch();
    return {};
  }

  /**
   * Riparte da capo con gli stessi giocatori e lo stesso tavolo: saldi, pedine,
   * proprietà e mazzi tornano come all'inizio. Restano solo l'identità dei
   * giocatori, chi è il creatore del tavolo, chi è collegato — e le regole
   * della casa (`this.rules`, di proposito non toccato qui sotto): chi
   * rigioca vuole le stesse regole scelte all'inizio, non i default.
   */
  rematch() {
    this.ownership = {};
    this.players.forEach((p) => {
      // Il saldo di partenza è quello scelto con le regole della casa, non
      // per forza 1500: this.rules non viene azzerato da questo metodo.
      p.balance = this.rules.startingBalance;
      p.position = 0;
      p.inJail = false;
      p.jailTurns = 0;
      p.jailCards = 0;
      p.bankrupt = false;
      p.doublesInARow = 0;
    });
    // Ricostruiti con buildDeck, non importati grezzi da board.js: la carta
    // "Avanza fino al Via" deve continuare a citare l'importo di questa
    // partita (this.rules.goAmount), che qui non cambia mai rispetto a prima
    // della rivincita.
    this.chanceDeck = shuffle(this.buildDeck(CHANCE_CARDS));
    this.communityDeck = shuffle(this.buildDeck(COMMUNITY_CARDS));
    this.pendingAction = null;
    this.pendingCard = null;
    this.rentMultiplier = 1;
    this.finished = false;
    this.winnerId = null;
    this.endedReason = null;
    this.rematchVotes = [];
    this.turnIndex = 0;
    this.turnResolved = false;
    this.lastRollWasDouble = false;
    this.lastRoll = null;
    this.rollCount = 0;
    // Senza questo azzeramento il montepremi si porterebbe dietro nella
    // rivincita i soldi della partita precedente.
    this.freeParkingPot = 0;
    // Stesso discorso per le statistiche del riepilogo: senza resetStats() la
    // rivincita mostrerebbe alla fine i numeri sommati anche alla partita
    // precedente, invece di ripartire da zero come fa il resto del tavolo.
    this.resetStats();
    this.stats.startedAt = Date.now();
    this.log = [];
    this.started = true;
    this.addLog('Rivincita! Si riparte da zero.');
  }

  /** Con un solo giocatore ancora in piedi la partita è finita. */
  checkWinner(motivo = 'bankruptcy') {
    if (!this.started || this.finished) return;
    const alive = this.players.filter((p) => !p.bankrupt);
    if (alive.length === 1) {
      this.finished = true;
      this.winnerId = alive[0].id;
      this.endedReason = motivo;
      this.stats.finishedAt = Date.now();
      this.addLog(`${alive[0].name} vince la partita!`);
    }
  }

  endTurn() {
    // Un debito o uno scambio aperto congelano la partita per entrambi.
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.hasPendingTrade()) return { error: 'Prima rispondi allo scambio proposto' };
    if (this.hasPendingCard()) return { error: 'Prima leggi la carta pescata' };
    if (this.hasPendingRent()) return { error: 'Prima paga l\'affitto' };
    if (this.hasPendingTax()) return { error: 'Prima paga la tassa' };
    // Anche l'asta congela il turno: si è aperta a metà della risoluzione del
    // tiro (vedi declineBuy) e deve chiudersi da sé (closeAuction) prima che
    // il turno possa avanzare, tiro extra da doppio compreso.
    if (this.hasPendingAuction()) return { error: 'Prima risolvi l\'asta in corso' };
    // Il turno può essere chiuso una sola volta per tiro: una bancarotta lo
    // chiude già da dentro resolveLanding, e rollDice non deve rifarlo.
    if (this.turnResolved || this.finished) return {};
    this.turnResolved = true;
    this.pendingAction = null;
    // Il tiro appena chiuso non è più quello in corso: se restasse in
    // `lastRoll` il tabellone continuerebbe a mostrare nome e somma di chi ha
    // già finito, facendo credere che stia ancora giocando lui. Col doppio
    // invece `finishRoll` non arriva fin qui (vedi sopra), quindi la scritta
    // resta finché il giocatore che deve rigiocare non tira di nuovo.
    this.lastRoll = null;
    // I doppi contano solo entro il turno di chi li ha tirati.
    if (this.currentPlayer) this.currentPlayer.doublesInARow = 0;
    if (this.players.every((p) => p.bankrupt)) return {};
    do {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
    } while (this.currentPlayer.bankrupt);
    this.addLog(`Turno di ${this.currentPlayer.name}.`);
  }
}

module.exports = { GameEngine, board };
