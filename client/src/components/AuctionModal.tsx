import { AwaitingAuction, BoardSquare, GameState, socket } from '../socket';
import { TOUCH_TARGET } from '../touchTarget';
import { LAYER } from '../layers';

/**
 * Finestra dell'asta sulla proprietà appena rifiutata. A turni, senza
 * timer: si gira in ordine di tavolo e chi deve rispondere adesso vede i
 * comandi, gli altri vedono solo a che punto sta l'asta. Come per il debito e
 * lo scambio, congela la partita per tutti finché non si chiude da sé.
 */
export default function AuctionModal({
  pending,
  square,
  state,
  myId,
}: {
  pending: AwaitingAuction;
  square?: BoardSquare;
  state: GameState;
  myId: string;
}) {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name || '?';
  const isMyTurn = pending.playerId === myId;
  const me = state.players.find((p) => p.id === myId);
  // Base d'asta 10, poi sempre almeno 10 in più dell'offerta corrente.
  const minBid = pending.currentBid === 0 ? 10 : pending.currentBid + 10;
  const puoRilanciare = !!me && me.balance >= minBid;

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>asta</span>
        <h2 style={styles.title}>{square?.name || `Casella ${pending.position}`}</h2>
        <p className="mono" style={styles.price}>listino €{pending.price}</p>

        <div style={styles.bidBox}>
          {pending.currentBidderId ? (
            <>
              <span style={styles.bidLabel}>offerta più alta</span>
              <span className="mono" style={styles.bidValue}>
                €{pending.currentBid} — {nameOf(pending.currentBidderId)}
              </span>
            </>
          ) : (
            <span style={styles.bidLabel}>nessuna offerta ancora: si parte da €10</span>
          )}
        </div>

        <div style={styles.participants}>
          {pending.queue.map((id) => (
            <span
              key={id}
              style={{
                ...styles.chip,
                ...(id === pending.playerId ? styles.chipTurn : null),
              }}
            >
              {nameOf(id)}
              {id === pending.playerId ? ' · tocca a lei/lui' : ''}
            </span>
          ))}
          {pending.passedIds.map((id) => (
            <span key={id} style={styles.chipOut}>
              {nameOf(id)} · ha passato
            </span>
          ))}
        </div>

        {isMyTurn ? (
          <div style={styles.actions}>
            <button
              className="btn-primary"
              style={styles.actionBtn}
              disabled={!puoRilanciare}
              onClick={() => socket.emit('auction_bid', { amount: minBid })}
            >
              Rilancia a €{minBid}
            </button>
            <button
              className="btn-ghost"
              style={styles.actionBtn}
              onClick={() => socket.emit('auction_pass', {})}
            >
              Passa
            </button>
          </div>
        ) : (
          <p style={styles.wait}>
            {nameOf(pending.playerId)} sta decidendo se rilanciare...
          </p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Stesso schema delle altre finestre che congelano il turno (debito,
  // scambio): la card si accorcia entro il viewport e solo l'elenco dei
  // partecipanti scorre, con i comandi sempre raggiungibili fuori dallo
  // scorrimento. Qui pesa quanto per il debito: un'asta bloccata pianta la
  // partita per tutti, non solo per chi sta offrendo.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: LAYER.decisione, padding: 20, overflowY: 'auto' },
  card: { padding: 28, width: 420, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.5rem' },
  price: { fontSize: '0.9rem', color: 'rgba(243,234,216,0.6)' },
  bidBox: { display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(201,150,44,0.2)' },
  bidLabel: { fontSize: '0.74rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.55)' },
  bidValue: { fontSize: '1.3rem', color: 'var(--brass-2)' },
  // minHeight: 0 è ciò che rende comprimibile questo blocco: senza, un figlio
  // flex non si restringe sotto il proprio contenuto ed esce dalla card.
  participants: { display: 'flex', flexWrap: 'wrap', gap: 6, overflowY: 'auto', minHeight: 0, paddingTop: 4, paddingBottom: 4 },
  // chipTurn ripete l'intero "border" (non solo borderColor): mescolare la
  // forma abbreviata e quella estesa sulla stessa proprietà fa litigare React
  // a ogni nuovo render, con un warning in console a ogni cambio di turno.
  chip: { fontSize: '0.78rem', padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(201,150,44,0.2)' },
  chipTurn: { background: 'rgba(201,150,44,0.22)', border: '1px solid var(--brass)', color: 'var(--brass-2)' },
  chipOut: { fontSize: '0.78rem', padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(243,234,216,0.4)', textDecoration: 'line-through' },
  // flexShrink: 0 tiene i comandi fuori dall'area che scorre: Rilancia e
  // Passa restano raggiungibili qualunque sia la lunghezza dell'elenco.
  actions: { display: 'flex', gap: 10, flexShrink: 0 },
  actionBtn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
  wait: { color: 'rgba(243,234,216,0.6)', fontSize: '0.85rem', margin: 0 },
};
