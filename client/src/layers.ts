/**
 * Ordine di sovrapposizione di tutto ciò che si accavalla sullo schermo.
 *
 * Sta qui, in un posto solo, perché i numeri sparsi nei componenti hanno già
 * causato una partita bloccata: il compositore di scambio e la finestra
 * dell'offerta ricevuta avevano lo stesso valore, e siccome il compositore
 * viene disegnato dopo finiva sopra. Il risultato era che un bot proponeva
 * uno scambio mentre stavi componendo il tuo, la sua proposta congelava il
 * turno di tutti, e tu non avevi alcun modo di rispondere perché la finestra
 * per farlo era nascosta dietro la tua. Stessa cosa, in peggio, per acquisto,
 * debito e asta, che stavano addirittura sotto.
 *
 * La regola che tiene insieme la scala: **tutto ciò che chiede una decisione
 * sta sopra tutto ciò che si può rimandare.** Un pendingAction congela il
 * turno dell'intero tavolo finché non lo si risolve, quindi la finestra che
 * permette di risolverlo non può mai restare coperta da qualcosa che si
 * poteva chiudere.
 */
export const LAYER = {
  tabellone: 5,
  /** Comandi fissi su telefono. */
  barraMobile: 15,
  /** Il foglio che sale dal basso su telefono. */
  foglioMobile: 18,
  /** Solo informativi: si chiudono quando si vuole, possono stare sotto. */
  dettaglioCasella: 24,
  riepilogoRientro: 26,
  /** Comporre uno scambio si può sempre rimandare: sta sotto le decisioni. */
  compositoreScambio: 30,
  /**
   * Qualunque finestra che aspetta una decisione per sbloccare il turno:
   * acquisto, carta, affitto, tassa, debito, asta, offerta ricevuta.
   * Non spezzare questo livello in sottolivelli senza una ragione forte —
   * due di queste non compaiono mai insieme, perché il motore tiene un solo
   * pendingAction alla volta.
   */
  decisione: 40,
  /** La barra rossa della connessione persa: va vista sopra ogni cosa. */
  connessionePersa: 60,
  /** Fine partita: copre tutto, non c'è più niente da decidere sotto. */
  finePartita: 50,
};
