import type { BoardSquare, GameStats } from './socket';

/**
 * Da millisecondi a una scritta compatta ("42 min" o "1h 05min"), per la
 * durata della partita mostrata nel riepilogo di fine partita. Si arrotonda
 * al minuto: la precisione dei secondi non aggiunge nulla a chi legge, e la
 * cifra tonda evita fastidiosi "41 min 58 s".
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  // Padding a due cifre sui minuti solo quando c'è già un'ora davanti, per
  // leggere "1h 05min" invece del più ambiguo "1h 5min".
  const paddedMinutes = String(minutes).padStart(2, '0');
  return `${hours}h ${paddedMinutes}min`;
}

/**
 * La casella con più atterraggi registrati. `null` se la mappa è vuota (può
 * capitare solo se la partita finisce prima che qualcuno si muova, un caso
 * di fatto irraggiungibile ma comunque gestito senza esplodere) o se la
 * posizione più visitata non corrisponde a nessuna casella nota (non
 * dovrebbe mai succedere, ma un tabellone client disallineato da quello del
 * server non deve far crashare il riepilogo).
 */
export function mostVisitedSquare(
  landings: GameStats['landings'],
  board: BoardSquare[]
): { square: BoardSquare; count: number } | null {
  let best: { position: number; count: number } | null = null;
  for (const [pos, count] of Object.entries(landings)) {
    if (!best || count > best.count) best = { position: Number(pos), count };
  }
  if (!best) return null;
  const square = board.find((s) => s.position === best!.position);
  if (!square) return null;
  return { square, count: best.count };
}

/** Valore di una mappa playerId -> numero per un giocatore, 0 se assente. */
export function statFor(map: Record<string, number>, playerId: string): number {
  return map[playerId] || 0;
}
