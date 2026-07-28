import { BoardSquare, GameState } from '../socket';
import { GROUP_COLORS } from '../groupColors';
import { PLAYER_COLORS, gridPos } from './Board';

/**
 * Mappa in miniatura del tabellone, per capire a colpo d'occhio com'è divisa la
 * proprietà prima di comporre uno scambio. Le caselle sono tinte del colore di
 * chi le possiede; quelle nello scambio portano un anello, di colore diverso a
 * seconda del verso — ottone per quello che esce, avorio per quello che entra.
 *
 * Serve a guardare, non a selezionare: a questa dimensione una casella è troppo
 * stretta per il pollice, quindi la scelta resta agli elenchi.
 */
export default function TradeBoard({
  board,
  state,
  myId,
  otherId,
  offered,
  requested,
}: {
  board: BoardSquare[];
  state: GameState;
  myId: string;
  otherId: string;
  /** Caselle tue che stai offrendo: escono da te. */
  offered: number[];
  /** Caselle sue che stai chiedendo: entrano da lui. */
  requested: number[];
}) {
  const colorOf = (playerId: string) =>
    PLAYER_COLORS[state.players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];

  return (
    <div style={styles.grid}>
      {board.map((square) => {
        const { row, col } = gridPos(square.position);
        const owned = state.ownership[square.position];
        const isMine = owned?.ownerId === myId;
        const isTheirs = owned?.ownerId === otherId;
        const inUscita = offered.includes(square.position);
        const inEntrata = requested.includes(square.position);
        const scambiabile = square.price !== undefined;

        // Chi possiede la casella decide il riempimento; il colore del gruppo
        // resta come striscia, per riconoscere i monopoli.
        const fill = isMine
          ? `${colorOf(myId)}55`
          : isTheirs
            ? `${colorOf(otherId)}55`
            : 'rgba(0,0,0,0.22)';

        return (
          <div
            key={square.position}
            style={{
              ...styles.cell,
              gridRow: row,
              gridColumn: col,
              background: fill,
              // Due colori invece di due tratteggi: a venti pixel un bordo
              // tratteggiato non si distingue da uno pieno.
              outline: inUscita
                ? '2px solid var(--brass-2)'
                : inEntrata
                  ? '2px solid var(--paper)'
                  : undefined,
              outlineOffset: -2,
              opacity: owned?.mortgaged ? 0.45 : 1,
            }}
            title={
              owned
                ? `${square.name} — ${isMine ? 'tua' : 'sua'}${owned.mortgaged ? ' (ipotecata)' : ''}`
                : square.name
            }
          >
            {square.group && (
              <span style={{ ...styles.band, background: GROUP_COLORS[square.group] }} />
            )}
            {/* Un pallino segnala le caselle che non si possono scambiare. */}
            {!scambiabile && <span style={styles.neutral} />}
          </div>
        );
      })}

      <div style={styles.legend}>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: `${colorOf(myId)}55`, borderColor: colorOf(myId) }} />
          tue
        </div>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: `${colorOf(otherId)}55`, borderColor: colorOf(otherId) }} />
          sue
        </div>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: 'transparent', borderColor: 'var(--brass-2)' }} />
          offri
        </div>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: 'transparent', borderColor: 'var(--paper)' }} />
          chiedi
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1.4fr repeat(9, 1fr) 1.4fr',
    gridTemplateRows: '1.4fr repeat(9, 1fr) 1.4fr',
    width: '100%',
    aspectRatio: '1 / 1',
    gap: 1,
    padding: 4,
    borderRadius: 8,
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(201,150,44,0.25)',
  },
  cell: { position: 'relative', borderRadius: 2, minWidth: 0 },
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: '30%', borderRadius: '2px 2px 0 0' },
  neutral: {
    position: 'absolute',
    inset: '38%',
    borderRadius: '50%',
    background: 'rgba(243,234,216,0.18)',
  },
  legend: {
    gridRow: '3 / 10',
    gridColumn: '3 / 10',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.72rem',
    color: 'rgba(243,234,216,0.75)',
  },
  legendRow: { display: 'flex', alignItems: 'center', gap: 7 },
  chip: { width: 13, height: 13, borderRadius: 3, border: '1.5px solid' },
};
