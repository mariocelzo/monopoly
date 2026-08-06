const { CHANCE_CARDS, COMMUNITY_CARDS } = require('../data/board');
const { shuffle } = require('./pricing');

module.exports = {
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
    // Va chiusa QUALUNQUE finestra intestata a chi esce, non solo il debito.
    // Chi abbandona può avere aperta una proposta d'acquisto, una carta da
    // leggere, un affitto o una tassa da confermare: quella finestra congela
    // la partita per tutti, e l'unico che potrebbe risolverla se ne sta
    // andando. endTurn non basta a ripulirla, perché sulle finestre di
    // affitto, tassa e carta si ferma proprio lui (vedi le sue guardie).
    //
    // Con una sola eccezione, l'asta: quella non è una finestra soltanto sua.
    // È di tutti quelli rimasti in coda, e cancellarla perché tocca a lui
    // parlare buttava via l'asta intera — la migliore offerta di un altro
    // compresa, con la casella che tornava libera e nessuno che capiva perché.
    // A toglierlo dall'asta senza distruggerla ci pensa già
    // removeFromAuctionIfPresent, chiamata da bankruptPlayer qui sotto: annulla
    // la sua offerta se era la più alta, lo leva dalla coda, passa la parola al
    // prossimo e, se resta un solo offerente, chiude l'asta assegnandogli la
    // casella. Cioè esattamente quello che succede a chi fallisce in mezzo a
    // un'asta, che è la stessa situazione vista da un'altra porta.
    const suaFinestra = this.pendingAction?.playerId === playerId && !this.hasPendingAuction();
    if (suaFinestra) this.pendingAction = null;

    this.addLog(`${player.name} abbandona la partita.`);
    this.bankruptPlayer(player, null, 'abandoned');

    // Il turno si tocca solo se se n'è andato chi stava giocando: un abbandono
    // durante il turno altrui non deve interromperlo.
    if (!this.finished && (eraDiTurno || suaFinestra)) {
      this.settleNextDebt();
      // Se il turno è ancora intestato a chi è appena uscito va spostato a
      // mano, e non con endTurn: chi abbandona senza aver ancora tirato lascia
      // `turnResolved` alzato dal turno precedente, endTurn si fermerebbe lì e
      // la partita resterebbe in attesa di un giocatore che non c'è più — un
      // blocco definitivo, con tre o più giocatori al tavolo. La condizione sul
      // giocatore in bancarotta (dentro resumeTurnIfHolderLeft) rende questa
      // chiamata innocua quando il turno è già avanzato da sé (bankruptPlayer
      // chiama finishRoll). Se invece resta aperto il debito di QUALCUN ALTRO
      // qui non si può fare nulla e il turno si sposta più tardi, quando quel
      // debito si chiude: stessa rete di sicurezza, vedi
      // resumeTurnIfHolderLeft. (Prima l'elenco comprendeva anche lo scambio;
      // adesso una proposta non ferma più nessun turno.)
      this.resumeTurnIfHolderLeft();
    }
    return {};
  },

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
    // Stessa ragione della finestra: a tavolo chiuso non resta niente da
    // decidere, e una proposta sopravvissuta terrebbe congelate proprietà in
    // una partita che non esiste più — visibile subito alla rivincita, che
    // riparte dagli stessi giocatori.
    this.tradeOffers = [];
    this.stats.finishedAt = Date.now();
    this.addLog('Il tavolo è stato chiuso da chi lo ha creato.');
    return {};
  },

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
  },

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
    // Le proposte non sopravvivono alla rivincita, per la stessa ragione dei
    // saldi e delle proprietà: si riparte da zero. Il contatore degli id invece
    // NON si azzera, di proposito — è l'unica cosa che non deve ripetersi, così
    // un client rimasto con in mano l'id di una proposta della partita
    // precedente non può ritrovarselo valido su una proposta nuova.
    this.tradeOffers = [];
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
  },

  /** Con un solo giocatore ancora in piedi la partita è finita. */
  checkWinner(motivo = 'bankruptcy') {
    if (!this.started || this.finished) return;
    const alive = this.players.filter((p) => !p.bankrupt);
    if (alive.length === 1) {
      this.finished = true;
      this.winnerId = alive[0].id;
      this.endedReason = motivo;
      this.stats.finishedAt = Date.now();
      // A partita finita non deve restare aperta nessuna finestra: era
      // intestata a qualcuno che a questo punto è fuori dai giochi, e il
      // client la mostrerebbe sopra la schermata di fine partita chiedendo
      // una decisione che non ha più senso prendere. endTurn di solito la
      // chiude, ma quando la partita finisce si ferma prima (vedi la guardia
      // su `finished`), quindi va chiusa qui. Le proposte aperte seguono la
      // stessa sorte: con un solo giocatore rimasto in piedi non c'è più
      // nessuno con cui trattare, e una proposta superstite lascerebbe
      // congelate le proprietà del vincitore.
      this.pendingAction = null;
      this.tradeOffers = [];
      this.addLog(`${alive[0].name} vince la partita!`);
    }
  },

};
