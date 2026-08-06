const { board, GO_AMOUNT, CHANCE_CARDS, COMMUNITY_CARDS } = require('./data/board');
const { boardWithAmounts, shuffle } = require('./engine/pricing');
const stateMixin = require('./engine/state');
const propertiesMixin = require('./engine/properties');
const turnMixin = require('./engine/turn');
const buyingMixin = require('./engine/buying');
const auctionsMixin = require('./engine/auctions');
const cardsMixin = require('./engine/cards');
const jailMixin = require('./engine/jail');
const buildingsMixin = require('./engine/buildings');
const debtsMixin = require('./engine/debts');
const tradesMixin = require('./engine/trades');
const lifecycleMixin = require('./engine/lifecycle');
const disconnectionMixin = require('./engine/disconnection');
const {
  STARTING_BALANCE,
  MAX_PLAYERS,
  GO_AMOUNT_OPTIONS,
  STARTING_BALANCE_OPTIONS,
  SKIP_TURN_DELAY_MS,
  JAIL_FINE,
} = require('./engine/constants');

/**
 * Il motore di gioco, adesso diviso in moduli sotto ./engine/ invece che in un
 * unico file da 2.700 righe. Perché ora e non prima: il file era cresciuto
 * insieme al progetto, e ogni volta che serviva capire come una regola ne
 * toccasse un'altra bisognava scorrerlo tutto. La divisione NON cambia una
 * virgola di comportamento — ogni metodo è stato spostato byte per byte dal
 * file originale con uno script che tagliava e incollava per numero di riga,
 * non riscritto — e la rete di sicurezza per dimostrarlo è la stessa di
 * sempre: 729 asserzioni di smoke-test.js, il fuzzer a invarianti su più
 * semi, e in più un confronto di stato mossa per mossa fra la versione
 * prima e dopo lo split, entrambe guidate dallo stesso seme casuale, su
 * centinaia di migliaia di mosse senza una sola differenza.
 *
 * Ogni modulo esporta un oggetto di metodi che diventano parte del
 * prototipo con Object.assign: stesso `this`, stesso comportamento di un
 * metodo scritto direttamente nella classe. Solo il costruttore e i metodi
 * più strettamente legati al ciclo di vita del tavolo (aggiungere un
 * giocatore, le regole della casa, la serializzazione per il client)
 * restano qui: sono il nucleo a cui gli altri moduli si aggiungono, non un
 * dominio a sé.
 */
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
      // Modalità grattacieli: spenta di default, così una partita creata
      // senza toccare le regole si comporta esattamente come prima che
      // questa regola esistesse (un solo hotel per proprietà).
      skyscraperEnabled: false,
    };
    // Il mazzo si costruisce qui, non si importa già pronto da board.js:
    // alcune carte citano a parole l'importo del Via (vedi buildDeck) e
    // quel testo deve rispecchiare `this.rules.goAmount` di QUESTA partita.
    this.chanceDeck = shuffle(this.buildDeck(CHANCE_CARDS));
    this.communityDeck = shuffle(this.buildDeck(COMMUNITY_CARDS));
    // { type: 'awaiting_buy' | 'awaiting_card' | 'awaiting_rent' | 'awaiting_tax' |
    //   'awaiting_debt' | 'awaiting_auction',
    //   playerId, ... }
    // Blocca il flusso del turno finché il giocatore indicato da playerId non
    // risolve: compra o rinuncia, legge la carta, paga l'affitto, salda il
    // debito, rilancia o passa all'asta.
    //
    // Questo slot significa una cosa sola, ed è per questo che è uno solo: **il
    // tavolo è fermo perché si aspetta una decisione da qualcuno**. Fino a ieri
    // ci abitava anche 'awaiting_trade', che è una cosa diversa — una proposta
    // fra due giocatori — e quella convivenza è esattamente il difetto che
    // questa versione toglie di mezzo: chi giocava se ne accorgeva così, «se
    // qualcuno fa uno scambio devo aspettare anche io». Le proposte adesso
    // vivono in `tradeOffers` qui sotto. Se un domani serve una finestra nuova,
    // la domanda da farsi è quella: ferma il tavolo per tutti? Allora sta qui.
    // Riguarda solo due persone? Allora non ci sta.
    this.pendingAction = null;
    // Proposte di scambio aperte, tutte insieme. NON fermano il tavolo: chi non
    // è coinvolto tira i dadi, costruisce, ipoteca e propone a sua volta come se
    // non ci fossero. Fermano soltanto la merce dei due coinvolti (vedi
    // tradeGoodsBlocker), perché fare un'offerta e poi ipotecare di nascosto
    // quello che si è promesso non è una trattativa, è un imbroglio.
    //
    // Forma di ogni voce: { id, fromId, toId, offerProperties, offerMoney,
    // offerJailCards, requestProperties, requestMoney, requestJailCards }.
    // Al più UNA per proponente, quante se ne vuole per destinatario: il perché
    // sta per esteso in proposeTrade.
    this.tradeOffers = [];
    // Progressivo per gli id delle proposte. Serve perché le proposte aperte
    // ora sono più d'una: rispondere "allo scambio" non basta più a dire a
    // QUALE, e senza un id due offerte arrivate insieme allo stesso giocatore
    // si accetterebbero l'una per l'altra al primo doppio tocco.
    this.tradeCounter = 0;
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
    // Interruttore booleano come freeParkingEnabled/auctionEnabled qui sopra:
    // nessun elenco di opzioni da validare, solo vero o falso.
    if (changes.skyscraperEnabled !== undefined) {
      next.skyscraperEnabled = Boolean(changes.skyscraperEnabled);
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
      // Il patrimonio pieno (vedi netWorth qui sopra) si ricalcola a ogni
      // serializzazione, sullo stesso principio del liquidationValue di
      // pendingAction: un oggetto giocatore "arricchito" al volo, senza
      // scrivere il campo dentro this.players. Così il motore resta l'unica
      // fonte di verità sulle regole di gioco e il client non deve
      // ricostruirsi da solo un calcolo che già gli arriva pronto.
      players: this.players.map((p) => ({ ...p, netWorth: this.netWorth(p) })),
      ownership: this.ownership,
      turnIndex: this.turnIndex,
      started: this.started,
      log: this.log.slice(-30),
      pendingAction,
      // Tutte le proposte aperte, non solo quella di chi legge: il client deve
      // poter dire a ciascuno la cosa giusta (chi deve rispondere vede il
      // baratto, chi ha proposto vede l'attesa con il modo di ritirarla) senza
      // che il server debba costruire uno stato diverso per ogni socket — qui
      // si è sempre trasmesso lo stesso stato a tutti, e non è il momento di
      // cambiare quella regola. Non c'è nulla di segreto in una proposta: è
      // pubblica anche al tavolo vero, dove si tratta ad alta voce.
      tradeOffers: this.tradeOffers,
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
      // La multa per uscire di prigione. Non è una regola della casa — non si
      // sceglie — ma è una cifra che il client scrive su un bottone ("Paga
      // €50"), e finora la scriveva a mano. Se un domani cambiasse qui, quel
      // bottone direbbe un importo e il motore ne addebiterebbe un altro:
      // stessa famiglia di guai degli altri importi (vedi il commento in cima
      // a boardWithAmounts). Un numero per trasmissione, e il conto torna
      // sempre.
      jailFine: JAIL_FINE,
    };
  }
}

Object.assign(
  GameEngine.prototype,
  stateMixin,
  propertiesMixin,
  turnMixin,
  buyingMixin,
  auctionsMixin,
  cardsMixin,
  jailMixin,
  buildingsMixin,
  debtsMixin,
  tradesMixin,
  lifecycleMixin,
  disconnectionMixin
);

module.exports = { GameEngine, board, boardWithAmounts, SKIP_TURN_DELAY_MS, JAIL_FINE };
