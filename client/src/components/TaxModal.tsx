import { AwaitingTax, BoardSquare, GameState, socket } from '../socket';
import { TOUCH_TARGET } from '../touchTarget';

/**
 * La tassa dovuta, mostrata prima del pagamento. Stesso trattamento
 * dell'affitto: prima il denaro se ne andava senza che nessuno lo vedesse.
 *
 * Come RentModal, App.tsx la monta solo per chi deve pagare: per gli altri al
 * tavolo non c'è nessuna decisione da prendere qui, solo un fatto ("X paga la
 * tassa") che passa nella striscia degli eventi.
 */
export default function TaxModal({
  pending,
  square,
  state,
}: {
  pending: AwaitingTax;
  square: BoardSquare | undefined;
  state: GameState;
}) {
  const payer = state.players.find((p) => p.id === pending.playerId);
  const dopo = (payer?.balance ?? 0) - pending.amount;

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <div style={styles.band} />

        <span style={styles.eyebrow}>tassa da pagare</span>
        <h2 style={styles.title}>{square?.name || 'Tassa'}</h2>
        <p className="mono" style={styles.amount}>€{pending.amount}</p>
        <p style={styles.who}>Vanno alla banca.</p>

        {dopo < 0 && (
          <p style={styles.warning}>
            Non ti basta: dopo il pagamento dovrai vendere o ipotecare.
          </p>
        )}
        <button
          className="btn-primary"
          style={styles.button}
          onClick={() => socket.emit('pay_tax', {})}
        >
          Paga €{pending.amount}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 26, padding: 20 },
  card: { width: 320, maxWidth: '100%', padding: '0 24px 24px', textAlign: 'center', overflow: 'hidden' },
  // Le tasse non hanno un colore di gruppo: si usa il rosso del pagamento.
  band: { height: 12, margin: '0 -24px 18px', background: 'var(--danger)' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#e18a8a' },
  title: { fontSize: '1.3rem', marginTop: 8 },
  amount: { fontSize: '2.2rem', color: 'var(--brass-2)', margin: '10px 0 0' },
  who: { fontSize: '0.86rem', color: 'rgba(243,234,216,0.7)', margin: '12px 0 0' },
  warning: { fontSize: '0.78rem', color: '#e18a8a', margin: '14px 0 0', lineHeight: 1.4 },
  button: { width: '100%', minHeight: TOUCH_TARGET, marginTop: 20, fontSize: '1rem' },
};
