import type { GameState, Player } from './socket';

/**
 * Quando mostrare (e quando no) il comando che salta il turno di un giocatore
 * disconnesso, e cosa scriverci sopra.
 *
 * Sta in un modulo suo, senza React né socket, per due motivi. Il primo è che
 * così si prova sotto Node in logic-test.ts, senza montare niente. Il secondo
 * è che le condizioni sono più di quante sembri, e sbagliarne una si vede solo
 * in partita: un comando che compare quando non serve è rumore, uno che
 * compare quando il server lo rifiuterebbe è un bottone che non fa niente —
 * il difetto peggiore che questo progetto abbia già avuto (vedi il rilancio
 * d'asta sotto il minimo in AuctionModal.tsx).
 *
 * La verità resta comunque del server: skipDisconnectedTurn ricontrolla tutto
 * daccapo, orologio compreso. Questo modulo decide solo cosa vale la pena
 * mostrare.
 */
export interface SkipTurnPrompt {
  /** Il giocatore fermo, per poterne dire il nome. */
  player: Player;
  /** Falso finché l'attesa non è scaduta: si mostra l'avviso, non il bottone. */
  ready: boolean;
  /** Secondi che mancano, arrotondati per eccesso. Zero quando `ready`. */
  secondsLeft: number;
}

/**
 * `attesaRimanenteMs` è quanto manca ADESSO, cioè quello che arriva dal server
 * (`state.turnoBloccato`) meno il tempo passato da quando è arrivato: il conto
 * alla rovescia lo fa il componente, qui si legge solo il risultato. Vedi
 * BlockedTurn in socket.ts per il perché sia una durata e non una scadenza.
 */
export function skipTurnPrompt(
  state: GameState,
  myId: string,
  attesaRimanenteMs: number
): SkipTurnPrompt | null {
  if (!state.started || state.finished) return null;

  const bloccato = state.turnoBloccato;
  if (!bloccato) return null;

  // Chi ha il turno adesso, secondo lo stato appena arrivato. Se non coincide
  // con quello segnalato dal server, lo stato è più fresco della segnalazione
  // (il turno è già passato ad altri): non si mostra nulla.
  const fermo = state.players[state.turnIndex];
  if (!fermo || fermo.id !== bloccato.playerId) return null;
  // Rientrato nel frattempo, o uscito di partita: in nessuno dei due casi c'è
  // un turno da saltare.
  if (fermo.connected || fermo.bankrupt) return null;
  // A sé stessi non si salta il turno: c'è "Fine turno". E comunque uno che
  // sta guardando questa schermata è collegato, quindi non sarebbe lui.
  if (fermo.id === myId) return null;

  // Chi guarda dev'essere un giocatore di questo tavolo ancora in partita: chi
  // è fallito resta a guardare, non decide più.
  const io = state.players.find((p) => p.id === myId);
  if (!io || io.bankrupt) return null;

  // Una finestra aperta a nome di QUALCUN ALTRO significa che il tavolo
  // aspetta lui, non il disconnesso: è lui che deve rispondere, e il server
  // rifiuterebbe il salto. Le finestre del disconnesso invece sono proprio il
  // caso da sbloccare, e non fanno sparire il comando.
  if (state.pendingAction && state.pendingAction.playerId !== fermo.id) return null;

  const mancano = Math.max(0, attesaRimanenteMs);
  return {
    player: fermo,
    ready: mancano <= 0,
    secondsLeft: Math.ceil(mancano / 1000),
  };
}
