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
 *
 * Da quando gli scambi non fermano più il tavolo, l'offerta ricevuta ha smesso
 * di essere una di quelle finestre e ha un livello suo, sotto le decisioni vere.
 * Applicando la regola alla lettera: una proposta si PUÒ rimandare — il gioco
 * va avanti lo stesso, e chi l'ha fatta può ritirarla — mentre un affitto o
 * un'asta no. Lasciarla al livello `decisione` avrebbe riprodotto in piccolo il
 * guaio da cui questa scala è nata: la finestra dello scambio sopra quella
 * dell'asta, cioè un'offerta rimandabile che copre l'unica cosa che sblocca
 * tutti.
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
  /**
   * La striscia che dice "sto aspettando la risposta di X": informativa, non
   * modale, e non deve rubare il posto a niente. Sta sotto il compositore
   * perché mentre si compone una proposta nuova quella vecchia è un promemoria,
   * non qualcosa su cui agire.
   */
  propostaInAttesa: 28,
  /** Comporre uno scambio si può sempre rimandare: sta sotto le decisioni. */
  compositoreScambio: 30,
  /**
   * L'offerta di scambio ricevuta. Chiede sì una risposta, ma è l'unica
   * "domanda" che si può rimandare senza fermare nessuno: sopra il compositore
   * (se arriva un'offerta mentre ne sto scrivendo una, voglio vederla) e sotto
   * le decisioni vere, che invece tengono fermo il tavolo.
   */
  offertaScambio: 34,
  /**
   * Qualunque finestra che aspetta una decisione per sbloccare il turno:
   * acquisto, carta, affitto, tassa, debito, asta.
   * Non spezzare questo livello in sottolivelli senza una ragione forte —
   * due di queste non compaiono mai insieme, perché il motore tiene un solo
   * pendingAction alla volta.
   */
  decisione: 40,
  /** La barra rossa della connessione persa: va vista sopra ogni cosa. */
  connessionePersa: 60,
  /**
   * L'avviso di azione rifiutata (vedi AvvisoAzione.tsx). Sopra tutto il resto
   * perché quasi tutti i rifiuti nascono dai bottoni delle finestre che
   * congelano il turno — asta, debito, scambio — e un messaggio nascosto
   * dietro la finestra da cui è partito il clic non lo leggerebbe nessuno,
   * cioè si tornerebbe esattamente al bottone che sembra rotto. Non si
   * accavalla alla barra della connessione persa perché quella lo spinge più
   * in basso (vedi `sottoBanner`), non perché stia sotto.
   */
  avvisoAzione: 70,
  /** Fine partita: copre tutto, non c'è più niente da decidere sotto. */
  finePartita: 50,
};
