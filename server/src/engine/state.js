// Query sullo stato "il tavolo è fermo per qualcosa": usate da quasi ogni
// altro modulo (turno, costruzioni, scambi, aste) per sapere se è il momento
// di agire. Spostate qui senza modifiche, stesso this.pendingAction di sempre.
module.exports = {
  hasPendingDebt() {
    return this.pendingAction?.type === 'awaiting_debt';
  },

  hasPendingCard() {
    return this.pendingAction?.type === 'awaiting_card';
  },

  hasPendingRent() {
    return this.pendingAction?.type === 'awaiting_rent';
  },

  hasPendingTax() {
    return this.pendingAction?.type === 'awaiting_tax';
  },

  hasPendingAuction() {
    return this.pendingAction?.type === 'awaiting_auction';
  },

  hasPendingBuy() {
    return this.pendingAction?.type === 'awaiting_buy';
  },

  /**
   * Con un'asta in corso il denaro di chi ci partecipa deve restare certo:
   * costruire o riscattare un'ipoteca a metà asta potrebbe rendere
   * inaffrontabile un'offerta già fatta, e il conto tornerebbe scoperto solo
   * all'aggiudicazione. Si congela la spesa libera per tutti finché non si
   * chiude, come già succede per lo scambio.
   */
  auctionFreezeBlocker() {
    return this.hasPendingAuction() ? { error: 'Prima risolvi l\'asta in corso' } : null;
  },

};
