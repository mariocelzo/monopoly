import { useEffect, useState } from 'react';

// Sotto questa larghezza il tabellone e i controlli non stanno affiancati e si
// passa all'assetto con barra fissa in basso.
export const MOBILE_BREAKPOINT = 780;

/** Vero su schermi stretti. Si aggiorna alla rotazione o al ridimensionamento. */
export function useIsMobile(): boolean {
  const query = `(max-width: ${MOBILE_BREAKPOINT}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return isMobile;
}

// Assetto da dito. Non è la stessa domanda di `useIsMobile`: quella decide
// come si dispone la pagina, questa se un comando si usa col pollice. Un tablet
// in orizzontale è largo 1024px ma resta touch, mentre una finestra da 1024px
// su un computer si usa col mouse — `hover: none` è ciò che li distingue.
export const TOUCH_LAYOUT_QUERY = `(hover: none), (max-width: ${MOBILE_BREAKPOINT}px)`;

/** Vero su telefoni e tablet, in qualunque orientamento. */
export function useIsTouchLayout(): boolean {
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(TOUCH_LAYOUT_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(TOUCH_LAYOUT_QUERY);
    const update = () => setIsTouch(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isTouch;
}
