import { useEffect, useRef, useState } from 'react';
import { GameState } from '../socket';

// Altezza di una riga di registro (font-size + line-height) e spazio fra le
// righe: servono a calcolare quante righe entrano nello spazio disponibile,
// vedi useVisibleRows più sotto. Devono restare in sincronia con styles.line.
const ROW_HEIGHT = 17;
const ROW_GAP = 4;

/**
 * Quante righe di registro entrano nell'altezza misurata, arrotondato per
 * difetto. Si ricalcola solo quando lo spazio disponibile cambia davvero
 * (rotazione dello schermo, resize): mai per una riga di log in più, altrimenti
 * il tabellone sopra ballerebbe a ogni mossa dei bot invece di stare fermo.
 */
function useVisibleRows(ref: React.RefObject<HTMLDivElement>): number {
  const [rows, setRows] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = (height: number) => {
      const n = Math.floor((height + ROW_GAP) / (ROW_HEIGHT + ROW_GAP));
      setRows(Math.max(0, n));
    };
    const observer = new ResizeObserver(([entry]) => compute(entry.contentRect.height));
    observer.observe(el);
    compute(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [ref]);
  return rows;
}

/**
 * Striscia sottile fra il tabellone e la barra dei comandi, su telefono.
 * Prima quello spazio era vuoto (fino a 150px di feltro senza nulla né sopra
 * né sotto il tabellone); ora ci scorrono le ultime righe del registro, così
 * si vede cosa succede senza aprire il foglio "Registro" sotto "🏠 Proprietà"
 * — due tocchi, in un gioco dove i bot muovono da soli ogni 1,7–3 secondi.
 *
 * Riempie lo spazio con flex: 1 e misura da sé quante righe ci stanno:
 * nessun numero fisso, che su un telefono basso (es. iPhone SE) spingerebbe
 * il tabellone fuori schermo o sotto la barra dei comandi.
 */
export default function LogStrip({ log }: { log: GameState['log'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useVisibleRows(ref);

  // Più recente in cima, come nel foglio "Registro" di MobileBar (stesso
  // slice().reverse()): chi guarda qui sotto vuole l'ultima cosa successa
  // subito, non scorrere per trovarla — e qui non si può nemmeno scorrere.
  const visible = rows > 0 ? log.slice(-rows).reverse() : [];

  return (
    <div ref={ref} style={styles.strip}>
      {visible.map((entry, i) => (
        // entry.at è in millisecondi: due eventi nello stesso istante sono
        // rarissimi ma non impossibili (es. bot successivi), l'indice
        // spareggia la chiave.
        <div key={`${entry.at}-${i}`} style={styles.line}>{entry.message}</div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // alignSelf: stretch la allarga quanto il tabellone sopra (stessa larghezza
  // di contenuto del contenitore flex in App.tsx, senza duplicare la formula
  // di boardWidth calcolata in Board.tsx). flex: 1 prende esattamente lo
  // spazio verticale che resta libero fra tabellone e barra; minHeight: 0
  // permette alla striscia di restringersi sotto il proprio contenuto
  // naturale invece di spingere il tabellone fuori schermo su un telefono
  // basso — lo stesso trucco usato per winScroll in App.tsx.
  strip: {
    flex: '1 1 auto',
    minHeight: 0,
    alignSelf: 'stretch',
    display: 'flex',
    flexDirection: 'column',
    gap: ROW_GAP,
    overflow: 'hidden',
    padding: '6px 2px 0',
    fontFamily: 'var(--font-mono)',
  },
  // Testo piccolo e poco contrasto apposta: è un contorno, non un pannello,
  // il tabellone resta il protagonista. Una riga sola per evento, troncata
  // con ellissi se il messaggio è più largo della striscia — mai due righe,
  // altrimenti il conteggio di useVisibleRows non corrisponderebbe più a
  // quanto renderizzato davvero.
  line: {
    fontSize: '0.68rem',
    lineHeight: `${ROW_HEIGHT}px`,
    color: 'rgba(243,234,216,0.4)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
