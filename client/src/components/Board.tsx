import { BoardSquare, GameState } from '../socket';
import { GROUP_COLORS } from '../groupColors';

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

const TOKEN_COLORS = ['var(--brass-2)', '#8FD3F4'];

export default function Board({
  board,
  state,
  onSquareClick,
}: {
  board: BoardSquare[];
  state: GameState;
  onSquareClick: (position: number) => void;
}) {
  return (
    <div style={styles.grid}>
      {board.map((square) => {
        const { row, col } = gridPos(square.position);
        const owned = state.ownership[square.position];
        const playersHere = state.players.filter((p) => p.position === square.position && !p.bankrupt);
        return (
          <div
            key={square.position}
            onClick={() => onSquareClick(square.position)}
            style={{
              ...styles.square,
              gridRow: row,
              gridColumn: col,
              borderColor: owned ? 'var(--brass)' : 'rgba(201,150,44,0.15)',
              cursor: 'pointer',
            }}
            title={square.name}
          >
            {square.group && (
              <div style={{ ...styles.colorBar, background: GROUP_COLORS[square.group] }} />
            )}
            <span style={styles.squareName}>{square.name}</span>
            {square.price && <span style={styles.squarePrice}>{square.price}</span>}
            {owned && (
              <div
                style={{
                  ...styles.ownedDot,
                  background: state.players.find((p) => p.id === owned.ownerId)
                    ? TOKEN_COLORS[state.players.findIndex((p) => p.id === owned.ownerId) % 2]
                    : 'var(--brass)',
                }}
              />
            )}
            {playersHere.length > 0 && (
              <div style={styles.tokens}>
                {playersHere.map((p) => (
                  <span key={p.id} style={styles.token}>{p.token}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={styles.center}>
        <span className="display" style={styles.centerTitle}>MONOPOLY</span>
        <span style={styles.centerSub}>edizione Noi Due</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1.4fr repeat(9, 1fr) 1.4fr',
    gridTemplateRows: '1.4fr repeat(9, 1fr) 1.4fr',
    width: 'min(78vh, 92vw)',
    aspectRatio: '1 / 1',
    background: 'var(--felt-2)',
    border: '3px solid var(--brass)',
    borderRadius: 10,
    boxShadow: 'var(--shadow-card)',
  },
  square: {
    border: '1px solid rgba(201,150,44,0.15)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '4px 2px',
    position: 'relative',
    overflow: 'hidden',
    background: 'rgba(0,0,0,0.08)',
  },
  colorBar: { position: 'absolute', top: 0, left: 0, right: 0, height: '18%' },
  squareName: { fontSize: '0.52rem', textAlign: 'center', lineHeight: 1.1, color: 'var(--paper)', fontWeight: 600 },
  squarePrice: { fontSize: '0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--brass-2)' },
  ownedDot: { position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: '50%' },
  tokens: { position: 'absolute', bottom: 2, display: 'flex', gap: 2 },
  token: { fontSize: '0.75rem' },
  center: {
    gridRow: '2 / 11',
    gridColumn: '2 / 11',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    opacity: 0.35,
  },
  centerTitle: { fontSize: '2.2rem', color: 'var(--brass)', letterSpacing: '0.05em' },
  centerSub: { fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--paper)' },
};
