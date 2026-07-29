import { AwaitingBuy, BoardSquare, socket } from '../socket';

/**
 * Proprietà libera su cui comprare o rinunciare. App.tsx la monta solo per
 * chi è atterrato lì (`pending.playerId === myId`): nessun altro al tavolo
 * deve decidere nulla, e il fatto ("X è su Y, libera") passa nella striscia
 * degli eventi invece che in un modale a tutto schermo.
 */
export default function BuyModal({
  pending,
  square,
}: {
  pending: AwaitingBuy;
  square: BoardSquare;
}) {
  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>proprietà libera</span>
        <h2 style={styles.title}>{square.name}</h2>
        <p className="mono" style={styles.price}>€{pending.price}</p>
        <div style={styles.actions}>
          <button className="btn-primary" onClick={() => socket.emit('buy_property', {})}>
            Compra
          </button>
          <button className="btn-ghost" onClick={() => socket.emit('decline_buy', {})}>
            Rinuncia
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  card: { padding: 32, width: 320, textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.6rem', marginTop: 8 },
  price: { fontSize: '1.8rem', color: 'var(--brass-2)', marginTop: 10 },
  actions: { display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22 },
};
