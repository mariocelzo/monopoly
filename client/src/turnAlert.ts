import type { GameState } from './socket';

/**
 * Vero quando il gioco sta aspettando proprio una decisione di questo
 * giocatore — non solo "è il suo turno di tirare", ma anche ogni caso in cui
 * un `pendingAction` lo nomina esplicitamente: un affitto da pagare, una
 * carta da leggere, un debito da sanare, un'asta in cui tocca a lui
 * rilanciare. Ogni variante di `PendingAction` porta un `playerId` — chi deve
 * agire ora — quindi basta un unico confronto invece di uno switch sul `type`:
 * è la stessa domanda in tutti i casi.
 *
 * Le proposte di scambio si guardano a parte da quando non sono più un
 * pendingAction, e continuano a contare: che non fermino il tavolo non vuol
 * dire che non aspettino una risposta. Anzi, adesso conta di più — prima la
 * partita ferma si notava da sé, ora il gioco prosegue e una proposta a cui
 * nessuno risponde passerebbe inosservata mentre dall'altra parte c'è chi
 * aspetta con la merce bloccata. Si guarda solo il lato del destinatario: chi
 * ha proposto non deve fare niente, deve solo attendere.
 *
 * Separata dall'hook che la usa (in `useTurnAttention.ts`) apposta: questa
 * funzione non tocca `window`/`document`, quindi resta testabile sotto Node
 * in `logic-test.ts`, dove il DOM non esiste.
 */
export function isGameWaitingFor(state: GameState, myId: string | null): boolean {
  if (!myId || !state.started || state.finished) return false;

  if (state.tradeOffers?.some((t) => t.toId === myId)) return true;

  if (state.pendingAction) {
    return state.pendingAction.playerId === myId;
  }

  // Nessuna azione in sospeso: si aspetta solo chi ha il turno di tirare/giocare.
  const current = state.players[state.turnIndex];
  return current?.id === myId;
}
