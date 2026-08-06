const { SKIP_TURN_DELAY_MS } = require('./constants');

module.exports = {
  /**
   * Risolve la finestra aperta a nome di un giocatore disconnesso, scegliendo
   * ogni volta l'opzione che NON prende iniziative al posto suo: legge la
   * carta, paga quello che deve (in quelle finestre l'unico bottone è
   * "paga"), rinuncia all'acquisto, passa all'asta, e su
   * un debito liquida invece di arrendersi. Nessuna di queste è una scelta
   * discrezionale: sono la mossa più conservativa disponibile in quella
   * finestra, quella che non gli fa spendere né promettere nulla di nuovo.
   *
   * Perché non basta azzerare `pendingAction` come fa abandonGame: lì il
   * giocatore esce dalla partita e le sue proprietà tornano libere, quindi non
   * c'è più niente da regolare. Qui invece resta al tavolo, e cancellare la
   * finestra e basta gli regalerebbe quello che doveva — un affitto salato
   * sparirebbe dalle tasche del padrone di casa. Peggio: diventerebbe una
   * scorciatoia da usare apposta, spegnere il telefono appena si atterra su
   * Parco della Vittoria con gli hotel e farsi saltare il turno.
   *
   * Si chiama in ciclo (vedi skipDisconnectedTurn) perché una finestra può
   * aprirne un'altra sempre intestata a lui: la carta lo muove su una casella
   * da comprare, l'affitto che non riesce a pagare apre un debito, la rinuncia
   * all'acquisto apre l'asta in cui è lui il primo a dover parlare.
   */
  resolveWindowFor(player) {
    switch (this.pendingAction?.type) {
      case 'awaiting_card': return this.acknowledgeCard(player.id);
      case 'awaiting_rent': return this.payRent(player.id);
      case 'awaiting_tax': return this.payTax(player.id);
      case 'awaiting_buy': return this.declineBuy(player.id);
      case 'awaiting_auction': return this.passAuction(player.id);
      // Nessun caso per gli scambi, e non è una dimenticanza: una proposta non
      // ferma più il tavolo, quindi saltare il turno di chi è caduto non ha
      // alcun bisogno di rispondere al posto suo. Le proposte che ha ricevuto
      // restano lì ad aspettarlo, esattamente come le sue proprietà: rientrando
      // le trova. E chi gliele aveva fatte non è in ostaggio, perché può
      // ritirarle quando vuole (vedi cancelTrade).
      // Liquidazione automatica, mai bancarotta: il motore vende gli edifici e
      // ipoteca tenendo i monopoli per ultimi, ed è esattamente il bottone che
      // il client offre al giocatore in quella finestra. Non può finire in
      // bancarotta chi avrebbe potuto pagare: se il patrimonio non bastasse,
      // chargePlayer lo avrebbe già fatto fallire prima ancora di aprire il
      // debito (vedi la guardia su liquidationValue).
      case 'awaiting_debt': return this.resolveDebtAuto(player.id);
      // Nessun altro tipo esiste oggi; se un domani ne comparisse uno nuovo,
      // chiuderlo è comunque meglio che lasciare la partita congelata.
      default:
        this.pendingAction = null;
        return {};
    }
  },

  /**
   * Fa proseguire la partita quando chi ha il turno è caduto e non torna.
   *
   * Il problema che risolve: finché il giocatore di turno è offline nessuno
   * può fare niente: non tira lui, non tira nessun altro, e se ha una finestra
   * aperta a suo nome (`pendingAction.playerId`) quella congela il tavolo per
   * tutti. Prima l'unica uscita era che l'host chiudesse il tavolo — e una
   * partita chiusa così non finisce nemmeno nel tabellino. Chi è caduto non
   * poteva rimediare da sé: per abbandonare servirebbe il suo telefono, che è
   * appunto morto.
   *
   * Non è un'espulsione e non toglie niente a nessuno: il giocatore resta al
   * tavolo con le sue proprietà, il suo denaro, le sue carte uscita e la sua
   * posizione, e riprende a giocare appena rientra. Salta soltanto questo giro
   * — nemmeno i tentativi di uscita di prigione gli vengono consumati.
   *
   * Chi può chiederlo: QUALUNQUE altro giocatore ancora in partita, non solo
   * l'host. Riservarlo all'host sarebbe stato più stretto ma anche inutile
   * proprio nel caso peggiore: se a cadere è l'host, l'unico che potrebbe
   * sbloccare il tavolo è lui, cioè nessuno, e si torna esattamente al blocco
   * di prima. Non c'è nemmeno un abuso da temere: la mossa è possibile solo
   * contro chi è davvero offline, non gli sottrae nulla, ed è tracciata nel
   * registro col nome di chi l'ha chiesta. Che un bot non possa chiederla da
   * sé è garantito dal fatto che questa è una mossa che arriva da un socket
   * (vedi `skip_turn` in server.js, che lo ricontrolla comunque): bot.js non
   * la genera e i bot non hanno un socket da cui mandarla.
   *
   * `fermoDaMs` è da quanto la partita è ferma su di lui, misurato da chi ha
   * un orologio (vedi stalledTurnMs in rooms.js): il motore resta puro e
   * sincrono, qui si limita a confrontarlo con SKIP_TURN_DELAY_MS.
   */
  skipDisconnectedTurn(requesterId, { fermoDaMs = 0 } = {}) {
    if (!this.started) return { error: 'La partita non è ancora iniziata' };
    if (this.finished) return { error: 'La partita è finita' };
    const fermo = this.currentPlayer;
    if (!fermo) return { error: 'Nessun turno in corso' };

    const richiedente = this.players.find((p) => p.id === requesterId);
    if (!richiedente) return { error: 'Non sei a questo tavolo' };
    if (richiedente.id === fermo.id) return { error: 'È il tuo turno' };
    if (richiedente.bankrupt) return { error: 'Sei fuori dalla partita' };
    // Chi chiede sta per definizione giocando, quindi è collegato: se la mappa
    // dei socket dicesse il contrario, server.js l'ha già rimessa in pari
    // (ensureConnected) prima di arrivare qui. Il controllo resta come rete di
    // sicurezza — un tavolo dove decide chi non c'è non ha senso.
    if (richiedente.connected === false) return { error: 'Non risulti collegato' };

    // Le due condizioni che rendono lecito il salto. Sono la ragione per cui
    // questo comando non è un modo per liberarsi di un avversario scomodo:
    // contro chi è collegato non funziona mai, e contro chi è appena caduto
    // nemmeno.
    if (fermo.connected !== false) {
      return { error: `${fermo.name} è collegato: tocca a lui` };
    }
    if (fermoDaMs < SKIP_TURN_DELAY_MS) {
      const mancano = Math.ceil((SKIP_TURN_DELAY_MS - fermoDaMs) / 1000);
      return { error: `Aspetta ancora ${mancano}s: ${fermo.name} potrebbe rientrare` };
    }

    // Una finestra intestata a QUALCUN ALTRO non si tocca: quel qualcuno è
    // collegato (se non lo fosse, saremmo in un blocco diverso da questo, che
    // non è quello che questo comando sa risolvere) e può ancora rispondere,
    // quindi la partita non è ferma per colpa del disconnesso. Saltare il
    // turno lasciandogli aperta la finestra sposterebbe la mano lasciando il
    // tavolo congelato lo stesso.
    if (this.pendingAction && this.pendingAction.playerId !== fermo.id) {
      const atteso = this.players.find((p) => p.id === this.pendingAction.playerId);
      return { error: `Prima ${atteso ? atteso.name : 'qualcun altro'} deve rispondere` };
    }

    this.addLog(`${richiedente.name} salta il turno di ${fermo.name}, disconnesso: resta al tavolo con tutto il suo.`);

    // Il ciclo si ferma da sé: ogni giro chiude la finestra corrente, e le
    // catene sono corte (carta -> acquisto -> asta). Il contatore è solo una
    // rete di sicurezza contro un tipo di finestra che un domani non si
    // chiudesse: meglio uscire lasciando lo stato com'è che girare a vuoto.
    let giri = 0;
    while (this.pendingAction?.playerId === fermo.id && !this.finished && giri < 20) {
      giri += 1;
      this.resolveWindowFor(fermo);
    }

    // Il turno può essersi già spostato da solo mentre si chiudevano le
    // finestre: pagare un affitto o leggere una carta chiama finishRoll, che
    // di norma chiude il turno. Si sposta a mano solo se è ancora suo — e come
    // in abandonGame si usa advanceTurn e non endTurn: chi è caduto senza aver
    // ancora tirato lascia `turnResolved` alzato dal turno precedente, ed
    // endTurn si fermerebbe proprio lì, lasciando la partita bloccata sullo
    // stesso giocatore che stiamo cercando di saltare.
    //
    // Se invece è rimasta aperta una finestra di un ALTRO (l'asta che va
    // avanti fra i rimanenti, il debito che una carta ha aperto a un terzo) il
    // turno non si tocca: la partita adesso può muoversi, e a chiuderlo sarà
    // chi risolve quella finestra (closeAuction e checkDebtResolved chiamano
    // finishRoll per conto di chi aveva iniziato il giro).
    if (!this.finished && !this.pendingAction && this.currentPlayer?.id === fermo.id) {
      this.advanceTurn();
    }
    return {};
  },

};
