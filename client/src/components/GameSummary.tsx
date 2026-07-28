import { GameState, BoardSquare } from '../socket';
import { formatDuration, mostVisitedSquare, statFor } from '../gameSummary';

/**
 * Riepilogo di fine partita: qualche numero su come è andata, non solo il
 * nome di chi ha vinto. I dati vengono da `state.stats`, contatori tenuti dal
 * motore mentre la partita procede (vedi il commento su GameStats in
 * socket.ts) — non dal registro degli eventi, che è tappato alle ultime
 * righe e su una partita lunga racconterebbe solo la parte finale.
 *
 * Vive dentro l'area che scorre del riquadro di fine partita in App.tsx: può
 * crescere parecchio con tanti giocatori, e i bottoni Rivincita/Lascia il
 * tavolo devono restare raggiungibili sotto, fuori dallo scorrimento.
 */
export default function GameSummary({
  state,
  board,
  myId,
}: {
  state: GameState;
  board: BoardSquare[];
  myId: string;
}) {
  const stats = state.stats;
  // Difesa minima: una partita ripristinata da un salvataggio antecedente a
  // questa funzionalità potrebbe non avere `stats` valorizzato. Meglio non
  // mostrare nulla che far esplodere il riquadro di fine partita.
  if (!stats) return null;

  const durata =
    stats.startedAt !== null && stats.finishedAt !== null
      ? formatDuration(stats.finishedAt - stats.startedAt)
      : null;
  const gettonata = mostVisitedSquare(stats.landings, board);

  return (
    <div style={styles.wrap}>
      <div style={styles.headline}>
        {durata && <span style={styles.headlineItem}>⏱ {durata}</span>}
        {gettonata && (
          <span style={styles.headlineItem}>
            📍 {gettonata.square.name} · {gettonata.count}×
          </span>
        )}
        <span style={styles.headlineItem}>
          🤝 {stats.tradesCompleted} {stats.tradesCompleted === 1 ? 'scambio' : 'scambi'}
        </span>
      </div>

      <div style={styles.players}>
        {state.players.map((p) => (
          <div
            key={p.id}
            style={{ ...styles.row, ...(p.id === myId ? styles.rowMine : null) }}
          >
            <div style={styles.rowHead}>
              <span style={styles.token}>{p.token}</span>
              <span style={styles.name}>{p.name}</span>
            </div>
            <div style={styles.chips}>
              <span className="mono" style={styles.chip}>
                +€{statFor(stats.rentCollected, p.id)} / −€{statFor(stats.rentPaid, p.id)} affitti
              </span>
              <span className="mono" style={styles.chip}>
                −€{statFor(stats.bankPaid, p.id)} banca
              </span>
              <span className="mono" style={styles.chip}>
                {statFor(stats.purchases, p.id)} {statFor(stats.purchases, p.id) === 1 ? 'acquisto' : 'acquisti'}
              </span>
              <span className="mono" style={styles.chip}>
                {statFor(stats.housesBuilt, p.id)} costruzion{statFor(stats.housesBuilt, p.id) === 1 ? 'e' : 'i'}
              </span>
              <span className="mono" style={styles.chip}>
                {statFor(stats.laps, p.id)} gir{statFor(stats.laps, p.id) === 1 ? 'o' : 'i'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', marginTop: 6 },
  headline: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', fontSize: '0.78rem', color: 'rgba(243,234,216,0.75)' },
  headlineItem: { whiteSpace: 'nowrap' },
  players: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(201,150,44,0.12)' },
  // Il giocatore che sta guardando il riepilogo si riconosce a colpo d'occhio.
  rowMine: { border: '1px solid rgba(201,150,44,0.4)' },
  rowHead: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  token: { fontSize: '1rem' },
  name: { fontSize: '0.85rem', fontWeight: 600 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '4px 10px' },
  chip: { fontSize: '0.72rem', color: 'rgba(243,234,216,0.7)' },
};
