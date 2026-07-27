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
