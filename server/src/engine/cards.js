const { board } = require('../data/board');

module.exports = {
  /**
   * Pesca una carta e la mette in attesa di lettura **senza applicarla**. Prima
   * l'effetto scattava subito: il giocatore vedeva la pedina saltare o il saldo
   * cambiare senza sapere perché, e sembrava un secondo tiro impazzito.
   */
  drawCard(player, deckType) {
    const deck = deckType === 'chance' ? this.chanceDeck : this.communityDeck;
    const card = deck.shift();
    deck.push(card);
    this.addLog(`${player.name} pesca: "${card.text}"`);
    this.pendingCard = card;
    this.pendingAction = {
      type: 'awaiting_card',
      playerId: player.id,
      deck: deckType,
      text: card.text,
    };
  },

  /** Il giocatore ha letto la carta: ora l'effetto si applica. */
  acknowledgeCard(playerId) {
    if (this.pendingAction?.type !== 'awaiting_card') return { error: 'Nessuna carta da leggere' };
    if (this.pendingAction.playerId !== playerId) return { error: 'Non è la tua carta' };

    const card = this.pendingCard;
    const player = this.players.find((p) => p.id === playerId);
    this.pendingAction = null;
    this.pendingCard = null;
    if (card && player) this.applyCard(player, card);

    // La carta può aver aperto un'altra cosa da risolvere: un acquisto, un
    // debito, o perfino un'altra carta (con "vai indietro di 3" si può finire
    // su Probabilità). In quel caso il turno resta in attesa.
    if (!this.pendingAction) this.finishRoll(this.currentPlayer);
    return {};
  },

  applyCard(player, card) {
    switch (card.action) {
      case 'collect':
        player.balance += card.amount;
        break;
      case 'pay':
        this.chargePlayer(player, card.amount);
        break;
      case 'pay_each_player':
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          // Chi è già fallito non paga più nessuno. La lista dei destinatari si
          // calcola una volta sola, ma la bancarotta può scattare a metà giro:
          // senza questo controllo si continuava a addebitare a un giocatore
          // già in bancarotta, e siccome bankruptPlayer la seconda volta esce
          // subito, il suo saldo restava in rosso invece di tornare a zero
          // (l'invariante `fallito-e-a-zero` è precisamente questo) e chi
          // veniva dopo incassava denaro mai esistito: chargePlayer accredita
          // comunque l'intero importo, e la restituzione della differenza non
          // coperta sta dentro la bancarotta, che non veniva più eseguita.
          // Fermarsi qui è anche la cosa giusta secondo il modello del motore,
          // dove tutto quel che resta va al creditore che ha fatto scattare la
          // bancarotta: chi non è stato ancora pagato non ha più niente da
          // riscuotere, perché non c'è più niente.
          if (player.bankrupt) return;
          this.chargePlayer(player, card.amount, p);
        });
        break;
      case 'collect_from_each_player':
        // Qui il debitore può essere l'avversario, non chi sta giocando: il
        // pendingAction del debito blocca comunque la partita per entrambi.
        this.players.filter((p) => p.id !== player.id && !p.bankrupt).forEach((p) => {
          this.chargePlayer(p, card.amount, player);
        });
        break;
      case 'advance_to':
        // Sempre in avanti, incassando il Via se lo si supera.
        this.movePlayerTo(player, card.target);
        break;
      case 'move_back': {
        // L'unico movimento a ritroso: non si passa dal Via, quindi non si
        // incassa, e movePlayer non va usata.
        player.position = (player.position - card.spaces + 40) % 40;
        this.addLog(`${player.name} torna indietro fino a ${board[player.position].name}.`);
        this.resolveLanding(player);
        break;
      }
      case 'advance_to_nearest_station': {
        const stations = board.filter((s) => s.type === 'station').map((s) => s.position);
        const next = stations.find((pos) => pos > player.position) ?? stations[0];
        // Alcune di queste carte fanno pagare l'affitto raddoppiato: il
        // moltiplicatore vale per il solo atterraggio che segue.
        this.rentMultiplier = card.rentMultiplier || 1;
        this.movePlayerTo(player, next);
        this.rentMultiplier = 1;
        break;
      }
      case 'get_out_of_jail':
        player.jailCards += 1;
        break;
      case 'go_to_jail':
        this.sendToJail(player);
        break;
      case 'repairs': {
        // Ogni hotel conta per intero, non solo il primo: con più livelli
        // costruiti la riparazione costa di più, coerente con "tot a hotel"
        // della carta. A un solo livello (modalità spenta) è lo stesso conto
        // di sempre: owned.hotels vale al più 1.
        const total = this.propertiesOf(player.id).reduce(
          (sum, { owned }) => sum + owned.houses * card.perHouse + owned.hotels * card.perHotel,
          0
        );
        if (total > 0) this.addLog(`${player.name} paga ${total} di riparazioni.`);
        this.chargePlayer(player, total);
        break;
      }
    }
  },

};
