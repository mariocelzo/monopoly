import type { GameState } from './socket';

/**
 * Perché in questo momento non si può mandare una proposta di scambio, o `null`
 * se si può.
 *
 * PERCHÉ ESISTE UN FILE APPOSTA. Fino a ieri la domanda aveva una risposta di
 * quattro caratteri — `!!state.pendingAction` — ed era scritta a mano in quattro
 * punti (TradeModal, TradeWizard, MobileBar, GamePanel). Adesso la regola del
 * motore è più fine: fermano solo il debito e l'asta, cioè le due finestre in
 * cui la spesa è congelata per tutti, mentre un acquisto o un affitto altrui
 * non fermano niente (vedi proposeTrade in gameEngine.js). Una regola con tre
 * rami, ricopiata in quattro posti, diverge al primo ritocco: è già successo
 * due volte su questo progetto con il rilancio minimo dell'asta, prima nei bot
 * e poi nel client, e in entrambi i casi il risultato era un bottone che
 * sembrava rotto.
 *
 * Qui NON si decide niente: il motore resta l'unico giudice e rifiuta comunque.
 * Questo serve solo a spegnere il comando prima e a dire perché — la differenza
 * fra un bottone spento che si spiega e uno che non fa niente.
 *
 * Il file è puro di proposito (nessun socket, nessun `window`), come azioni.ts:
 * così la regola si verifica in logic-test.ts sotto Node.
 */
export function motivoScambioBloccato(state: GameState, myId: string): string | null {
  if (!state.started) return 'La partita non è ancora iniziata.';
  if (state.finished) return 'La partita è finita.';

  const tipo = state.pendingAction?.type;
  // Le due finestre che congelano la spesa di tutto il tavolo, e solo quelle:
  // durante un'asta il denaro di chi rilancia deve restare certo, e con un
  // debito aperto il motore sta facendo i conti in tasca a qualcuno.
  if (tipo === 'awaiting_debt') return 'C\'è un debito da coprire: si riprende appena è saldato.';
  if (tipo === 'awaiting_auction') return 'C\'è un\'asta in corso: si riprende appena si chiude.';

  // Una proposta per volta, per chi la fa: è la regola del motore (vedi
  // proposeTrade) e la ragione è che ciò che si promette resta congelato.
  if (state.tradeOffers?.some((t) => t.fromId === myId)) {
    return 'Hai già una proposta aperta: aspetta la risposta o ritirala.';
  }
  return null;
}
