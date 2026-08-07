import { TOUCH_TARGET } from '../touchTarget';
import { LAYER } from '../layers';

/**
 * Riepilogo di ciò che è successo nel registro mentre il giocatore era
 * disconnesso. Senza questo riquadro si rientra su un tabellone diverso da
 * come lo si era lasciato — saldi cambiati, pedine spostate — senza sapere
 * perché: il registro completo c'è già altrove nell'interfaccia, ma è lungo e
 * non dice da dove riprendere a leggere. Qui invece ci sono solo le righe
 * nuove, in ordine cronologico (prima le più vecchie) perché si legge come un
 * piccolo racconto di quello che ci si è persi, non come il log dal vivo che
 * mostra le ultime notizie in cima.
 */
export default function AwayRecapModal({
  entries,
  onClose,
}: {
  entries: { message: string; at: number }[];
  onClose: () => void;
}) {
  return (
    <div className="scrim" style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>bentornato</span>
        <h2 style={styles.title}>Mentre non c'eri</h2>
        <p style={styles.count}>
          {entries.length} {entries.length === 1 ? 'cosa è successa' : 'cose sono successe'} durante la disconnessione.
        </p>

        <div style={styles.listScroll}>
          {entries.map((entry, i) => (
            <div key={i} style={styles.logLine}>{entry.message}</div>
          ))}
        </div>

        <div style={styles.actions}>
          <button className="btn-primary" style={styles.closeBtn} onClick={onClose}>
            Ho capito
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Stesso schema di TradeOfferModal/DebtModal: `alignItems: flex-start` più
  // `overflowY: auto` sull'overlay evitano che, su schermi bassi, la card
  // trabocchi da sopra dove nessuno scorrimento la raggiungerebbe più.
  overlay: { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: LAYER.riepilogoRientro, padding: 20, overflowY: 'auto' },
  // `margin: auto` centra quando c'è spazio e collassa quando non ce n'è,
  // lasciando che sia l'overlay a tenere la card attaccata in alto.
  card: { padding: 26, width: 440, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass)' },
  title: { fontSize: '1.4rem' },
  count: { fontSize: '0.8rem', color: 'rgba(27,36,48,0.6)', margin: 0 },
  // minHeight: 0 è ciò che manca di solito quando questi riquadri traboccano:
  // senza, un figlio flex non si restringe sotto il proprio contenuto e
  // l'elenco spinge i bottoni fuori dallo schermo invece di scorrere lui.
  listScroll: { overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '48vh', paddingRight: 4, borderTop: '1px solid rgba(27,36,48,0.12)', borderBottom: '1px solid rgba(27,36,48,0.12)', paddingTop: 10, paddingBottom: 10 },
  logLine: { fontSize: '0.82rem', color: 'rgba(27,36,48,0.75)', borderLeft: '2px solid rgba(201,150,44,0.4)', paddingLeft: 9 },
  // flexShrink: 0 tiene il bottone fuori dall'area che scorre, sempre
  // raggiungibile qualunque sia la lunghezza del riepilogo.
  actions: { display: 'flex', flexShrink: 0 },
  closeBtn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
};
