import { AwaitingRent, BoardSquare, GameState, inviaAzione } from '../socket';
import { GROUP_COLORS } from '../groupColors';
import { TOUCH_TARGET } from '../touchTarget';
import { LAYER } from '../layers';

/**
 * L'affitto dovuto, mostrato prima che il denaro cambi di mano. Prima veniva
 * addebitato in silenzio: il saldo calava senza spiegazione e sembrava che
 * atterrare su una proprietà altrui non costasse nulla.
 *
 * App.tsx la monta per tutti al tavolo, non solo per chi paga: chi guarda e
 * basta vede comunque il fatto invece della sola striscia discreta. Per
 * questo il testo qui sotto distingue TRE casi, non due — "paghi tu" e
 * "incassi tu" non bastano appena si è in tre o più (cioè sempre, con i bot):
 * un terzo giocatore che guarda un affitto tra altri due non è né chi paga né
 * chi incassa, e un testo pensato solo per quei due ("X deve pagarTI") gli
 * mentirebbe. Era esattamente il difetto segnalato: non va reintrodotto
 * scrivendo di nuovo un `isPayer ? ... : ...` a due rami.
 */
export default function RentModal({
  pending,
  square,
  state,
  myId,
}: {
  pending: AwaitingRent;
  square: BoardSquare | undefined;
  state: GameState;
  myId: string;
}) {
  const payer = state.players.find((p) => p.id === pending.playerId);
  const owner = state.players.find((p) => p.id === pending.ownerId);
  const isPayer = pending.playerId === myId;
  const isOwner = pending.ownerId === myId;
  const bandColor = square?.group ? GROUP_COLORS[square.group] : 'var(--brass)';

  // Quanto resterebbe dopo aver pagato: se è negativo si aprirà un debito, e
  // conviene saperlo prima di premere. Ha senso solo per chi paga: per gli
  // altri due casi non si mostra.
  const dopo = (payer?.balance ?? 0) - pending.amount;

  return (
    <div className="scrim" style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <div style={{ ...styles.band, background: bandColor }} />

        <span style={styles.eyebrow}>affitto da pagare</span>
        <h2 style={styles.title}>{square?.name || 'Proprietà'}</h2>
        <p className="mono" style={styles.amount}>€{pending.amount}</p>

        {pending.doubled && <p style={styles.doubled}>Raddoppiato dalla carta pescata</p>}

        {/* Tre casi distinti: pago io, incasso io, sto solo guardando (e qui
            servono entrambi i nomi, altrimenti si torna al difetto vecchio). */}
        <p style={styles.who}>
          {isPayer
            ? `Da versare a ${owner?.name}.`
            : isOwner
              ? `${payer?.name} deve pagarti.`
              : `${payer?.name} paga €${pending.amount} a ${owner?.name}.`}
        </p>

        {isPayer ? (
          <>
            {dopo < 0 && (
              <p style={styles.warning}>
                Non ti basta: dopo il pagamento dovrai vendere o ipotecare.
              </p>
            )}
            <button
              className="btn-primary"
              style={styles.button}
              onClick={() => inviaAzione('pay_rent')}
            >
              Paga €{pending.amount}
            </button>
          </>
        ) : (
          <p style={styles.wait}>In attesa che {payer?.name} paghi…</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: LAYER.decisione, padding: 20 },
  card: { width: 320, maxWidth: '100%', padding: '0 24px 24px', textAlign: 'center', overflow: 'hidden' },
  band: { height: 12, margin: '0 -24px 18px' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#e18a8a' },
  title: { fontSize: '1.3rem', marginTop: 8 },
  amount: { fontSize: '2.2rem', color: 'var(--brass-2)', margin: '10px 0 0' },
  doubled: { fontSize: '0.75rem', color: 'var(--brass-2)', margin: '6px 0 0', fontStyle: 'italic' },
  who: { fontSize: '0.86rem', color: 'rgba(243,234,216,0.7)', margin: '12px 0 0' },
  warning: { fontSize: '0.78rem', color: '#e18a8a', margin: '14px 0 0', lineHeight: 1.4 },
  button: { width: '100%', minHeight: TOUCH_TARGET, marginTop: 20, fontSize: '1rem' },
  wait: { color: 'rgba(243,234,216,0.6)', fontSize: '0.85rem', margin: '18px 0 0' },
};
