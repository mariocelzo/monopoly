import { useEffect } from 'react';
import { azzeraRifiuto, useRifiutoAzione } from '../azioni';
import { LAYER } from '../layers';

/**
 * Quanto resta a schermo un avviso non toccato. Cinque secondi: il tempo di
 * leggere una riga alzando gli occhi da dove si stava premendo, senza che poi
 * resti lì appeso a raccontare una cosa vecchia.
 */
export const DURATA_AVVISO_MS = 5000;

/**
 * L'avviso di rifiuto, uno solo per tutta l'applicazione (vedi azioni.ts per il
 * perché il canale sia un modulo e non un context).
 *
 * Scelte di posizione, tutte per lo stesso motivo — deve farsi leggere senza
 * mettersi in mezzo:
 *
 * - **fisso in alto al centro**, dove sta già la barra della connessione persa:
 *   questo gioco insegna che i messaggi rossi compaiono lì. Il basso era
 *   escluso: su telefono ci vive la barra dei comandi (MobileBar.tsx), e un
 *   avviso lì sopra coprirebbe proprio i bottoni che si stanno premendo.
 * - **position: fixed**, quindi non occupa spazio nel flusso: su telefono il
 *   tabellone, la striscia del registro e la barra restano esattamente dove
 *   sono. Nessuno viene spinto via, l'avviso galleggia e basta.
 * - **pointerEvents: 'none'**: anche quando finisce sopra qualcosa, i tocchi
 *   gli passano attraverso. Non può rubare un clic al comando che copre — che
 *   sarebbe il modo più beffardo di reintrodurre il difetto che risolve.
 * - **sopra ogni finestra** (vedi LAYER.avvisoAzione): quasi tutti i rifiuti
 *   nascono dai bottoni delle finestre che congelano il turno (asta, debito,
 *   scambio); sotto di loro non lo leggerebbe nessuno.
 *
 * `sottoBanner` lo abbassa quando la barra rossa della connessione persa è
 * visibile: sono entrambi fissi in alto, e senza si sovrapporrebbero.
 */
export default function AvvisoAzione({ sottoBanner = false }: { sottoBanner?: boolean }) {
  const rifiuto = useRifiutoAzione();
  const seq = rifiuto?.seq;

  // Il conto alla rovescia sta qui e non nel canale: quanto a lungo si vede una
  // cosa è una questione di schermo, e tenerlo fuori da azioni.ts lascia quel
  // modulo senza timer, quindi verificabile in logic-test.ts sotto Node.
  // Dipende da `seq` e non dall'oggetto: se ripremendo lo stesso bottone arriva
  // due volte lo stesso messaggio, il timer riparte da capo invece di lasciar
  // sparire l'avviso mentre lo si sta ancora leggendo.
  useEffect(() => {
    if (seq === undefined) return;
    const timer = setTimeout(azzeraRifiuto, DURATA_AVVISO_MS);
    return () => clearTimeout(timer);
  }, [seq]);

  if (!rifiuto) return null;

  return (
    <div
      // La chiave sul `seq` rimonta l'elemento a ogni nuovo rifiuto: è ciò che
      // fa ripartire l'animazione d'entrata anche quando il testo è identico al
      // precedente, cioè quando serve di più — si sta ripremendo un bottone
      // credendo che non funzioni.
      key={rifiuto.seq}
      className="avviso-azione"
      // role/aria-live: chi usa un lettore di schermo deve sentire il rifiuto,
      // altrimenti per lui il bottone resta muto come prima. "polite" e non
      // "assertive": non interrompe a metà la lettura in corso.
      role="status"
      aria-live="polite"
      style={{
        ...styles.avviso,
        top: sottoBanner
          ? 'calc(env(safe-area-inset-top) + 44px)'
          : 'calc(env(safe-area-inset-top) + 10px)',
      }}
    >
      {rifiuto.testo}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  avviso: {
    position: 'fixed',
    // left/right + margin auto invece di `left: 50%` con la traslazione: qui
    // la larghezza la decide il testo entro un massimo, e su uno schermo
    // stretto l'avviso si limita da solo ai bordi senza uscire di lato.
    left: 12,
    right: 12,
    margin: '0 auto',
    maxWidth: 380,
    width: 'fit-content',
    zIndex: LAYER.avvisoAzione,
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    // Non il rosso pieno del pericolo della barra di connessione: quello vuol
    // dire "il gioco non risponde". Qui il gioco risponde eccome — sta dicendo
    // di no — quindi fondo scuro e bordo rosso, un'annotazione, non un allarme.
    background: 'rgba(24, 14, 14, 0.94)',
    border: '1px solid var(--danger)',
    boxShadow: 'var(--shadow-card)',
    color: 'var(--paper)',
    fontSize: '0.85rem',
    lineHeight: 1.35,
    textAlign: 'center',
    pointerEvents: 'none',
  },
};
