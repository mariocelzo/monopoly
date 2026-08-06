const { board, STATION_RENT, UTILITY_MULTIPLIER } = require('../data/board');
const { MAX_JAIL_TURNS, JAIL_FINE, MAX_DOUBLES } = require('./constants');

// Il ciclo di un turno: tirare, muoversi, atterrare, pagare tasse e affitti,
// chiudere il turno o passarlo avanti. finishRoll è il fulcro a cui tutto il
// resto del motore torna dopo aver risolto una finestra (acquisto, carta,
// debito, asta...), quindi vive qui insieme al resto del flusso di turno.
module.exports = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  /**
   * Il giocatore conferma il pagamento dell'affitto. Prima veniva addebitato da
   * solo: il denaro spariva senza che nessuno lo vedesse, e sembrava che non si
   * pagasse affatto.
   */
  payRent(playerId) {
    if (this.pendingAction?.type !== 'awaiting_rent') return { error: 'Nessun affitto da pagare' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };

    const { amount, position } = this.pendingAction;
    const player = this.players.find((p) => p.id === playerId);

    // Il padrone di casa si ricontrolla ADESSO, non si prende quello
    // congelato nella finestra quando è stata aperta. Fra i due momenti passa
    // tempo reale, e in mezzo la casella può aver cambiato padrone o non
    // averne più uno: chi la possedeva può aver abbandonato il tavolo (le sue
    // proprietà tornano libere), essere fallito verso un terzo (passano al
    // creditore), o averla ipotecata — e una proprietà ipotecata non incassa
    // affitto. Senza questo controllo l'affitto veniva pagato comunque a chi
    // se n'era andato: denaro tolto a chi paga per una casella di nessuno, e
    // accreditato a un giocatore in bancarotta, che per invariante deve stare
    // a saldo zero (il patrimonio e il tabellino leggono quei saldi).
    const owned = this.ownership[position];
    const owner = owned ? this.players.find((p) => p.id === owned.ownerId) : null;
    const daNessuno = !owned || !owner || owner.bankrupt;
    if (daNessuno || owned.mortgaged || owner.id === playerId) {
      this.pendingAction = null;
      const perche = daNessuno
        ? 'non è più di nessuno'
        : owned.mortgaged
          ? 'è stata ipotecata nel frattempo'
          : 'è passata a lui nel frattempo';
      this.addLog(`${board[position].name} ${perche}: ${player.name} non paga l'affitto.`);
      this.finishRoll(this.currentPlayer);
      return {};
    }

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
  },

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
    if (owned.hotels > 0) return this.hotelRent(square, owned.hotels);
    if (owned.houses > 0) return square.rents[owned.houses];
    if (this.ownsFullGroup(owned.ownerId, square.group)) return square.rents[0] * 2;
    return square.rents[0];
  },

  /**
   * Sposta il turno al prossimo giocatore ancora in gioco, senza le guardie di
   * endTurn. Serve ai casi in cui il turno DEVE avanzare perché chi lo teneva è
   * uscito dal tavolo: endTurn è la porta per il giocatore che chiude il turno
   * di sua volontà, e le sue guardie (`turnResolved`, finestre aperte) lì sono
   * giuste, ma su un giocatore che non c'è più bloccherebbero la partita per
   * tutti gli altri.
   */
  advanceTurn() {
    // Il tiro appena chiuso non è più quello in corso: se restasse, il
    // tabellone mostrerebbe nome e somma di chi ha già passato la mano.
    this.lastRoll = null;
    if (this.players.every((p) => p.bankrupt)) return;
    do {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
    } while (this.currentPlayer.bankrupt);
    this.addLog(`Turno di ${this.currentPlayer.name}.`);
  },

  /**
   * Rete di sicurezza per il turno rimasto intestato a chi ha lasciato il
   * tavolo. Con una finestra aperta abandonGame non può spostarlo subito: la
   * partita è comunque congelata lì, e spostarlo in anticipo farebbe saltare il
   * turno a qualcuno, perché alla chiusura della finestra la risoluzione
   * riprende da sé e lo sposterebbe una seconda volta. Lo lascia quindi
   * formalmente a chi è uscito e conta su chi chiude la finestra per rimetterlo
   * in moto. Funziona da sé per le finestre che nascono dentro la risoluzione
   * di un tiro — acquisto, carta, affitto, tassa, asta: le chiude tutte un
   * finishRoll che passa da endTurn, e lì `turnResolved` è per forza false (a
   * turno già chiuso quelle finestre non esistono nemmeno). Non funziona per
   * l'unica finestra rimasta che può riguardare un giocatore DIVERSO da chi ha
   * il turno: il debito di un altro aperto fuori da un tiro (l'interesse su
   * un'ipoteca ricevuta in uno scambio, o il rosso ereditato da una bancarotta
   * che settleNextDebt apre più tardi — anche quello dentro abandonGame
   * stesso). Lì finishRoll ci arriva, ma endTurn si ferma sulla guardia
   * `turnResolved`, già alzata dalla chiusura del turno precedente quando chi
   * ha abbandonato non aveva ancora tirato.
   *
   * Le finestre erano due: c'era anche lo scambio, che non toccava mai il turno
   * e quindi, chiudendosi, non lasciava nessuno a spostarlo. Non è più un caso
   * da coprire perché una proposta non è più una finestra: non ferma il tavolo,
   * quindi non c'è nessun turno appeso alla sua chiusura. È una delle cose che
   * questa modifica semplifica invece di complicare.
   *
   * Il guaio che resta da evitare è sempre lo stesso: turno su un giocatore in
   * bancarotta e nessuna finestra aperta, cioè nessuno che possa più muovere e
   * partita bloccata per sempre. Va chiamata dove una finestra si chiude senza
   * che il turno passi da un endTurn andato a buon fine.
   */
  resumeTurnIfHolderLeft() {
    // Con una finestra ancora aperta non si tocca nulla: a rimettere in moto il
    // turno sarà chi chiude QUELLA, con questa stessa rete di sicurezza.
    if (this.finished || this.pendingAction) return;
    if (this.currentPlayer?.bankrupt) this.advanceTurn();
  },

  endTurn() {
    // Un debito aperto congela la partita finché non rientra.
    //
    // Qui c'era anche la guardia sullo scambio, ed è sparita insieme a tutta la
    // famiglia: una proposta non è più un pendingAction, quindi non ha più
    // niente da dire sul turno di nessuno. È il senso di tutta questa modifica —
    // chiudere il proprio turno mentre due altri stanno trattando adesso si può,
    // perché non c'è nessun motivo per cui non si dovrebbe potere.
    if (this.hasPendingDebt()) return { error: 'Prima risolvi il debito in sospeso' };
    if (this.hasPendingCard()) return { error: 'Prima leggi la carta pescata' };
    if (this.hasPendingRent()) return { error: 'Prima paga l\'affitto' };
    if (this.hasPendingTax()) return { error: 'Prima paga la tassa' };
    // E la proposta d'acquisto come tutte le altre. Era l'unica finestra che
    // endTurn non guardava, e da lì passava una mossa che nel Monopoli non
    // esiste: col riquadro "proprietà libera" aperto, premere "Fine" chiudeva
    // il turno, faceva sparire la proposta (endTurn azzera pendingAction) e
    // saltava l'asta che la rinuncia avrebbe aperto. Chi lo faceva non subiva
    // nemmeno la conseguenza normale del rifiuto: la casella restava libera
    // per il proprio giro dopo, invece di finire all'asta dove chiunque
    // avrebbe potuto prendersela. Sulla casella si decide, non si sfila. Sta
    // prima dell'asta perché viene prima anche nel gioco: l'asta è la
    // conseguenza della rinuncia, non un'alternativa alla decisione.
    if (this.hasPendingBuy()) return { error: 'Prima decidi se comprare la proprietà' };
    // Anche l'asta congela il turno: si è aperta a metà della risoluzione del
    // tiro (vedi declineBuy) e deve chiudersi da sé (closeAuction) prima che
    // il turno possa avanzare, tiro extra da doppio compreso.
    if (this.hasPendingAuction()) return { error: 'Prima risolvi l\'asta in corso' };
    if (this.finished) return {};
    // Il turno può essere chiuso una sola volta per tiro: una bancarotta lo
    // chiude già da dentro resolveLanding, e rollDice non deve rifarlo. L'unica
    // eccezione è il turno di chi non c'è più: se chi lo teneva ha lasciato il
    // tavolo va spostato comunque, altrimenti nessuno potrebbe più muovere
    // (vedi resumeTurnIfHolderLeft).
    if (this.turnResolved) {
      this.resumeTurnIfHolderLeft();
      return {};
    }
    this.turnResolved = true;
    this.pendingAction = null;
    // I doppi contano solo entro il turno di chi li ha tirati.
    if (this.currentPlayer) this.currentPlayer.doublesInARow = 0;
    // Lo spostamento vero (e l'azzeramento di `lastRoll`, per non mostrare il
    // tiro di chi ha già finito) sta in advanceTurn: col doppio `finishRoll`
    // non arriva fin qui, quindi la scritta resta finché non si tira di nuovo.
    this.advanceTurn();
    return {};
  },

};
