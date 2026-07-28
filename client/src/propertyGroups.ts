import type { BoardSquare, GameState } from './socket';

/** Un gruppo del tabellone visto dal lato di un giocatore. */
export interface PropertyGroup {
  /** 'orange', 'blue'… oppure 'station' / 'utility'. Chiave per GROUP_COLORS e GROUP_LABELS. */
  key: string;
  /** Le caselle del gruppo che il giocatore possiede, in ordine di tabellone. */
  squares: BoardSquare[];
  /** Quante ne possiede. */
  owned: number;
  /** Quante ne esistono in tutto sul tabellone. */
  total: number;
  /** Vero se le possiede tutte: è il monopolio. */
  complete: boolean;
}

/**
 * Le proprietà di un giocatore raggruppate per gruppo di colore, con quante ne
 * possiede su quante ne esistono. È l'informazione che conta quando si tratta:
 * non "cosa ha", ma "a chi manca cosa".
 *
 * Puro e senza import a runtime di proposito: così gira sia nel browser sia
 * sotto node per i test (`npm test` dentro client/).
 */
export function propertyGroups(
  board: BoardSquare[],
  ownership: GameState['ownership'],
  playerId: string
): PropertyGroup[] {
  // Quante caselle esistono per gruppo, e da quale posizione parte ciascuno:
  // l'ordine dei gruppi segue il giro del tabellone, non l'ordine d'acquisto.
  const totali = new Map<string, number>();
  const primaPosizione = new Map<string, number>();
  for (const square of board) {
    const key = groupKey(square);
    if (!key) continue;
    totali.set(key, (totali.get(key) || 0) + 1);
    if (!primaPosizione.has(key)) primaPosizione.set(key, square.position);
  }

  const mie = new Map<string, BoardSquare[]>();
  for (const square of board) {
    const key = groupKey(square);
    if (!key) continue;
    if (ownership[square.position]?.ownerId !== playerId) continue;
    if (!mie.has(key)) mie.set(key, []);
    mie.get(key)!.push(square);
  }

  return [...mie.entries()]
    .map(([key, squares]) => {
      const total = totali.get(key) ?? squares.length;
      return { key, squares, owned: squares.length, total, complete: squares.length === total };
    })
    .sort((a, b) => (primaPosizione.get(a.key) ?? 0) - (primaPosizione.get(b.key) ?? 0));
}

/** Chiave di raggruppamento: il colore, o il tipo per stazioni e società. */
function groupKey(square: BoardSquare): string | null {
  if (square.group) return square.group;
  if (square.type === 'station' || square.type === 'utility') return square.type;
  return null;
}
