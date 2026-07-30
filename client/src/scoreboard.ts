import type { GameState } from './socket';

/**
 * Tabellino fra una partita e l'altra: chi ha vinto quante volte e qualche
 * record, conservato nel browser (vedi scoreboardStorage.ts) perché il
 * server su Render (piano gratuito) ha filesystem effimero — un archivio lì
 * sparirebbe a ogni deploy, e uno esterno è sproporzionato per un gioco fra
 * due persone. Qui dentro solo funzioni pure che ricevono e restituiscono
 * dati: nessun accesso a `window`/`localStorage`, così si possono testare
 * sotto Node in logic-test.ts esattamente come le altre logiche del client.
 */

/** Un giocatore nel tabellino, indicizzato per nome normalizzato. */
export interface ScoreboardPlayerEntry {
  /** La grafia con cui il nome è comparso la prima volta, per mostrarlo. */
  displayName: string;
  wins: number;
  gamesPlayed: number;
}

export interface ScoreboardRecords {
  /** Partita più lunga mai registrata. */
  longestGame: { ms: number; playerNames: string[] } | null;
  /** Patrimonio più alto raggiunto da un giocatore a fine partita. */
  highestNetWorth: { name: string; amount: number } | null;
}

export interface Scoreboard {
  version: 1;
  /** Chiave = nome normalizzato (vedi normalizeName). */
  players: Record<string, ScoreboardPlayerEntry>;
  /**
   * Id delle partite già segnate, per non contarne una due volte se
   * l'effetto che registra il risultato scatta più di una volta (un altro
   * aggiornamento di stato mentre il riepilogo di fine partita resta aperto,
   * un rimontaggio del componente...). Vedi buildResultFromState per come si
   * costruisce l'id.
   */
  recordedGameIds: string[];
  /**
   * Atterraggi per casella, sommati su tutte le partite registrate. Serve a
   * ricavare la casella più gettonata di sempre (vedi mostLandedSquare),
   * sullo stesso principio di mostVisitedSquare in gameSummary.ts ma
   * cumulativo invece che di una sola partita.
   */
  landingsTotals: Record<number, number>;
  records: ScoreboardRecords;
}

export function emptyScoreboard(): Scoreboard {
  return {
    version: 1,
    players: {},
    recordedGameIds: [],
    landingsTotals: {},
    records: { longestGame: null, highestNetWorth: null },
  };
}

/**
 * Chiave stabile per raggruppare lo stesso giocatore anche se il nome è
 * stato scritto in modo leggermente diverso da una partita all'altra
 * ("Mario", " mario", "MARIO "): spazi ai margini rimossi, spazi ripetuti
 * accorpati, tutto minuscolo. Non tocca gli accenti: sono un caso raro quanto
 * un vero refuso, e una normalizzazione unicode completa aggiungerebbe
 * complessità per un limite che qui non serve.
 */
export function normalizeName(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  // Un nome vuoto (in teoria impedito da Lobby, ma questa funzione non deve
  // fidarsi di chi la chiama) non deve sparire silenziosamente nella somma
  // di tutti gli "anonimi": meglio una chiave dedicata che almeno si nota.
  return key || '(senza nome)';
}

/**
 * Sottoinsieme di GameState che serve a decidere se e come registrare un
 * risultato: separato per non dover passare l'intero stato della partita
 * (log, ownership, pendingAction...) a una funzione che non se ne serve.
 */
export type FinishedGameState = Pick<
  GameState,
  'finished' | 'endedReason' | 'winnerId' | 'players' | 'stats' | 'roomCode'
>;

/** Un risultato pronto per essere sommato al tabellino con addResult. */
export interface GameResultInput {
  gameId: string;
  winnerName: string;
  playerNames: string[];
  durationMs: number | null;
  netWorths: { name: string; amount: number }[];
  landings: Record<number, number>;
}

/**
 * Decide se una partita finita va segnata, e prepara i dati per addResult.
 * `null` vuol dire "non va registrata", per tre motivi possibili:
 *
 * - il tavolo è stato chiuso (`endedReason === 'closed'`): non è un
 *   risultato, è un'uscita. Bancarotta e abbandono invece SONO un esito —
 *   c'è un vincitore vero, anche se uno dei due ha scelto di ritirarsi.
 * - non c'è un vincitore (difesa: non dovrebbe capitare a partita finita e
 *   non chiusa, ma senza vincitore non c'è nulla da sommare).
 * - almeno un giocatore al tavolo è un bot: il tabellino è pensato per la
 *   sfida fra le due persone vere. Un bot che vince o perde non è un
 *   rivale — gonfierebbe i numeri di chi gioca spesso contro i bot senza
 *   dire niente su chi gioca meglio dell'altro.
 */
export function buildResultFromState(state: FinishedGameState): GameResultInput | null {
  if (!state.finished) return null;
  if (state.endedReason === 'closed') return null;
  if (!state.winnerId) return null;
  if (state.players.some((p) => p.isBot)) return null;

  const winner = state.players.find((p) => p.id === state.winnerId);
  if (!winner) return null;

  const { startedAt, finishedAt, landings } = state.stats;
  return {
    // roomCode + inizio partita identifica la singola partita, rivincita
    // compresa: rematch() sul server assegna un nuovo stats.startedAt a ogni
    // ripartenza (vedi gameEngine.js), quindi due partite sullo stesso
    // tavolo non collidono mai su questo id.
    gameId: `${state.roomCode}:${startedAt ?? 'na'}`,
    winnerName: winner.name,
    playerNames: state.players.map((p) => p.name),
    durationMs: startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null,
    netWorths: state.players.map((p) => ({ name: p.name, amount: p.netWorth })),
    landings,
  };
}

/**
 * Somma un risultato al tabellino. Pura: restituisce un tabellino nuovo,
 * non tocca quello passato. Idempotente rispetto a `gameId` — richiamarla
 * due volte con lo stesso risultato lascia il tabellino invariato dopo la
 * prima volta, così chi la chiama (vedi scoreboardStorage.ts) non deve
 * preoccuparsi di quante volte scatta l'effetto che registra la fine
 * partita.
 */
export function addResult(scoreboard: Scoreboard, result: GameResultInput): Scoreboard {
  if (scoreboard.recordedGameIds.includes(result.gameId)) return scoreboard;

  const players = { ...scoreboard.players };
  for (const rawName of result.playerNames) {
    const key = normalizeName(rawName);
    const existing = players[key];
    players[key] = existing
      ? { ...existing, gamesPlayed: existing.gamesPlayed + 1 }
      : { displayName: rawName.trim() || rawName, wins: 0, gamesPlayed: 1 };
  }
  const winnerKey = normalizeName(result.winnerName);
  players[winnerKey] = { ...players[winnerKey], wins: players[winnerKey].wins + 1 };

  const landingsTotals = { ...scoreboard.landingsTotals };
  for (const [pos, count] of Object.entries(result.landings)) {
    const position = Number(pos);
    landingsTotals[position] = (landingsTotals[position] ?? 0) + count;
  }

  const longestGame =
    result.durationMs !== null &&
    (!scoreboard.records.longestGame || result.durationMs > scoreboard.records.longestGame.ms)
      ? { ms: result.durationMs, playerNames: result.playerNames }
      : scoreboard.records.longestGame;

  const bestOfThisGame = result.netWorths.reduce<{ name: string; amount: number } | null>(
    (best, cur) => (!best || cur.amount > best.amount ? cur : best),
    null
  );
  const highestNetWorth =
    bestOfThisGame &&
    (!scoreboard.records.highestNetWorth || bestOfThisGame.amount > scoreboard.records.highestNetWorth.amount)
      ? bestOfThisGame
      : scoreboard.records.highestNetWorth;

  return {
    version: 1,
    players,
    recordedGameIds: [...scoreboard.recordedGameIds, result.gameId],
    landingsTotals,
    records: { longestGame, highestNetWorth },
  };
}

/**
 * Giocatori ordinati per il tabellino: più vittorie prima, a parità più
 * partite giocate prima (chi gioca di più ma vince alla pari ha comunque
 * un record "meno denso", ma è comunque un modo stabile di spareggiare),
 * a parità assoluta ordine alfabetico così il risultato non balla da un
 * render all'altro.
 */
export function rankedPlayers(
  scoreboard: Scoreboard
): (ScoreboardPlayerEntry & { key: string })[] {
  return Object.entries(scoreboard.players)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.gamesPlayed - a.gamesPlayed ||
        a.displayName.localeCompare(b.displayName)
    );
}

/**
 * La casella con più atterraggi sommati su tutte le partite registrate.
 * Stessa forma di mostVisitedSquare in gameSummary.ts (posizione + conteggio,
 * senza risolvere il nome: lo fa chi mostra il dato, che ha il tabellone a
 * disposizione), ma cumulativa invece che su una sola partita.
 */
export function mostLandedSquare(
  landingsTotals: Record<number, number>
): { position: number; count: number } | null {
  let best: { position: number; count: number } | null = null;
  for (const [pos, count] of Object.entries(landingsTotals)) {
    if (!best || count > best.count) best = { position: Number(pos), count };
  }
  return best;
}

/** Un valore è un numero finito, altrimenti si scarta invece di propagare NaN. */
function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Legge un tabellino da una stringa JSON (o `null`, prima visita). Non si
 * fida di quello che trova: può essere `localStorage` intatto ma anche
 * corrotto (scrittura interrotta, editing manuale) o di una versione
 * precedente del formato. In ogni caso di dubbio si torna a un tabellino
 * vuoto invece di rischiare campi mancanti che farebbero esplodere il resto
 * — perdere un tabellino malformato è accettabile, un'interfaccia che
 * crasha al prossimo avvio no.
 */
export function parseScoreboard(raw: string | null): Scoreboard {
  if (!raw) return emptyScoreboard();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyScoreboard();
  }
  if (!data || typeof data !== 'object') return emptyScoreboard();
  const obj = data as Record<string, unknown>;
  // Versione sconosciuta (o di un formato futuro/precedente non compatibile):
  // meglio ripartire da zero che interpretare campi che potrebbero avere un
  // significato diverso.
  if (obj.version !== 1) return emptyScoreboard();

  const players: Record<string, ScoreboardPlayerEntry> = {};
  if (obj.players && typeof obj.players === 'object') {
    for (const [key, value] of Object.entries(obj.players as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      if (typeof v.displayName !== 'string' || !v.displayName) continue;
      players[key] = {
        displayName: v.displayName,
        wins: Math.max(0, safeNumber(v.wins)),
        gamesPlayed: Math.max(0, safeNumber(v.gamesPlayed)),
      };
    }
  }

  const recordedGameIds = Array.isArray(obj.recordedGameIds)
    ? obj.recordedGameIds.filter((id): id is string => typeof id === 'string')
    : [];

  const landingsTotals: Record<number, number> = {};
  if (obj.landingsTotals && typeof obj.landingsTotals === 'object') {
    for (const [pos, count] of Object.entries(obj.landingsTotals as Record<string, unknown>)) {
      const position = Number(pos);
      if (Number.isFinite(position)) landingsTotals[position] = Math.max(0, safeNumber(count));
    }
  }

  const rec = obj.records && typeof obj.records === 'object' ? (obj.records as Record<string, unknown>) : {};
  const longestGameRaw = rec.longestGame as Record<string, unknown> | null | undefined;
  const longestGame =
    longestGameRaw &&
    typeof longestGameRaw === 'object' &&
    typeof longestGameRaw.ms === 'number' &&
    Array.isArray(longestGameRaw.playerNames)
      ? {
          ms: safeNumber(longestGameRaw.ms),
          playerNames: (longestGameRaw.playerNames as unknown[]).filter(
            (n): n is string => typeof n === 'string'
          ),
        }
      : null;

  const highestNetWorthRaw = rec.highestNetWorth as Record<string, unknown> | null | undefined;
  const highestNetWorth =
    highestNetWorthRaw &&
    typeof highestNetWorthRaw === 'object' &&
    typeof highestNetWorthRaw.name === 'string' &&
    typeof highestNetWorthRaw.amount === 'number'
      ? { name: highestNetWorthRaw.name, amount: safeNumber(highestNetWorthRaw.amount) }
      : null;

  return {
    version: 1,
    players,
    recordedGameIds,
    landingsTotals,
    records: { longestGame, highestNetWorth },
  };
}
