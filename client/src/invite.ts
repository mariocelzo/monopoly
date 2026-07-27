// Link di invito al tavolo: stessa idea del codice a cinque caratteri, ma da
// un tocco solo. Il codice resta l'unica fonte di verità (il server valida
// quello), il link è solo un modo più comodo di trasportarlo.

const PARAM = 'tavolo';

/** Codice letto dalla query string corrente, o null se non c'è. */
export function getInviteCodeFromUrl(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get(PARAM);
    return value ? value.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/** URL completo da condividere: apre il gioco già pronto a entrare nel tavolo. */
export function buildInviteUrl(roomCode: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?${PARAM}=${roomCode}`;
}

/**
 * Toglie il codice dall'URL dopo averlo usato. Senza, un ricaricamento
 * proverebbe a rientrare nel tavolo anche dopo che lo si è lasciato apposta.
 */
export function clearInviteFromUrl() {
  try {
    const url = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  } catch {
    // Ambienti senza history API (rarissimo): l'URL resta con il parametro,
    // ma il gioco funziona lo stesso.
  }
}
