import { useSyncExternalStore } from 'react';

/**
 * Il posto unico dove finiscono i rifiuti del server.
 *
 * Il motore risponde a ogni azione con un ack: `{}` se è andata, `{ error }`
 * con un messaggio già scritto in italiano se l'ha rifiutata ("Serve il
 * monopolio del colore per costruire", "Rilancio minimo 40"). Fino a ieri
 * quasi nessun `socket.emit` guardava quella risposta: si sparava l'evento e
 * basta. Chi premeva vedeva un bottone che non faceva niente — indistinguibile
 * da un bottone rotto. È esattamente così che il difetto del rilancio d'asta
 * (offerta sotto il minimo su 24 caselle su 28) è sopravvissuto per settimane:
 * il server lo diceva a ogni clic, non lo leggeva nessuno.
 *
 * PERCHÉ UN CANALE A LIVELLO DI MODULO E NON UN CONTEXT REACT
 * Chi manda l'azione e chi mostra l'errore non sono quasi mai parenti stretti:
 * si preme dentro PropertiesPanel, che vive dentro DebtModal, che vive dentro
 * App; oppure dentro il foglio che sale dal basso su telefono. Con un context
 * ogni punto di invio dovrebbe prendersi un hook e ogni componente in mezzo
 * restare montato; qui invece `inviaAzione` (vedi socket.ts) pubblica e basta,
 * e chi disegna l'avviso è un componente solo, sempre montato in App. È lo
 * stesso schema che il progetto usa già per il socket: un modulo, un'istanza.
 * Non è un gestore di stato globale — non c'è stato di gioco qui dentro, solo
 * l'ultimo rifiuto e nient'altro: lo stato della partita continua ad arrivare
 * unicamente dall'evento `state`.
 *
 * Questo file resta puro di proposito (niente socket, niente `window`, niente
 * import di Vite): così la politica qui sotto — la parte che decide cosa vale
 * la pena mostrare — è verificabile in logic-test.ts sotto Node, senza
 * montare React né aprire una connessione.
 */

/**
 * Rifiuti che NON sono guasti ma corse: fra il tocco e l'arrivo dell'evento al
 * server il gioco è andato avanti da sé (doppio clic, un bot che ha giocato nel
 * frattempo, lo stato aggiornato sotto il dito). Il senso di tutti è lo stesso:
 * "quella cosa non aspetta più te". Mostrarli farebbe comparire un avviso rosso
 * mentre il gioco sta funzionando benissimo — un falso allarme è peggio del
 * silenzio, perché insegna a ignorare gli avvisi veri.
 *
 * Il caso tipico è il doppio clic su "Fine turno": il primo passa il turno, il
 * secondo si prende "Non è il tuo turno". Non è successo niente di male.
 */
const CORSE_INNOCUE = [
  'Non è il tuo turno',
  'Non tocca a te',
  'Non è la tua carta',
  'Non tocca a te rispondere',
  // La schermata di fine partita è già lì a coprire tutto: dire anche "la
  // partita è finita" non aggiunge nulla che non si stia già leggendo.
  'La partita è finita',
  'La partita è già finita',
];

/**
 * Rifiuti innocui legati alla singola azione: significano tutti "l'oggetto su
 * cui hai premuto non c'è più" — la finestra si è chiusa mentre premevi, o è
 * il secondo colpo di un doppio clic andato a buon fine al primo.
 *
 * Sono elencati azione per azione, e non in un unico calderone, perché la
 * stessa frase può essere innocua per un comando e importante per un altro:
 * qui si dichiara caso per caso cosa si sceglie di tacere, così chi aggiunge
 * un comando domani deve prendere la decisione di proposito.
 */
const GIA_RISOLTO: Record<string, string[]> = {
  buy_property: ['Nessun acquisto in sospeso'],
  decline_buy: ['Nessun acquisto in sospeso'],
  pay_rent: ['Nessun affitto da pagare'],
  pay_tax: ['Nessuna tassa da pagare'],
  acknowledge_card: ['Nessuna carta da leggere'],
  // L'asta può essersi chiusa fra il tocco e l'arrivo (l'ultimo avversario ha
  // passato). "Rilancio minimo 40" e "Saldo insufficiente", invece, restano
  // eccome: sono il motivo per cui quel bottone sembrava morto.
  auction_bid: ['Nessuna asta in corso'],
  auction_pass: ['Nessuna asta in corso'],
  respond_trade: ['Nessuno scambio in sospeso'],
  // Il debito può essere già rientrato vendendo a mano dal pannello proprietà,
  // che sta nella stessa finestra: premere poi "Vendi automaticamente" è
  // normalissimo.
  resolve_debt_auto: ['Non hai debiti da saldare'],
  declare_bankruptcy: ['Non hai debiti da saldare'],
  // Il bottone si spegne dopo il voto, ma il secondo tocco di un doppio clic
  // parte prima che lo stato torni indietro.
  request_rematch: ['Hai già chiesto la rivincita'],
};

/**
 * Cosa mostrare per questo rifiuto, oppure `null` per non mostrare niente.
 *
 * Volutamente NON si tace nulla del tipo "prima fai X" (Prima paga l'affitto,
 * Prima risolvi il debito in sospeso, Serve il monopolio del colore...): quelle
 * non sono corse, sono istruzioni: dicono cosa manca per ottenere ciò che si
 * stava chiedendo, ed è proprio l'informazione che oggi non arriva a nessuno.
 * Il confronto è per testo esatto sui messaggi del motore (vedi gameEngine.js):
 * i messaggi con un numero dentro — "Rilancio minimo 40" — non compaiono in
 * nessuna lista e quindi si vedono sempre, che è quello che si vuole.
 */
export function messaggioDiRifiuto(evento: string, errore?: string | null): string | null {
  if (!errore) return null;
  if (CORSE_INNOCUE.includes(errore)) return null;
  if (GIA_RISOLTO[evento]?.includes(errore)) return null;
  return errore;
}

export interface RifiutoAzione {
  /** Il messaggio del motore, già in italiano: non si riscrive qui. */
  testo: string;
  /**
   * Progressivo. Serve perché due rifiuti identici di fila (si ripreme lo
   * stesso bottone) sono due avvisi distinti: senza, l'oggetto sarebbe uguale
   * al precedente, l'avviso non si rianimerebbe e il conto alla rovescia per
   * farlo sparire non ripartirebbe — sembrerebbe di nuovo che non succeda
   * nulla, cioè il difetto da cui si è partiti.
   */
  seq: number;
}

let corrente: RifiutoAzione | null = null;
let contatore = 0;
const ascoltatori = new Set<() => void>();

function avvisaTutti() {
  ascoltatori.forEach((ascoltatore) => ascoltatore());
}

/** Si iscrive ai cambiamenti; la funzione tornata annulla l'iscrizione. */
export function iscrivitiAiRifiuti(ascoltatore: () => void): () => void {
  ascoltatori.add(ascoltatore);
  return () => {
    ascoltatori.delete(ascoltatore);
  };
}

/** L'ultimo rifiuto da mostrare, o null se non c'è niente da dire. */
export function rifiutoCorrente(): RifiutoAzione | null {
  return corrente;
}

/**
 * Toglie l'avviso. Lo chiamano il tempo che scade (vedi AvvisoAzione.tsx), la
 * prossima azione riuscita, e chi lascia il tavolo — un messaggio di una
 * partita non deve riapparire in quella dopo.
 */
export function azzeraRifiuto(): void {
  if (corrente === null) return; // niente notifiche a vuoto
  corrente = null;
  avvisaTutti();
}

/**
 * Registra l'esito di un'azione. Torna `true` se il server l'ha RIFIUTATA,
 * anche quando si è scelto di tacere il messaggio: chi invia usa questo per
 * sapere se può proseguire (per esempio TradeModal chiude il compositore solo
 * se la proposta è davvero partita), e confondere "taciuto" con "riuscito"
 * chiuderebbe finestre su azioni mai avvenute.
 */
export function segnalaEsito(evento: string, errore?: string | null): boolean {
  const testo = messaggioDiRifiuto(evento, errore);
  if (testo !== null) {
    contatore += 1;
    corrente = { testo, seq: contatore };
    avvisaTutti();
    return true;
  }
  // Rifiuto taciuto: non si mostra niente di nuovo, ma non si cancella nemmeno
  // un avviso precedente ancora a schermo — quello parlava di un'altra azione,
  // ed è ancora vero.
  if (errore) return true;
  // Azione riuscita: qualunque avviso rimasto ha finito il suo lavoro.
  azzeraRifiuto();
  return false;
}

/** L'avviso da disegnare adesso. Si riaggiorna da solo a ogni nuovo rifiuto. */
export function useRifiutoAzione(): RifiutoAzione | null {
  // useSyncExternalStore vuole uno snapshot stabile: `corrente` è un oggetto
  // sostituito solo quando cambia davvero, mai ricostruito a ogni lettura,
  // altrimenti React entrerebbe in un ciclo infinito di render.
  return useSyncExternalStore(iscrivitiAiRifiuti, rifiutoCorrente, rifiutoCorrente);
}
