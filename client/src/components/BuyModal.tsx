import { AwaitingBuy, BoardSquare, GameState, inviaAzione } from '../socket';
import { LAYER } from '../layers';

/**
 * Proprietà libera su cui comprare o rinunciare. App.tsx la monta per tutti al
 * tavolo (i giocatori preferiscono vedere il banner anche per i fatti altrui,
 * non solo la striscia discreta): chi è atterrato lì vede i comandi, chi
 * guarda soltanto vede chi sta decidendo, senza bottoni che non gli servono.
 */
export default function BuyModal({
  pending,
  square,
  state,
  myId,
}: {
  pending: AwaitingBuy;
  square: BoardSquare;
  state: GameState;
  myId: string;
}) {
  const isMe = pending.playerId === myId;
  const decider = state.players.find((p) => p.id === pending.playerId);

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>proprietà libera</span>
        <h2 style={styles.title}>{square.name}</h2>
        <p className="mono" style={styles.price}>€{pending.price}</p>
        {isMe ? (
          <div style={styles.actions}>
            {/* "Saldo insufficiente" arriva solo dal server: qui non si
                sconta nulla a mano, e senza guardare la risposta il tasto
                Compra restava muto proprio quando serviva capire. */}
            <button className="btn-primary" onClick={() => inviaAzione('buy_property')}>
              Compra
            </button>
            <button className="btn-ghost" onClick={() => inviaAzione('decline_buy')}>
              Rinuncia
            </button>
          </div>
        ) : (
          <p style={styles.wait}>{decider?.name || 'L\'altro giocatore'} sta decidendo...</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: LAYER.decisione },
  card: { padding: 32, width: 320, textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.6rem', marginTop: 8 },
  price: { fontSize: '1.8rem', color: 'var(--brass-2)', marginTop: 10 },
  actions: { display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22 },
  wait: { color: 'rgba(243,234,216,0.6)', fontSize: '0.85rem', margin: '18px 0 0' },
};
