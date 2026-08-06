const { JAIL_POSITION, JAIL_FINE } = require('./constants');

module.exports = {
  sendToJail(player) {
    player.position = JAIL_POSITION;
    player.inJail = true;
    player.jailTurns = 0;
    this.addLog(`${player.name} viene mandato in prigione.`);
  },

  payJailFine(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.inJail) return { error: 'Non sei in prigione' };
    // La multa è una spesa che si sceglie di fare, esattamente come costruire o
    // riscattare un'ipoteca, e va congelata negli stessi due momenti in cui è
    // congelata quella (vedi buildHouse e unmortgageProperty). Era l'unica
    // uscita di denaro rimasta fuori, e bastava per arrivare al risultato che
    // il congelamento esiste per impedire: si offre all'asta tutto quello che
    // si ha, si paga la multa, e all'aggiudicazione il conto è scoperto —
    // closeAuction scala l'offerta senza ricontrollare la cassa, quindi si
    // finiva a saldo negativo senza nessun debito aperto a chiederne il
    // rientro.
    //
    // Qui c'era anche il congelamento da scambio, per la stessa ragione (la
    // multa poteva mangiare il denaro promesso in una proposta aperta) e non
    // c'è più: il denaro di chi tratta non si congela — sarebbe come impedirgli
    // di pagare un affitto — e una proposta che il proponente non può più
    // onorare decade da sé subito dopo l'addebito, con tanto di riga nel
    // registro (vedi chargePlayer e decadiProposteImpossibili). Il destinatario
    // non se la ritrova mai irricevibile fra le mani, che era il vero guaio.
    if (this.auctionFreezeBlocker()) return this.auctionFreezeBlocker();
    if (player.balance < JAIL_FINE) return { error: 'Saldo insufficiente' };
    // Passa da chargePlayer (creditore nullo) così la multa finisce anche lei
    // nel montepremi della Sosta Gratuita, come quella pagata dopo 3 tentativi.
    this.chargePlayer(player, JAIL_FINE);
    player.inJail = false;
    player.jailTurns = 0;
    this.addLog(`${player.name} paga ${JAIL_FINE} per uscire di prigione.`);
    return {};
  },

  useJailCard(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.inJail) return { error: 'Non sei in prigione' };
    if (player.jailCards < 1) return { error: 'Non hai carte "esci di prigione"' };
    player.jailCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    this.addLog(`${player.name} usa una carta "esci di prigione gratis".`);
    // Le carte uscita si possono promettere in uno scambio, e come il denaro non
    // si congelano: restare in prigione per non poter usare la propria carta
    // sarebbe un prezzo assurdo da pagare per aver fatto un'offerta. Se la carta
    // promessa era questa, la proposta decade.
    this.decadiProposteImpossibili();
    return {};
  },

};
