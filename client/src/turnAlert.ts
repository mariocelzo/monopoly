import type { GameState } from './socket';

/**
 * Vero quando il gioco sta aspettando proprio una decisione di questo
 * giocatore — non solo "è il suo turno di tirare", ma anche ogni caso in cui
 * un `pendingAction` lo nomina esplicitamente: un affitto da pagare, una
 * carta da leggere, un debito da sanare, uno scambio da accettare o
 * rifiutare, un'asta in cui tocca a lui rilanciare. Ogni variante di
 * `PendingAction` porta un `playerId` — chi deve agire ora — quindi basta un
 * unico confronto invece di uno switch sul `type`: è la stessa domanda in
 * tutti i casi.
 *
 * Separata dall'hook che la usa (in `useTurnAttention.ts`) apposta: questa
 * funzione non tocca `window`/`document`, quindi resta testabile sotto Node
 * in `logic-test.ts`, dove il DOM non esiste.
 */
export function isGameWaitingFor(state: GameState, myId: string | null): boolean {
  if (!myId || !state.started || state.finished) return false;

  if (state.pendingAction) {
    return state.pendingAction.playerId === myId;
  }

  // Nessuna azione in sospeso: si aspetta solo chi ha il turno di tirare/giocare.
  const current = state.players[state.turnIndex];
  return current?.id === myId;
}
