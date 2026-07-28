import type { GameState } from './socket';

type LogEntry = GameState['log'][number];

/**
 * Il punto più avanzato del registro tra quello già noto e quello appena
 * arrivato. Serve a tenere un segnalibro sempre aggiornato mentre si è
 * connessi, pronto a diventare la base di confronto alla prossima
 * disconnessione vera.
 */
export function latestLogAt(log: LogEntry[], previous: number | null): number {
  return log.reduce((max, e) => (e.at > max ? e.at : max), previous ?? 0);
}

/**
 * Il motore registra anche le disconnessioni e i rientri di ciascun
 * giocatore ("Mario è tornato.", "Mario si è disconnesso.") — utili nel
 * registro completo, ma rumore per questo riepilogo: comparirebbero dopo
 * *ogni* caduta di rete, anche quando in partita non è cambiato nulla,
 * violando la regola "se non è successo niente, il riquadro non compare".
 * Si riconoscono dal suffisso fisso del messaggio, indipendente dal nome.
 */
function isConnectionNotice(message: string): boolean {
  return / è tornato\.$| si è disconnesso\.$/.test(message);
}

/**
 * Le righe di registro arrivate dopo il segnalibro: quelle successe mentre si
 * era disconnessi. `baseline === null` vuol dire "nessun segnalibro
 * precedente" (primo ingresso al tavolo): non c'è nulla da riepilogare, anche
 * se il registro non è vuoto.
 */
export function missedSince(log: LogEntry[], baseline: number | null): LogEntry[] {
  if (baseline === null) return [];
  return log.filter((e) => e.at > baseline && !isConnectionNotice(e.message));
}
