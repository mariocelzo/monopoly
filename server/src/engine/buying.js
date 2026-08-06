const { board } = require('../data/board');

module.exports = {
  buyProperty(playerId) {
    if (!this.pendingAction || this.pendingAction.type !== 'awaiting_buy') return { error: 'Nessun acquisto in sospeso' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non tocca a te' };
    const { position, price } = this.pendingAction;
    const player = this.players.find((p) => p.id === playerId);
    if (player.balance < price) return { error: 'Saldo insufficiente' };
    player.balance -= price;
    this.ownership[position] = { ownerId: playerId, houses: 0, hotels: 0, mortgaged: false };
    this.addLog(`${player.name} compra ${board[position].name} per ${price}.`);
    this.bumpStat(this.stats.purchases, playerId);
    // Comprare è una delle poche uscite di denaro che non passano da
    // chargePlayer (qui il conto lo si è già verificato sopra): la decadenza
    // delle proposte va quindi richiamata a mano, altrimenti una proposta che
    // prometteva contanti appena spesi in una casella resterebbe accettabile a
    // schermo e rifiutata dal motore.
    this.decadiProposteImpossibili();
    this.pendingAction = null;
    this.finishRoll(player);
    return {};
  },

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
  },

};
