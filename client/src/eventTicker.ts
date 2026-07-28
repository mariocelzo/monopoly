/**
 * Logica pura della striscia degli eventi (EventTicker): quali voci restano
 * da mostrare e per quanto. Separata dal componente React per poterla
 * testare in `logic-test.ts` senza montare nulla, come già per
 * `propertyGroups` e `awayRecap`.
 *
 * La lista delle "voci nuove" da mettere in coda non ha bisogno di logica
 * propria: `missedSince`/`latestLogAt` di `awayRecap.ts` fanno esattamente
 * quello che serve (righe di registro arrivate dopo un segnalibro, al netto
 * del rumore delle notifiche di connessione) — riscriverla qui sarebbe
 * duplicare la stessa regola due volte.
 */

/** Quanto resta visibile ogni voce prima di sparire da sola. */
export const TICKER_ENTRY_LIFETIME_MS = 4500;

/**
 * Quante voci al massimo restano impilate insieme. I bot si muovono ogni
 * 1,7-3 secondi e un solo turno può produrre più righe di registro (atterra,
 * paga, passa il turno...): senza un tetto la striscia potrebbe accumulare
 * abbastanza voci da coprire l'intestazione di un foglio a schermo intero su
 * telefono (il compositore di scambio, per esempio). Non succede nulla di
 * grave — la striscia non intercetta i tocchi — ma è comunque il caso di
 * tenerla leggibile: solo le voci più recenti contano davvero.
 */
export const TICKER_MAX_VISIBLE = 3;

/**
 * Una voce in coda nella striscia. `shownAt` è l'istante in cui il client
 * l'ha messa in coda, non `at` della riga di registro da cui viene: quello è
 * l'orologio del server, e può essere già "vecchio" quando arriva (partita
 * ripresa dopo una disconnessione, ritardo di rete). La scadenza della
 * striscia deve contare da quando la si è vista comparire, non da quando è
 * successa.
 */
export interface TickerItem {
  id: number;
  message: string;
  shownAt: number;
}

/** Tra le voci in coda, quelle ancora entro la loro finestra di vita a `now`. */
export function visibleTickerEntries(queue: TickerItem[], now: number): TickerItem[] {
  return queue.filter((item) => now - item.shownAt < TICKER_ENTRY_LIFETIME_MS);
}

/**
 * Tiene solo le `TICKER_MAX_VISIBLE` voci più recenti, scartando le più
 * vecchie in eccesso. Le voci arrivano già in ordine cronologico (si
 * accodano man mano che il registro cresce), quindi "più recenti" vuol dire
 * semplicemente le ultime della lista.
 */
export function capTickerQueue(queue: TickerItem[]): TickerItem[] {
  return queue.length > TICKER_MAX_VISIBLE ? queue.slice(queue.length - TICKER_MAX_VISIBLE) : queue;
}
