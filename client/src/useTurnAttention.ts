import { useCallback, useEffect, useRef } from 'react';
import type { GameState } from './socket';
import { isGameWaitingFor } from './turnAlert';

// Si lampeggia il titolo invece di lasciarlo fisso sul messaggio d'avviso:
// un titolo che cambia continua ad attirare l'occhio anche fra le schede di
// un browser mobile, dove si vede solo l'icona finché non si tocca.
const BLINK_MS = 1000;
const ALERT_TITLE = '🔴 Tocca a te! · Monopoly';

// Pallino rosso pieno, generato al volo come SVG inline invece che come file:
// il progetto non ha nessuna favicon impostata in `client/index.html` (né in
// una cartella `public/`), quindi non c'è nulla da sostituire e da dover poi
// rimettere a posto — si aggiunge un `<link>` solo mentre l'avviso è attivo
// e lo si toglie subito dopo, tornando così esattamente allo stato di prima
// (nessuna favicon personalizzata, l'icona di default del browser).
const ALERT_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<circle cx="16" cy="16" r="14" fill="#e0483e" stroke="#3a1410" stroke-width="2"/>' +
      '</svg>'
  );

/**
 * Avvisa chi ha lasciato la scheda in secondo piano che tocca a lui — turno
 * di gioco o `pendingAction` che lo nomina — facendo lampeggiare titolo e
 * favicon. Niente notifiche di sistema: non serve alcun permesso.
 *
 * Si attiva solo a scheda nascosta (altrimenti il titolo cambierebbe sotto
 * gli occhi di chi sta già guardando, che è solo rumore) e si disattiva da
 * solo appena la scheda torna in primo piano, o appena smette di essere il
 * turno di questo giocatore mentre è ancora altrove.
 *
 * Vedi `App.tsx` per l'altro ascoltatore di `visibilitychange` di questo
 * progetto (forza la riconnessione del socket): sono indipendenti, ognuno
 * aggiunge e toglie il proprio listener, nessuno dei due tocca lo stato
 * dell'altro.
 */
export function useTurnAttention(state: GameState | null, myId: string | null): void {
  // Titolo di partenza, letto una sola volta al montaggio: niente altro in
  // questo progetto scrive su `document.title`, quindi non serve tenerlo
  // sincronizzato oltre il primo render.
  const originalTitleRef = useRef('');
  useEffect(() => {
    originalTitleRef.current = document.title;
  }, []);

  // Id dell'intervallo di lampeggio in corso, o null se l'avviso è spento.
  const blinkIdRef = useRef<number | null>(null);
  // Il `<link>` della favicon d'avviso, creato solo mentre serve.
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null);

  // Spegne l'avviso e riporta titolo e favicon come prima. Usata sia per
  // tornare normali (scheda tornata visibile, o turno passato ad altri
  // mentre si era ancora via) sia per lo smontaggio: senza, un intervallo
  // rimarrebbe a girare a vuoto e il titolo resterebbe sbagliato per sempre
  // dopo aver lasciato il tavolo.
  const stopAlert = useCallback(() => {
    if (blinkIdRef.current !== null) {
      window.clearInterval(blinkIdRef.current);
      blinkIdRef.current = null;
    }
    document.title = originalTitleRef.current;
    if (faviconLinkRef.current) {
      faviconLinkRef.current.remove();
      faviconLinkRef.current = null;
    }
  }, []);

  const startAlert = useCallback(() => {
    if (blinkIdRef.current !== null) return; // già acceso, non si riparte da capo

    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = ALERT_FAVICON;
    document.head.appendChild(link);
    faviconLinkRef.current = link;

    let mostrandoAvviso = false;
    const tick = () => {
      mostrandoAvviso = !mostrandoAvviso;
      document.title = mostrandoAvviso ? ALERT_TITLE : originalTitleRef.current;
    };
    tick();
    blinkIdRef.current = window.setInterval(tick, BLINK_MS);
  }, []);

  const waiting = state ? isGameWaitingFor(state, myId) : false;

  useEffect(() => {
    // Rivalutata a ogni cambio di `waiting` e a ogni cambio di visibilità:
    // sono i due soli eventi che possono far scattare o cessare l'avviso.
    const evaluate = () => {
      if (waiting && document.hidden) {
        startAlert();
      } else {
        stopAlert();
      }
    };
    evaluate();

    document.addEventListener('visibilitychange', evaluate);
    return () => {
      document.removeEventListener('visibilitychange', evaluate);
      // Smontaggio (si lascia il tavolo) o prossimo giro con `waiting`
      // diverso: in entrambi i casi non deve restare nulla acceso.
      stopAlert();
    };
  }, [waiting, startAlert, stopAlert]);
}
