import { AwaitingDebt, BoardSquare, GameState, socket } from '../socket';
import { TOUCH_TARGET } from '../touchTarget';
import PropertiesPanel from './PropertiesPanel';
import { LAYER } from '../layers';

/**
 * Modale di risoluzione del debito: al debitore offre le tre strade previste
 * dal motore per rientrare (liquidare a mano dal pannello proprietà, lasciar
 * liquidare in automatico, oppure arrendersi). App.tsx la monta per tutti al
 * tavolo: chi non è il debitore vede solo l'attesa, perché un debito aperto
 * congela la partita per tutti finché non si risolve.
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
          <button
            className="btn-primary"
            style={styles.actionBtn}
            onClick={() => socket.emit('resolve_debt_auto', {})}
          >
            Vendi automaticamente
          </button>
          <button
            className="btn-ghost"
            style={styles.actionBtn}
            onClick={() => socket.emit('declare_bankruptcy', {})}
          >
            Dichiara bancarotta
          </button>
        </div>
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
  // comprimendo l'elenco delle proprietà il contenuto fisso ci sta — viewport
  // bassissimi, testi che vanno a capo — e per i browser mobile dove 100vh non
  // coincide con l'area davvero visibile. Qui pesa più che altrove: un debito
  // congela il turno di tutti, e un bottone irraggiungibile pianta la partita.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: LAYER.decisione, padding: 20, overflowY: 'auto' },
  // `calc(100vh - 40px)` toglie i 20px di padding dell'overlay sopra e sotto:
  // con `90vh` la card poteva chiedere più dello spazio che l'overlay le lascia.
  // `margin: auto` la centra quando c'è spazio e collassa quando non ce n'è,
  // lasciando che sia `alignItems: flex-start` a tenerla attaccata in alto.
  card: { padding: 28, width: 420, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(179,58,58,0.5)' },
  // Anche la card d'attesa ha bisogno di `margin: auto`: condivide l'overlay, che
  // ora allinea in alto, e senza resterebbe incollata al bordo superiore.
  waitCard: { padding: 32, width: 340, maxWidth: '100%', margin: 'auto', textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e18a8a' },
  title: { fontSize: '1.45rem' },
  hint: { fontSize: '0.82rem', color: 'rgba(243,234,216,0.7)', margin: 0, lineHeight: 1.5 },
  value: { color: 'var(--brass-2)', fontFamily: 'var(--font-mono)' },
  // minHeight: 0 rende esplicito che questo è il solo blocco che può rimpicciolirsi:
  // di default un figlio flex non si restringe sotto il proprio contenuto e deborda
  // in silenzio. Oggi ci arriverebbe comunque, perché `overflowY: auto` annulla da
  // sé quel minimo automatico, ma così l'elenco resta comprimibile anche se un
  // domani l'overflow qui cambia.
  panelScroll: { overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: 4, borderTop: '1px solid rgba(201,150,44,0.2)', borderBottom: '1px solid rgba(201,150,44,0.2)', paddingTop: 12, paddingBottom: 12 },
  // flexShrink: 0 tiene i bottoni fuori dall'area che scorre: per quante proprietà
  // abbia il debitore, «Vendi automaticamente» e «Dichiara bancarotta» restano
  // raggiungibili — sono le uniche uscite da un turno congelato.
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', flexShrink: 0 },
  // I 46px costano spazio proprio dove ce n'è poco, ma sono le due uscite da un
  // turno congelato: a rimetterci è semmai l'elenco proprietà, che scorre.
  actionBtn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
  wait: { color: 'rgba(243,234,216,0.6)', marginTop: 12, fontSize: '0.85rem', lineHeight: 1.5 },
};
