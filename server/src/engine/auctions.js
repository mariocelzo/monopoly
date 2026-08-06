const { board } = require('../data/board');

module.exports = {
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
  },

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
  },

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
  },

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
  },

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
  },

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

    // Chi si aggiudica la casella deve poterla pagare, e il posto per
    // accorgersene è questo. L'offerta era già stata confrontata con la cassa
    // nel momento in cui è stata fatta (vedi bidAuction), ma fra quel momento e
    // adesso passa tempo di gioco, e quel denaro resta certo solo finché
    // nessuno lo tocca: è esattamente il motivo per cui l'asta congela la spesa
    // libera per tutti (auctionFreezeBlocker). Se si riaprisse una strada per
    // spendere a metà asta — è già successo con la multa della prigione, che
    // quel congelamento non lo attraversava — qui il conto tornerebbe scoperto
    // in silenzio: saldo negativo e nessuna finestra che chieda di rientrare,
    // cioè un giocatore che non può più pagare nulla e a cui il motore non
    // chiede niente. Il costo di questa rete è un confronto a fine asta; il
    // guadagno è che quel guaio, se ricapita, si presenta come un normale
    // debito da coprire invece che come uno stato impossibile.
    let scoperto = false;
    if (auction.currentBidderId) {
      const winner = this.players.find((p) => p.id === auction.currentBidderId);
      winner.balance -= auction.currentBid;
      this.ownership[auction.position] = { ownerId: winner.id, houses: 0, hotels: 0, mortgaged: false };
      this.addLog(`${winner.name} si aggiudica ${square.name} all'asta per ${auction.currentBid}.`);
      this.bumpStat(this.stats.purchases, winner.id);
      // Come in buyProperty: aggiudicarsi una casella svuota la cassa senza
      // passare da chargePlayer, e una proposta aperta che prometteva quei
      // contanti non sta più in piedi.
      this.decadiProposteImpossibili();
      if (winner.balance < 0) {
        winner.debtTo = null; // verso la banca, come ogni acquisto
        scoperto = true;
      }
    } else {
      this.addLog(`Nessuno fa offerte per ${square.name}: resta libera.`);
    }

    this.pendingAction = null;
    // Il debito si apre PRIMA di riprendere il tiro: finishRoll passa da
    // endTurn, che con un debito in sospeso si ferma da sé — ed è giusto, il
    // turno non deve avanzare finché il conto è scoperto. A rimettere in moto
    // la partita ci pensa checkDebtResolved quando il debito è saldato.
    if (scoperto) this.settleNextDebt();
    this.finishRoll(original);
  },

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
  },

};
