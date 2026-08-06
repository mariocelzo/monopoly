const { board } = require('../data/board');

module.exports = {
  /** Le proposte aperte che riguardano un giocatore, da un lato o dall'altro. */
  tradeOffersOf(playerId) {
    return this.tradeOffers.filter((t) => t.fromId === playerId || t.toId === playerId);
  },

  /**
   * Le caselle che un giocatore ha messo sul piatto in una proposta aperta: le
   * sue, cioè quelle che offre se è lui a proporre e quelle che gli vengono
   * chieste se è lui a dover rispondere. Sono la "merce impegnata".
   */
  tradeLockedPositions(playerId) {
    const bloccate = new Set();
    for (const t of this.tradeOffers) {
      const lato = t.fromId === playerId ? t.offerProperties : t.toId === playerId ? t.requestProperties : [];
      lato.forEach((position) => bloccate.add(position));
    }
    return bloccate;
  },

  /**
   * Il congelamento che sostituisce quello vecchio, e la differenza è tutta qui:
   * prima una proposta bloccava costruzioni, vendite e ipoteche di CHIUNQUE
   * fosse al tavolo; adesso blocca soltanto la merce dei due che stanno
   * trattando. Chi non c'entra non se ne accorge nemmeno.
   *
   * Cosa si congela, e perché solo questo:
   *   - la casella stessa, contro ipoteca e riscatto: sono le due mosse che
   *     cambiano quanto vale ciò che si è promesso senza che l'altro possa
   *     accorgersene prima di aver detto sì;
   *   - l'INTERO colore, contro le costruzioni: il regolamento vieta di cedere
   *     una proprietà finché sul suo colore c'è anche un solo edificio (vedi
   *     tradeBlocker), quindi tirare su una casa sul gruppo renderebbe la
   *     proposta impossibile da accettare. Era il modo più semplice di
   *     sabotare la propria offerta dopo averla fatta.
   *
   * Cosa NON si congela, di proposito: la vendita di edifici. Su un colore che
   * compare in una proposta aperta edifici non ce ne sono — se ce ne fossero la
   * proposta non sarebbe mai stata accettata da tradeBlocker, e costruirne di
   * nuovi è appunto vietato qui sopra — quindi non c'è niente da vendere e una
   * guardia in più sarebbe solo un errore in attesa di capitare a qualcuno che
   * vende case dall'altra parte del tabellone. Nemmeno il denaro si congela:
   * bloccare la cassa di chi tratta vorrebbe dire impedirgli di pagare un
   * affitto. Il denaro promesso si ricontrolla alla risposta, e se non c'è più
   * la proposta decade da sé (vedi decadiProposteImpossibili).
   */
  tradeGoodsBlocker(playerId, position, { includiGruppo = false } = {}) {
    const bloccate = this.tradeLockedPositions(playerId);
    const impegnata = includiGruppo
      ? [...bloccate].some((pos) => board[pos].group && board[pos].group === board[position]?.group)
      : bloccate.has(position);
    if (!impegnata) return null;
    return { error: `${board[position].name} è in gioco in uno scambio: prima chiudilo` };
  },

  /** Vero se esiste anche un solo edificio sul gruppo di colore della casella. */
  groupHasBuildings(group) {
    return board.some((s) => s.group === group && this.unitCount(this.ownership[s.position] || { houses: 0, hotels: 0 }) > 0);
  },

  /**
   * Controlla che una casella sia scambiabile da un certo giocatore. Il
   * regolamento vieta di cedere una proprietà finché sul suo colore c'è anche
   * un solo edificio: prima vanno venduti tutti.
   *
   * I motivi sono scritti in terza persona (una CAUSA, non un ordine) perché lo
   * stesso testo serve in due momenti diversi: quando si rifiuta la proposta a
   * chi la sta facendo, e quando una proposta già aperta decade e il registro
   * deve dire a tutto il tavolo perché (vedi motivoDecadenza). "Vendi prima gli
   * edifici", com'era scritto prima, nel registro suonerebbe come un ordine
   * rivolto a chi legge, che non c'entra niente.
   */
  tradeBlocker(playerId, position) {
    const square = board[position];
    const owned = this.ownership[position];
    if (!square || !owned) return `Casella ${position} non è di nessuno`;
    if (owned.ownerId !== playerId) return `${square.name} non è di chi la mette sul piatto`;
    if (square.group && this.groupHasBuildings(square.group)) {
      return `Ci sono edifici sul colore di ${square.name}`;
    }
    return null;
  },

  /**
   * Apre una proposta di scambio. Non consuma il turno e — questa è la novità —
   * non ferma nemmeno il tavolo: chiunque può proporre, anche fuori dal proprio
   * turno, e mentre due trattano tutti gli altri continuano a giocare.
   *
   * QUANTE PROPOSTE PUÒ AVERE APERTE UN GIOCATORE, e perché la risposta è
   * diversa nei due versi:
   *
   *   - RICEVUTE: quante ne arrivano. Impedire a due giocatori di proporre allo
   *     stesso destinatario nello stesso momento sarebbe la vecchia attesa
   *     rimessa in piedi in piccolo — «non posso proporre a Giulia perché ci sta
   *     già parlando Marco» è la stessa frustrazione da cui siamo partiti, solo
   *     con un giocatore in meno. Chi le riceve risponde a una alla volta, nel
   *     suo ordine.
   *   - FATTE: una sola. Non è una simmetria mancata per pigrizia: la proposta
   *     è una PROMESSA, e ciò che si promette resta congelato (vedi
   *     tradeGoodsBlocker). Chi potesse tenerne aperte cinque congelerebbe mezzo
   *     tabellone senza aver concluso niente, e soprattutto potrebbe promettere
   *     Via Roma a tre persone diverse sapendo che due delle tre offerte
   *     moriranno — una all'asta al ribasso mascherata da trattativa. Una per
   *     volta: si aspetta la risposta, oppure si ritira (vedi cancelTrade).
   *
   * Che invece la stessa casella compaia in due proposte DIVERSE (Marco chiede
   * a Giulia il Parco, e anche Anna glielo chiede) è permesso apposta: vietarlo
   * significherebbe che il primo che chiede una casella se la prenota contro
   * tutti gli altri, e basterebbe chiedere tutto a tutti per bloccare il
   * mercato. Vince chi si accorda per primo; l'altra proposta decade da sé, con
   * il motivo scritto nel registro (vedi decadiProposteImpossibili).
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
    // Non QUALUNQUE azione in sospeso ferma una trattativa: solo le due che il
    // motore già tratta come "la spesa è congelata per tutti", cioè il debito e
    // l'asta (le stesse due guardie che hanno buildHouse e unmortgageProperty).
    //
    // La prima versione bloccava su un pendingAction qualsiasi, e la prova a
    // mano con tre client l'ha smontata in tre mosse: Z tira, atterra su una
    // casella libera, e da lì in poi nessuno poteva più proporre niente finché
    // Z non decideva se comprare. Cioè il difetto di partenza, tornato da
    // un'altra porta — e quella finestra si apre a quasi ogni tiro. Acquisto,
    // affitto, tassa e carta non hanno bisogno di questo divieto: riguardano un
    // giocatore solo, si risolvono in un gesto, e ricontrollano da sé i conti
    // al momento di eseguire.
    //
    // Debito e asta invece sì, e per la ragione per cui esistono quelle
    // guardie: durante un'asta il denaro di chi rilancia deve restare certo,
    // altrimenti un'offerta già fatta diventa scoperta all'aggiudicazione; e con
    // un debito aperto il motore sta facendo i conti in tasca a qualcuno, quindi
    // non è il momento di spostargli proprietà e contanti sotto i piedi.
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();
    // Una proposta per volta, per chi la fa (il perché sta nel commento sopra).
    if (this.tradeOffers.some((t) => t.fromId === fromId)) {
      return { error: 'Hai già una proposta aperta: aspetta la risposta o ritirala' };
    }

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

    this.tradeCounter += 1;
    this.tradeOffers.push({
      id: `t${this.tradeCounter}`,
      fromId: from.id,
      toId: to.id,
      offerProperties: [...offerProperties],
      offerMoney: offered,
      offerJailCards: offeredCards,
      requestProperties: [...requestProperties],
      requestMoney: requested,
      requestJailCards: requestedCards,
    });
    this.addLog(`${from.name} propone uno scambio a ${to.name}.`);
    return {};
  },

  /** La proposta con quell'id, o null: unico punto in cui si cerca per id. */
  findTradeOffer(tradeId) {
    return this.tradeOffers.find((t) => t.id === tradeId) || null;
  },

  /**
   * Toglie una proposta dal tavolo e lo scrive nel registro. Il motivo non è un
   * di più: una proposta che sparisce senza spiegazione, mentre il resto del
   * tavolo continua a giocare, è indistinguibile da un guasto — e adesso che
   * non congela più la partita nessuno la sta fissando nel momento in cui
   * svanisce.
   */
  rimuoviProposta(trade, motivo) {
    const i = this.tradeOffers.indexOf(trade);
    if (i === -1) return;
    this.tradeOffers.splice(i, 1);
    const from = this.players.find((p) => p.id === trade.fromId);
    const to = this.players.find((p) => p.id === trade.toId);
    this.addLog(`Lo scambio fra ${from?.name || '?'} e ${to?.name || '?'} decade: ${motivo}.`);
  },

  /**
   * Perché una proposta non si può più concludere, o null se regge ancora.
   *
   * È la SOLA definizione di "proposta valida" del motore, e la usano entrambi i
   * momenti in cui serve: la risposta (che rifiuta un'accettazione impossibile)
   * e la scopa periodica qui sotto (che toglie di mezzo le proposte morte). Che
   * sia una funzione sola non è eleganza: finché lo scambio era un pendingAction
   * unico, fra la proposta e la risposta il mondo non poteva cambiare quasi in
   * niente, perché tutti erano fermi. Adesso può cambiare in tutto — l'altro
   * gioca, incassa, paga, compra — e due elenchi di controlli scritti in due
   * punti diversi divergerebbero alla prima modifica, lasciando accettabile
   * qualcosa che il registro dà per decaduto (o viceversa).
   *
   * I motivi sono in terza persona perché lo stesso testo finisce sia nel
   * registro, che leggono tutti, sia nel rifiuto mostrato a chi ha premuto.
   */
  motivoDecadenza(trade) {
    const from = this.players.find((p) => p.id === trade.fromId);
    const to = this.players.find((p) => p.id === trade.toId);
    if (!from || !to || from.bankrupt || to.bankrupt) return 'Un giocatore non è più in partita';

    // Le proprietà: possedute ancora da chi le mette sul piatto, e senza
    // edifici sul colore (vedi tradeBlocker, la regola è del regolamento).
    for (const position of trade.offerProperties) {
      const blocker = this.tradeBlocker(trade.fromId, position);
      if (blocker) return blocker;
    }
    for (const position of trade.requestProperties) {
      const blocker = this.tradeBlocker(trade.toId, position);
      if (blocker) return blocker;
    }
    // Il denaro e le carte, che a differenza delle proprietà NON si congelano:
    // chi tratta deve poter pagare un affitto mentre l'altro decide. È quindi
    // normalissimo che qui non ci siano più, ed è esattamente il caso che prima
    // non poteva capitare perché il tavolo era fermo.
    if (trade.offerMoney > from.balance) return `${from.name} non ha più i ${trade.offerMoney} promessi`;
    if (trade.requestMoney > to.balance) return `${to.name} non ha più i ${trade.requestMoney} richiesti`;
    if (trade.offerJailCards > from.jailCards) return `${from.name} non ha più le carte uscita promesse`;
    if (trade.requestJailCards > to.jailCards) return `${to.name} non ha più le carte uscita richieste`;
    return null;
  },

  /**
   * Toglie dal tavolo le proposte che non si possono più concludere.
   *
   * Va chiamata da ogni punto in cui un giocatore può PERDERE qualcosa che
   * aveva messo sul piatto: denaro (chargePlayer, e i pochi addebiti diretti
   * che non ci passano), carte uscita, proprietà. Lasciarle lì sarebbe la scelta
   * peggiore delle due possibili: chi ha ricevuto l'offerta continuerebbe a
   * vedersela davanti, premerebbe Accetta e si prenderebbe un rifiuto per una
   * cosa che non ha fatto lui — e non avrebbe alcun modo di capire cosa è
   * cambiato, perché è successo dall'altra parte del tabellone mentre lui
   * guardava altro.
   */
  decadiProposteImpossibili() {
    // Copia dell'elenco: rimuoviProposta lo modifica mentre lo si scorre.
    for (const trade of [...this.tradeOffers]) {
      const motivo = this.motivoDecadenza(trade);
      if (motivo) this.rimuoviProposta(trade, motivo);
    }
  },

  /**
   * Chi ha proposto ritira la sua offerta.
   *
   * Non esisteva prima, e prima non serviva: la proposta congelava la partita,
   * quindi l'altro doveva rispondere all'istante o nessuno giocava più. Adesso
   * che il tavolo va avanti, un'offerta può restare aperta quanto vuole chi
   * deve risponderle — e nel frattempo tiene congelata la merce di chi l'ha
   * fatta. Senza questa uscita, dimenticarsi di rispondere (o staccare il
   * telefono) diventerebbe un modo per bloccare le proprietà di un avversario a
   * tempo indeterminato. Ritirare è sempre lecito e non costa nulla: è la stessa
   * cosa che al tavolo vero si fa dicendo "lascia stare".
   */
  cancelTrade(playerId, tradeId) {
    const trade = this.findTradeOffer(tradeId);
    if (!trade) return { error: 'Nessuno scambio in sospeso' };
    if (trade.fromId !== playerId) return { error: 'Non è la tua proposta' };
    this.tradeOffers.splice(this.tradeOffers.indexOf(trade), 1);
    const from = this.players.find((p) => p.id === trade.fromId);
    const to = this.players.find((p) => p.id === trade.toId);
    this.addLog(`${from?.name} ritira la proposta fatta a ${to?.name}.`);
    return {};
  },

  /**
   * Il destinatario accetta o rifiuta UNA proposta precisa. In nessun caso il
   * turno cambia.
   *
   * `tradeId` è obbligatorio, e non è burocrazia: di proposte aperte verso lo
   * stesso giocatore adesso ce ne possono essere più d'una, e un "accetta" senza
   * indirizzo si prenderebbe quella sbagliata al primo doppio tocco — cioè
   * regalerebbe un monopolio a chi non c'entrava niente. Se l'id non esiste più
   * (già risposta, decaduta, ritirata) si risponde con la stessa frase che il
   * client sa già tacere come corsa innocua.
   */
  respondTrade(playerId, accept, tradeId) {
    const trade = this.findTradeOffer(tradeId);
    if (!trade) return { error: 'Nessuno scambio in sospeso' };
    if (trade.toId !== playerId) return { error: 'Non tocca a te rispondere' };
    // Le stesse due guardie di proposeTrade, e qui pesano di più: accettare
    // muove davvero proprietà e denaro. Il debito in particolare non è
    // negoziabile — se lo si permettesse, l'interesse su un'ipoteca ricevuta
    // potrebbe mandare in rosso un terzo giocatore mentre il debito di un altro
    // è già aperto, e settleNextDebt (che ne apre uno per volta, apposta) non
    // gli aprirebbe nessuna finestra: resterebbe a saldo negativo senza che il
    // motore gli chieda niente, cioè lo stato che l'invariante
    // 'saldo-negativo-solo-in-debito' esiste per vietare.
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();

    const from = this.players.find((p) => p.id === trade.fromId);
    const to = this.players.find((p) => p.id === trade.toId);

    if (!accept) {
      this.tradeOffers.splice(this.tradeOffers.indexOf(trade), 1);
      this.addLog(`${to.name} rifiuta lo scambio.`);
      return {};
    }

    // Rivalidazione al momento dell'accettazione. Prima era una precauzione
    // contro il poco che i due potevano combinarsi fra loro a tavolo fermo;
    // adesso è il controllo che tiene in piedi tutto l'impianto, perché fra la
    // proposta e la risposta la partita è andata avanti davvero. Una proposta
    // che non regge più non si limita a essere rifiutata: si toglie di mezzo,
    // altrimenti resterebbe lì a produrre lo stesso errore a ogni tentativo.
    const motivo = this.motivoDecadenza(trade);
    if (motivo) {
      this.rimuoviProposta(trade, motivo);
      return { error: `Lo scambio non è più valido: ${motivo}` };
    }

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
    this.tradeOffers.splice(this.tradeOffers.indexOf(trade), 1);

    // Proprietà, denaro e carte hanno appena cambiato mano: le ALTRE proposte
    // aperte su quella roba non stanno più in piedi. È il caso più frequente di
    // decadenza, ed è la conseguenza diretta di aver permesso che la stessa
    // casella sia chiesta da due persone insieme (vedi proposeTrade).
    this.decadiProposteImpossibili();

    // Chi riceve una proprietà ipotecata paga subito il 10% alla banca. Si fa
    // per ultimo perché l'interesse può aprire un debito, e un debito è una
    // finestra che ferma il tavolo: aprirla prima di aver finito di sistemare
    // lo scambio significherebbe lasciarla aperta su uno stato a metà.
    this.chargeMortgageInterest(to, trade.offerProperties);
    this.chargeMortgageInterest(from, trade.requestProperties);
    return {};
  },

  /** Interesse del 10% dovuto da chi riceve proprietà ipotecate in uno scambio. */
  chargeMortgageInterest(player, positions) {
    const due = positions.reduce(
      (sum, position) => sum + (this.ownership[position]?.mortgaged ? this.mortgageInterest(board[position]) : 0),
      0
    );
    if (due <= 0) return;
    this.addLog(`${player.name} paga ${due} di interessi sulle ipoteche ricevute.`);
    this.chargePlayer(player, due);
  },

};
