import { AwaitingAuction, BoardSquare, GameState } from '../socket';
import BottoneAzione from './BottoneAzione';
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
  // Il minimo lo dice il motore e non si ricalcola qui. Prima questa riga
  // faceva `currentBid + 10`, ma lo scatto minimo cresce col listino della
  // casella: su 24 caselle su 28 il bottone mandava un'offerta sotto il minimo,
  // il motore la rifiutava, e siccome l'invio non guardava la risposta non
  // succedeva assolutamente nulla — sembrava che il tasto fosse morto e che
  // rilanciassero solo i bot, che invece la soglia la leggevano da qui.
  const minBid = pending.minBid;
  const puoRilanciare = !!me && me.balance >= minBid;

  return (
    <div className="scrim" style={styles.overlay}>
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
            <span style={styles.bidLabel}>nessuna offerta ancora: si parte da €{pending.minBid}</span>
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
            {/* Si guarda la risposta del server invece di sparare e sperare:
                un rifiuto silenzioso è indistinguibile da un bottone rotto, ed
                è esattamente così che questo difetto è passato inosservato.
                La callback scritta a mano qui era il prototipo; adesso che
                TUTTE le azioni passano da inviaAzione (vedi socket.ts) il
                messaggio e la sua scomparsa li gestisce un posto solo, e
                questa finestra torna a occuparsi solo dell'asta.
                In un'asta il doppio rilancio è il rischio più concreto di tutta
                la partita — si ripreme perché sembra non essere successo nulla,
                e il secondo tocco parte sull'importo vecchio, ormai sotto il
                minimo — quindi qui il comando spento durante l'attesa vale
                doppio. */}
            <BottoneAzione
              evento="auction_bid"
              payload={{ amount: minBid }}
              style={styles.actionBtn}
              disabled={!puoRilanciare}
            >
              Rilancia a €{minBid}
            </BottoneAzione>
            <BottoneAzione evento="auction_pass" className="btn-ghost" style={styles.actionBtn}>
              Passa
            </BottoneAzione>
          </div>
        ) : (
          <p style={styles.wait}>
            {nameOf(pending.playerId)} sta decidendo se rilanciare...
          </p>
        )}

        {isMyTurn && !puoRilanciare && (
          <p style={styles.wait}>Non ti bastano i contanti per arrivare a €{minBid}: puoi solo passare.</p>
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
  overlay: { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: LAYER.decisione, padding: 20, overflowY: 'auto' },
  card: { padding: 28, width: 420, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--brass)' },
  title: { fontSize: '1.5rem', color: 'var(--ink)' },
  price: { fontSize: '0.9rem', color: 'rgba(27,36,48,0.6)' },
  bidBox: { display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 10, background: 'rgba(27,36,48,0.05)', border: '1px solid rgba(27,36,48,0.12)' },
  bidLabel: { fontSize: '0.74rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(27,36,48,0.55)' },
  bidValue: { fontSize: '1.3rem', color: 'var(--brass)' },
  // minHeight: 0 è ciò che rende comprimibile questo blocco: senza, un figlio
  // flex non si restringe sotto il proprio contenuto ed esce dalla card.
  participants: { display: 'flex', flexWrap: 'wrap', gap: 6, overflowY: 'auto', minHeight: 0, paddingTop: 4, paddingBottom: 4 },
  // chipTurn ripete l'intero "border" (non solo borderColor): mescolare la
  // forma abbreviata e quella estesa sulla stessa proprietà fa litigare React
  // a ogni nuovo render, con un warning in console a ogni cambio di turno.
  chip: { fontSize: '0.78rem', padding: '4px 10px', borderRadius: 999, background: 'rgba(27,36,48,0.04)', border: '1px solid rgba(27,36,48,0.15)', color: 'var(--ink)' },
  chipTurn: { background: 'rgba(201,150,44,0.15)', border: '1px solid var(--brass)', color: 'var(--brass)' },
  chipOut: { fontSize: '0.78rem', padding: '4px 10px', borderRadius: 999, background: 'rgba(27,36,48,0.02)', border: '1px solid rgba(27,36,48,0.08)', color: 'rgba(27,36,48,0.4)', textDecoration: 'line-through' },
  // flexShrink: 0 tiene i comandi fuori dall'area che scorre: Rilancia e
  // Passa restano raggiungibili qualunque sia la lunghezza dell'elenco.
  actions: { display: 'flex', gap: 10, flexShrink: 0 },
  actionBtn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
  wait: { color: 'rgba(27,36,48,0.5)', fontSize: '0.85rem', margin: 0 },
};
