import { useEffect, useRef, useState } from 'react';
import { BoardSquare, GameState } from '../socket';
import { GROUP_COLORS } from '../groupColors';

/** Riga e colonna (1-based) della casella nella griglia 11x11. */
function gridPos(position: number): { row: number; col: number } {
  if (position === 0) return { row: 11, col: 11 };
  if (position >= 1 && position <= 9) return { row: 11, col: 11 - position };
  if (position === 10) return { row: 11, col: 1 };
  if (position >= 11 && position <= 19) return { row: 11 - (position - 10), col: 1 };
  if (position === 20) return { row: 1, col: 1 };
  if (position >= 21 && position <= 29) return { row: 1, col: 1 + (position - 20) };
  if (position === 30) return { row: 1, col: 11 };
  return { row: 1 + (position - 30), col: 11 }; // 31-39
}

// La griglia è `1.4fr repeat(9, 1fr) 1.4fr`: gli angoli sono più larghi, quindi
// il centro di una cella non si ricava dividendo per 11.
const CORNER = 1.4;
const TRACK = CORNER * 2 + 9;

/** Centro di una riga o colonna, in percentuale sul lato del tabellone. */
function centerPercent(index: number): number {
  const i = index - 1;
  if (i === 0) return (CORNER / 2 / TRACK) * 100;
  if (i === 10) return ((CORNER + 9 + CORNER / 2) / TRACK) * 100;
  return ((CORNER + (i - 1) + 0.5) / TRACK) * 100;
}

// Colori dei due giocatori, usati per pedoni e indicatori di proprietà.
export const PLAYER_COLORS = ['#E8B85A', '#7EC8E3'];

const CORNER_ICONS: Record<number, string> = { 0: '➜', 10: '⛓', 20: '🅿', 30: '👮' };

/**
 * Muove le pedine una casella alla volta invece di farle saltare a destinazione.
 * I salti lunghi (carte "avanza fino a", prigione) non si percorrono a piedi: si
 * scivola direttamente, altrimenti l'attesa sarebbe interminabile.
 */
function useWalkingPositions(state: GameState): Record<string, number> {
  const [shown, setShown] = useState<Record<string, number>>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setShown((prev) => {
      const next = { ...prev };
      let changed = false;
      state.players.forEach((p) => {
        if (next[p.id] === undefined) {
          next[p.id] = p.position;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [state.players]);

  useEffect(() => {
    if (timer.current !== null) return;

    const step = () => {
      setShown((prev) => {
        const next = { ...prev };
        let moving = false;
        state.players.forEach((p) => {
          const current = next[p.id];
          if (current === undefined || current === p.position) return;
          const forward = (p.position - current + 40) % 40;
          // Un tiro di dadi non supera mai le 12 caselle: oltre è un salto.
          next[p.id] = forward <= 12 ? (current + 1) % 40 : p.position;
          if (next[p.id] !== p.position) moving = true;
        });
        if (!moving && timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        return next;
      });
    };

    const needsWalk = state.players.some((p) => shown[p.id] !== undefined && shown[p.id] !== p.position);
    if (needsWalk) {
      timer.current = window.setInterval(step, 110);
    }
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [state.players, shown]);

  return shown;
}

export default function Board({
  board,
  state,
  onSquareClick,
}: {
  board: BoardSquare[];
  state: GameState;
  onSquareClick: (position: number) => void;
}) {
  const walking = useWalkingPositions(state);
  const colorOf = (playerId: string) =>
    PLAYER_COLORS[state.players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];

  return (
    <div style={styles.frame}>
      <div style={styles.grid}>
        {board.map((square) => {
          const { row, col } = gridPos(square.position);
          const owned = state.ownership[square.position];
          const owner = owned ? state.players.find((p) => p.id === owned.ownerId) : null;
          const isCorner = square.position % 10 === 0;

          return (
            <div
              key={square.position}
              onClick={() => onSquareClick(square.position)}
              style={{
                ...styles.square,
                ...(isCorner ? styles.cornerSquare : null),
                gridRow: row,
                gridColumn: col,
                // Il proprietario si legge dal bagliore interno, non da un puntino.
                boxShadow: owner ? `inset 0 0 0 2px ${colorOf(owner.id)}` : undefined,
                opacity: owned?.mortgaged ? 0.55 : 1,
              }}
              title={
                owner
                  ? `${square.name} — di ${owner.name}${owned?.mortgaged ? ' (ipotecata)' : ''}`
                  : square.name
              }
            >
              {square.group && (
                <div style={{ ...styles.colorBar, background: GROUP_COLORS[square.group] }}>
                  {/* Case e hotel disegnati sulla fascia colorata, come sul tabellone vero. */}
                  {owned?.hotel && <span style={styles.hotel} />}
                  {!owned?.hotel &&
                    Array.from({ length: owned?.houses || 0 }).map((_, i) => (
                      <span key={i} style={styles.house} />
                    ))}
                </div>
              )}

              {isCorner && <span style={styles.cornerIcon}>{CORNER_ICONS[square.position]}</span>}
              <span style={{ ...styles.squareName, ...(isCorner ? styles.cornerName : null) }}>
                {square.name}
              </span>
              {square.price !== undefined && !isCorner && (
                <span style={styles.squarePrice}>{square.price}</span>
              )}
              {owned?.mortgaged && <span style={styles.mortgageTag}>IPOT.</span>}
            </div>
          );
        })}

        <div style={styles.center}>
          <span className="display" style={styles.centerTitle}>MONOPOLY</span>
          <span style={styles.centerSub}>edizione Noi Due</span>
          <div style={styles.legend}>
            {state.players.map((p) => (
              <div key={p.id} style={{ ...styles.legendItem, opacity: p.bankrupt ? 0.35 : 1 }}>
                <span style={{ ...styles.legendDot, background: colorOf(p.id) }} />
                <span style={styles.legendToken}>{p.token}</span>
                <span style={styles.legendName}>{p.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* I pedoni vivono in un piano sopra la griglia: così possono scivolare
            da una casella all'altra invece di ricomparire altrove. */}
        {state.players.map((p, index) => {
          if (p.bankrupt) return null;
          const at = walking[p.id] ?? p.position;
          const { row, col } = gridPos(at);
          const nudge = index === 0 ? -9 : 9;
          return (
            <div
              key={p.id}
              style={{
                ...styles.pawn,
                left: `${centerPercent(col)}%`,
                top: `${centerPercent(row)}%`,
                transform: `translate(calc(-50% + ${nudge}px), -50%)`,
                borderColor: colorOf(p.id),
                boxShadow: `0 0 10px ${colorOf(p.id)}66`,
              }}
              title={`${p.name} — ${board[at]?.name || ''}`}
            >
              {p.token}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frame: {
    padding: 10,
    borderRadius: 16,
    // Cornice in ottone spazzolato attorno al feltro.
    background: 'linear-gradient(145deg, #c9962c 0%, #8a6519 45%, #e8b85a 100%)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
  },
  grid: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1.4fr repeat(9, 1fr) 1.4fr',
    gridTemplateRows: '1.4fr repeat(9, 1fr) 1.4fr',
    width: 'min(78vh, 92vw)',
    aspectRatio: '1 / 1',
    background:
      'radial-gradient(ellipse at 50% 45%, #1d5843 0%, #0f3d2e 75%), repeating-linear-gradient(45deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 4px)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  square: {
    border: '1px solid rgba(201,150,44,0.18)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '4px 2px 3px',
    position: 'relative',
    overflow: 'hidden',
    background: 'rgba(0,0,0,0.12)',
    cursor: 'pointer',
    transition: 'box-shadow 0.2s ease, opacity 0.2s ease',
  },
  cornerSquare: { justifyContent: 'center', gap: 3, background: 'rgba(0,0,0,0.25)' },
  cornerIcon: { fontSize: '1.1rem', lineHeight: 1, color: 'var(--brass-2)' },
  cornerName: { fontSize: '0.5rem', letterSpacing: '0.04em', textTransform: 'uppercase' },
  colorBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '20%',
    borderBottom: '1px solid rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  house: { width: 4, height: 4, borderRadius: 1, background: '#2ecc71', border: '0.5px solid rgba(0,0,0,0.5)' },
  hotel: { width: 11, height: 5, borderRadius: 1, background: '#e74c3c', border: '0.5px solid rgba(0,0,0,0.5)' },
  squareName: { fontSize: '0.52rem', textAlign: 'center', lineHeight: 1.1, color: 'var(--paper)', fontWeight: 600 },
  squarePrice: { fontSize: '0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--brass-2)', marginTop: 1 },
  mortgageTag: {
    position: 'absolute',
    top: '22%',
    fontSize: '0.42rem',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.08em',
    color: '#e18a8a',
  },
  center: {
    gridRow: '2 / 11',
    gridColumn: '2 / 11',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  centerTitle: { fontSize: '2.4rem', color: 'var(--brass)', letterSpacing: '0.06em', opacity: 0.5 },
  centerSub: { fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--paper)', opacity: 0.35 },
  legend: { display: 'flex', gap: 14, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: 'rgba(243,234,216,0.75)' },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendToken: { fontSize: '0.95rem' },
  legendName: { fontFamily: 'var(--font-mono)' },
  pawn: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.95rem',
    background: 'rgba(15,61,46,0.92)',
    border: '2px solid',
    pointerEvents: 'none',
    zIndex: 5,
    // Il passo del cammino è 110ms: la transizione sta dentro quel tempo.
    transition: 'left 0.1s linear, top 0.1s linear',
  },
};
