import { useEffect, useState } from 'react';

// Sotto questa larghezza il tabellone e i controlli non stanno affiancati e si
// passa all'assetto con barra fissa in basso.
export const MOBILE_BREAKPOINT = 780;

// Struttura comune a tutti gli hook di media query di questo file: stato
// iniziale letto in modo lazy (così l'import a livello di modulo non tocca
// `window`), poi un listener che tiene lo stato allineato ai cambi di query.
// `useIsMobile` e `useIsTouchLayout` differiscono solo nella stringa di query,
// quindi condividono questa implementazione invece di duplicarla.
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** Vero su schermi stretti. Si aggiorna alla rotazione o al ridimensionamento. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);
}

// Assetto da dito. Non è la stessa domanda di `useIsMobile`: quella decide
// come si dispone la pagina, questa se un comando si usa col pollice. Un tablet
// in orizzontale è largo 1024px ma resta touch, mentre una finestra da 1024px
// su un computer si usa col mouse — `hover: none` è ciò che li distingue.
export const TOUCH_LAYOUT_QUERY = `(hover: none), (max-width: ${MOBILE_BREAKPOINT}px)`;

/** Vero su telefoni e tablet, in qualunque orientamento. */
export function useIsTouchLayout(): boolean {
  return useMediaQuery(TOUCH_LAYOUT_QUERY);
}
