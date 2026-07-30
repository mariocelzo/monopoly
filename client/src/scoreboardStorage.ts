import {
  Scoreboard,
  addResult,
  buildResultFromState,
  emptyScoreboard,
  parseScoreboard,
  type FinishedGameState,
} from './scoreboard';

// Stessa chiave del resto della roba in localStorage (vedi identity.ts):
// namespace comune, per non rischiare collisioni con altre chiavi del sito.
const SCOREBOARD_KEY = 'monopoly.scoreboard';

/** localStorage può essere inaccessibile (navigazione privata, cookie bloccati). */
function read(): string | null {
  try {
    return window.localStorage.getItem(SCOREBOARD_KEY);
  } catch {
    return null;
  }
}

function write(scoreboard: Scoreboard) {
  try {
    window.localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(scoreboard));
  } catch {
    // Senza memoria persistente il tabellino non si conserva da una partita
    // all'altra, ma la partita in corso non ne risente: non è un errore da
    // far notare a metà gioco.
  }
}

/** Il tabellino così com'è ora, sanato da parseScoreboard se il dato è corrotto o vecchio. */
export function loadScoreboard(): Scoreboard {
  return parseScoreboard(read());
}

/** Azzera il tabellino (con conferma già chiesta da chi chiama, vedi Scoreboard.tsx). */
export function resetScoreboard(): Scoreboard {
  try {
    window.localStorage.removeItem(SCOREBOARD_KEY);
  } catch {
    /* vedi write() sopra */
  }
  return emptyScoreboard();
}

/**
 * Punto d'ingresso chiamato da App.tsx a ogni partita finita: decide se va
 * registrata (vedi buildResultFromState) e, se sì, la somma al tabellino
 * salvato. Non fa nulla — silenziosamente — per le partite che non vanno
 * segnate (tavolo chiuso, presenza di bot, partita già segnata prima).
 */
export function recordFinishedGame(state: FinishedGameState): void {
  const result = buildResultFromState(state);
  if (!result) return;
  const current = loadScoreboard();
  const next = addResult(current, result);
  // addResult restituisce lo STESSO oggetto (stessa identità) quando il
  // gameId era già fra i registrati: chiamata chiamata dopo la prima, per
  // esempio a ogni voto di rivincita ribroadcastato mentre si resta sul
  // riquadro di fine partita, non scrive nulla di nuovo su localStorage.
  if (next === current) return;
  write(next);
}
