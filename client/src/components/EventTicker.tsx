import { useEffect, useRef, useState } from 'react';
import { GameState } from '../socket';
import { latestLogAt, missedSince } from '../awayRecap';
import { capTickerQueue, TickerItem, visibleTickerEntries } from '../eventTicker';

/**
 * Striscia discreta per i fatti che non riguardano una decisione di chi
 * guarda: "Bot Aurelio paga 110 a Giulia". Non copre nulla, non smonta
 * niente — a differenza dei modali legati a un `pendingAction`, che ora
 * restano solo per chi deve davvero decidere (vedi App.tsx). Ogni voce
 * scorre via da sola dopo qualche secondo.
 *
 * Le frasi vengono prese di peso dal registro del server (`state.log`): è il
 * motore a generarle, dice sempre chi fa cosa a chi, ed è già la fonte unica
 * di verità sulle regole di gioco. Ricostruirle qui vorrebbe dire duplicare
 * quella logica lato client — esattamente il tipo di doppione che in questo
 * progetto si è scelto di evitare tenendo ogni regola sul server.
 */
export default function EventTicker({ log, isMobile }: { log: GameState['log']; isMobile: boolean }) {
  // Punto del registro già mostrato: parte da "il più avanzato che c'è già"
  // (non da null, che per missedSince vorrebbe dire "niente segnalibro,
  // quindi niente da filtrare" cioè tutta la storia della partita) così al
  // montaggio — a partita già in corso, per esempio dopo un rientro — non si
  // riversano in coda tutte le righe passate in un colpo solo.
  const bookmarkRef = useRef<number | null>(null);
  const nextIdRef = useRef(0);
  const [queue, setQueue] = useState<TickerItem[]>([]);

  useEffect(() => {
    if (bookmarkRef.current === null) {
      bookmarkRef.current = latestLogAt(log, null);
      return;
    }
    const nuove = missedSince(log, bookmarkRef.current);
    bookmarkRef.current = latestLogAt(log, bookmarkRef.current);
    if (nuove.length === 0) return;
    setQueue((coda) =>
      capTickerQueue([
        ...coda,
        ...nuove.map((entry) => ({ id: nextIdRef.current++, message: entry.message, shownAt: Date.now() })),
      ])
    );
  }, [log]);

  // Un intervallo, non un setTimeout per voce: la pulizia non deve essere
  // precisa al millisecondo, e un solo timer per tutta la coda è più semplice
  // da tenere corretto quando le voci si accavallano.
  useEffect(() => {
    const id = setInterval(() => {
      setQueue((coda) => (coda.length === 0 ? coda : visibleTickerEntries(coda, Date.now())));
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (queue.length === 0) return null;

  return (
    <div
      style={{ ...styles.wrap, ...(isMobile ? styles.wrapMobile : styles.wrapDesktop) }}
      aria-live="polite"
    >
      {queue.map((item) => (
        <div key={item.id} className="panel" style={styles.item}>
          {item.message}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // `pointerEvents: none` è voluto: la striscia non deve rubare nemmeno un
  // tocco a quello che c'è sotto, a differenza di un modale che invece deve
  // essere interagibile.
  wrap: {
    position: 'fixed',
    top: 'calc(10px + env(safe-area-inset-top))',
    zIndex: 45,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    pointerEvents: 'none',
  },
  // Su computer la barra dei comandi (GamePanel) sta di lato, non in alto:
  // un angolo in alto a destra, largo poco, non ci si sovrappone mai.
  wrapDesktop: { right: 16, width: 280 },
  // Su telefono la barra dei comandi sta fissa in fondo (MobileBar): la
  // striscia resta in alto, larga quasi quanto lo schermo, e non la
  // raggiunge mai.
  wrapMobile: { left: 10, right: 10 },
  item: {
    padding: '9px 12px',
    fontSize: '0.8rem',
    lineHeight: 1.35,
    borderLeft: '3px solid var(--brass)',
    boxShadow: 'var(--shadow-soft)',
    opacity: 0.96,
  },
};
