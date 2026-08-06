module.exports = {
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
    // Qui passa ogni uscita di denaro del gioco, ed è quindi il punto naturale
    // in cui accorgersi che una proposta aperta prometteva contanti che adesso
    // non ci sono più. Il denaro di chi tratta non si congela apposta (vedi
    // tradeGoodsBlocker): deve poter pagare l'affitto anche mentre l'altro
    // decide. Il prezzo di quella scelta è che la proposta può diventare
    // irricevibile, e si paga qui, togliendola subito invece di lasciarla lì a
    // far sbagliare chi preme Accetta.
    this.decadiProposteImpossibili();
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
  },

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

    // Chi apre un debito esce da qualunque trattativa, subito e da entrambi i
    // lati. Non è una punizione, è ciò che tiene in piedi il congelamento della
    // merce: per rientrare deve poter ipotecare, e la merce impegnata in una
    // proposta non si può ipotecare. Un debitore che avesse promesso l'unica
    // casella ipotecabile che gli resta si troverebbe con un debito che non può
    // saldare e nessuna via d'uscita — chargePlayer lo ha lasciato in vita
    // proprio perché quella casella, contandola, bastava. Sarebbe una partita
    // ferma per tutti, cioè il difetto da cui siamo partiti, tornato da
    // un'altra porta.
    for (const t of this.tradeOffersOf(debitore.id)) {
      this.rimuoviProposta(t, `${debitore.name} deve prima coprire un debito`);
    }
  },

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
  },

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
  },

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
  },

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
        owned.hotels = 0;
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
    // Stessa ragione per le proposte di scambio, da qualunque lato le si
    // guardi. Se esce chi ha proposto, la proposta non sta più in piedi: le
    // proprietà offerte non sono più sue e accettarla restituisce solo un
    // errore, che l'altro non può risolvere in alcun modo — l'unica uscita
    // sarebbe indovinare che va rifiutata. Se esce il destinatario, non c'è
    // più nessuno che possa rispondere. In entrambi i casi vanno chiuse qui:
    // questo è il punto da cui si passa comunque, sia per abbandono sia per
    // bancarotta.
    //
    // Il ciclo al posto del vecchio controllo su una proposta sola: adesso ce
    // ne possono essere parecchie aperte insieme, e chi esce può comparire in
    // più d'una — una fatta da lui e tre ricevute, per dire. Lasciarne indietro
    // anche una vorrebbe dire lasciare in giro merce congelata a nome di un
    // giocatore che non c'è più, senza più nessuno che possa sbloccarla.
    for (const t of this.tradeOffers.filter((o) => o.fromId === player.id || o.toId === player.id)) {
      this.rimuoviProposta(t, `${player.name} non è più in partita`);
    }
    this.checkWinner(motivo);

    // Il turno si chiude solo se a uscire è stato chi stava giocando. Quando a
    // fallire è un altro (carta "incassa da ogni giocatore") il turno in corso
    // prosegue, e a chiuderlo sarà chi lo ha iniziato.
    if (!this.finished && this.currentPlayer?.bankrupt) this.finishRoll(this.currentPlayer);
  },

};
