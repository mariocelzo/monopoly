import { AwaitingDebt, BoardSquare, GameState, socket } from '../socket';
import PropertiesPanel from './PropertiesPanel';

/**
 * Modale di risoluzione del debito. Al debitore offre le tre strade previste dal
 * motore: liquidare a mano dal pannello proprietà, lasciar liquidare in
 * automatico, oppure arrendersi. All'avversario mostra solo l'attesa, perché un
 * debito aperto congela la partita per entrambi.
 */
export default function DebtModal({
  pending,
  board,
  state,
  myId,
}: {
  pending: AwaitingDebt;
  board: BoardSquare[];
  state: GameState;
  myId: string;
}) {
  const debtor = state.players.find((p) => p.id === pending.playerId);
  const isMe = pending.playerId === myId;

  if (!isMe) {
    return (
      <div style={styles.overlay}>
        <div className="panel" style={styles.waitCard}>
          <span style={styles.eyebrow}>debito in sospeso</span>
          <h2 style={styles.title}>{debtor?.name} deve €{pending.amount}</h2>
          <p style={styles.wait}>
            Sta decidendo cosa vendere o ipotecare. La partita riprende appena ha saldato.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>sei in rosso</span>
        <h2 style={styles.title}>Devi coprire €{pending.amount}</h2>
        <p style={styles.hint}>
          Liquidando tutto arriveresti a <strong style={styles.value}>€{pending.liquidationValue}</strong>.
          Vendi o ipoteca finché non torni in pari.
        </p>

        <div style={styles.panelScroll}>
          <PropertiesPanel board={board} state={state} myId={myId} />
        </div>

        <div style={styles.actions}>
          <button className="btn-primary" onClick={() => socket.emit('resolve_debt_auto', {})}>
            Vendi automaticamente
          </button>
          <button className="btn-ghost" onClick={() => socket.emit('declare_bankruptcy', {})}>
            Dichiara bancarotta
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, padding: 20 },
  card: { padding: 28, width: 420, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(179,58,58,0.5)' },
  waitCard: { padding: 32, width: 340, textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e18a8a' },
  title: { fontSize: '1.45rem' },
  hint: { fontSize: '0.82rem', color: 'rgba(243,234,216,0.7)', margin: 0, lineHeight: 1.5 },
  value: { color: 'var(--brass-2)', fontFamily: 'var(--font-mono)' },
  panelScroll: { overflowY: 'auto', flex: 1, paddingRight: 4, borderTop: '1px solid rgba(201,150,44,0.2)', borderBottom: '1px solid rgba(201,150,44,0.2)', paddingTop: 12, paddingBottom: 12 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  wait: { color: 'rgba(243,234,216,0.6)', marginTop: 12, fontSize: '0.85rem', lineHeight: 1.5 },
};
