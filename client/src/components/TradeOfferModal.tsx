import { AwaitingTrade, BoardSquare, GameState, socket } from '../socket';
import { GROUP_COLORS } from '../groupColors';

/**
 * Offerta di scambio ricevuta. Al destinatario mostra i due lati del baratto con
 * Accetta e Rifiuta; al proponente solo l'attesa, perché finché non arriva una
 * risposta la partita resta ferma per entrambi.
 */
export default function TradeOfferModal({
  pending,
  board,
  state,
  myId,
}: {
  pending: AwaitingTrade;
  board: BoardSquare[];
  state: GameState;
  myId: string;
}) {
  const from = state.players.find((p) => p.id === pending.fromId);
  const to = state.players.find((p) => p.id === pending.toId);
  const isRecipient = pending.toId === myId;

  /** Un lato del baratto: le proprietà più l'eventuale denaro. */
  const side = (title: string, positions: number[], money: number, jailCards: number) => (
    <div style={styles.side}>
      <h3 style={styles.sideTitle}>{title}</h3>
      {positions.length === 0 && money === 0 && jailCards === 0 && <p style={styles.none}>niente</p>}
      {positions.map((position) => {
        const square = board.find((s) => s.position === position);
        const owned = state.ownership[position];
        return (
          <div key={position} style={styles.row}>
            <span
              style={{
                ...styles.dot,
                background: square?.group ? GROUP_COLORS[square.group] : 'var(--brass)',
              }}
            />
            <span style={styles.rowName}>{square?.name || `Casella ${position}`}</span>
            {owned?.mortgaged && <span style={styles.mortgaged}>ipot.</span>}
          </div>
        );
      })}
      {money > 0 && <div className="mono" style={styles.money}>€{money}</div>}
      {jailCards > 0 && (
        <div style={styles.cards}>
          🔑 {jailCards} {jailCards === 1 ? 'carta uscita' : 'carte uscita'}
        </div>
      )}
    </div>
  );

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>scambio proposto</span>
        <h2 style={styles.title}>
          {isRecipient ? `${from?.name} ti propone` : `In attesa di ${to?.name}`}
        </h2>

        <div style={styles.columns}>
          {side(`${from?.name} dà`, pending.offerProperties, pending.offerMoney, pending.offerJailCards)}
          {side(`${to?.name} dà`, pending.requestProperties, pending.requestMoney, pending.requestJailCards)}
        </div>

        {isRecipient ? (
          <div style={styles.actions}>
            <button
              className="btn-primary"
              style={styles.actionBtn}
              onClick={() => socket.emit('respond_trade', { accept: true })}
            >
              Accetta
            </button>
            <button
              className="btn-ghost"
              style={styles.actionBtn}
              onClick={() => socket.emit('respond_trade', { accept: false })}
            >
              Rifiuta
            </button>
          </div>
        ) : (
          <p style={styles.wait}>{to?.name} sta decidendo...</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Su schermi bassi la finestra deve stare dentro il viewport e scorrere al
  // suo interno: `alignItems: flex-start` evita che il contenuto più alto dello
  // schermo esca da sopra, dove non lo raggiunge nessuno scorrimento.
  // L'`overflowY` qui sotto sembra ridondante col `maxHeight` della card, e non
  // lo è: non toglierlo. È la rete di sicurezza per i casi in cui nemmeno
  // comprimendo l'elenco il contenuto fisso ci sta — viewport bassissimi, nomi
  // lunghi che vanno a capo — e per i browser mobile dove 100vh non coincide
  // con l'area davvero visibile.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 25, padding: 20, overflowY: 'auto' },
  // `margin: auto` centra la finestra quando c'è spazio e collassa quando non
  // ce n'è, lasciando che sia `alignItems: flex-start` a tenerla attaccata in
  // alto invece di farla uscire da sopra.
  card: { padding: 28, width: 480, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.4rem' },
  // minHeight: 0 è indispensabile: senza, un figlio flex non si restringe sotto
  // il proprio contenuto e deborda in silenzio, che è la causa del difetto.
  columns: { display: 'flex', gap: 16, flexWrap: 'wrap', overflowY: 'auto', minHeight: 0 },
  side: { flex: '1 1 190px', display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(201,150,44,0.15)' },
  sideTitle: { fontSize: '0.74rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  none: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.4)', fontStyle: 'italic', margin: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 7 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0, border: '1px solid rgba(0,0,0,0.35)' },
  rowName: { fontSize: '0.8rem', flex: 1 },
  mortgaged: { fontSize: '0.62rem', color: '#e18a8a', fontFamily: 'var(--font-mono)' },
  money: { fontSize: '1rem', color: 'var(--brass-2)', marginTop: 4 },
  cards: { fontSize: '0.78rem', color: 'var(--paper)', marginTop: 2 },
  // flexShrink: 0 tiene i bottoni fuori dall'area che scorre: qualunque cosa ci
  // sia nel baratto, Accetta e Rifiuta restano raggiungibili.
  actions: { display: 'flex', gap: 10, flexShrink: 0 },
  wait: { color: 'rgba(243,234,216,0.6)', fontSize: '0.85rem', margin: 0 },
  actionBtn: { flex: 1, minHeight: 46, fontSize: '0.95rem' },
};
