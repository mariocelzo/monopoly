import { AwaitingCard, GameState, inviaAzione } from '../socket';
import { TOUCH_TARGET } from '../touchTarget';
import { LAYER } from '../layers';

// Imprevisti e Probabilità hanno colori e simboli distinti, come i due mazzi
// sul tabellone vero.
const DECKS = {
  chance: { label: 'Imprevisti', symbol: '?', accent: '#F7941D' },
  community: { label: 'Probabilità', symbol: '◆', accent: '#7EC8E3' },
} as const;

/**
 * La carta pescata, mostrata prima che il suo effetto si applichi. È il pezzo
 * che mancava: gli effetti scattavano invisibili e la pedina sembrava spostarsi
 * per conto suo.
 *
 * App.tsx la monta per tutti al tavolo: solo chi l'ha pescata ha un bottone da
 * premere ("Ho capito"), chi guarda soltanto vede il testo della carta e chi
 * la sta leggendo, senza un comando che non gli spetta.
 */
export default function CardModal({
  pending,
  state,
  myId,
}: {
  pending: AwaitingCard;
  state: GameState;
  myId: string;
}) {
  const drawer = state.players.find((p) => p.id === pending.playerId);
  const isMine = pending.playerId === myId;
  const deck = DECKS[pending.deck] || DECKS.chance;

  return (
    <div className="scrim" style={styles.overlay}>
      <div className="panel" style={{ ...styles.card, borderColor: deck.accent }}>
        <div style={{ ...styles.ribbon, background: deck.accent }}>
          <span style={styles.ribbonText}>{deck.label}</span>
        </div>

        <span style={{ ...styles.symbol, color: deck.accent }}>{deck.symbol}</span>
        <p style={styles.text}>{pending.text}</p>

        {isMine ? (
          <button
            className="btn-primary"
            style={styles.button}
            onClick={() => inviaAzione('acknowledge_card')}
          >
            Ho capito
          </button>
        ) : (
          <p style={styles.wait}>{drawer?.name} sta leggendo la carta…</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: LAYER.decisione, padding: 20 },
  card: { width: 330, maxWidth: '100%', padding: '0 24px 24px', textAlign: 'center', borderWidth: 2, borderStyle: 'solid', overflow: 'hidden' },
  ribbon: { margin: '0 -24px 18px', padding: '8px 0' },
  ribbonText: { fontFamily: 'var(--font-mono)', fontSize: '0.72rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.7)', fontWeight: 700 },
  symbol: { fontFamily: 'var(--font-display)', fontSize: '2.6rem', lineHeight: 1, display: 'block' },
  text: { fontSize: '1.05rem', lineHeight: 1.5, color: 'var(--paper)', margin: '14px 0 22px' },
  button: { width: '100%', minHeight: TOUCH_TARGET },
  wait: { color: 'rgba(243,234,216,0.6)', fontSize: '0.85rem', margin: 0 },
};
