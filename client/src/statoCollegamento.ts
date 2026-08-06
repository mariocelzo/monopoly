import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * A che punto è il collegamento col server, e da quanto si sta aspettando.
 *
 * IL PROBLEMA CHE RISOLVE
 * Il backend gira su un piano gratuito che spegne il servizio dopo un quarto
 * d'ora di inattività e lo riaccende alla prima richiesta. La riaccensione,
 * cronometrata in produzione, costa 22,9 secondi. Chi apre la pagina in quel
 * momento vede un'interfaccia che per venti secondi non risponde a niente e
 * conclude l'unica cosa ragionevole: che è rotta. Non è un difetto di codice,
 * ed è per questo che non si può "aggiustare" — si può però smettere di
 * nasconderlo, e quei venti secondi sono esattamente il tempo in cui chi arriva
 * sta comunque scrivendo il proprio nome e scegliendo il pedone.
 *
 * PERCHÉ NON BASTAVA IL TIMER CHE C'ERA GIÀ NELLA LOBBY
 * Prima il risveglio si indovinava a posteriori: si mandava `create_room` e, se
 * dopo 2,5 secondi non era tornato niente, si diceva "il tavolo si sta
 * svegliando". Due limiti, entrambi rilevanti. Il primo è che l'avviso arrivava
 * solo DOPO un clic, mentre il socket si collega da sé al caricamento della
 * pagina (vedi App.tsx): il risveglio era già in corso da una decina di secondi
 * mentre chi guardava non ne sapeva nulla. Il secondo è che misurava la cosa
 * sbagliata — la lentezza di una risposta, che può avere altre cause — invece
 * di quella giusta, cioè che la connessione non è ancora stabilita.
 *
 * Qui la domanda è una sola e ha una risposta certa: il socket è collegato? Se
 * non lo è, si sa anche da quanto ci sta provando, e questo distingue "mi sto
 * collegando" (un istante) da "il servizio dormiva" (una ventina di secondi).
 *
 * Il file resta puro — niente socket, niente `window` — così le soglie e i
 * conti si verificano in logic-test.ts sotto Node. È socket.ts a nutrirlo con
 * gli eventi veri.
 */

/**
 * Oltre questa attesa non è più "la rete ci mette un attimo": è il servizio che
 * sta ripartendo da zero. La soglia sta ben sopra il giro di rete normale (250ms
 * misurati a server caldo, e l'apertura del socket ne costa qualcuno in più)
 * ma molto sotto un risveglio vero, così il messaggio lungo non compare mai a
 * sproposito su un server già sveglio.
 */
export const SOGLIA_RISVEGLIO_MS = 2500;

/**
 * Quanto dura un risveglio, misurato: 22,9 secondi dalla prima richiesta alla
 * prima risposta. Si arrotonda per eccesso perché una stima che sbaglia per
 * difetto è peggio di nessuna stima — promette una fine che poi non arriva.
 */
export const RISVEGLIO_ATTESO_MS = 25_000;

export type FaseCollegamento =
  /** Il socket è aperto: si gioca. */
  | 'collegato'
  /** Ci si sta collegando da poco: normale, non vale la pena dire niente di grosso. */
  | 'collegamento'
  /** Si aspetta da troppo perché sia solo rete: il servizio si sta riaccendendo. */
  | 'risveglio';

export function faseCollegamento(collegato: boolean, attesaMs: number): FaseCollegamento {
  if (collegato) return 'collegato';
  return attesaMs >= SOGLIA_RISVEGLIO_MS ? 'risveglio' : 'collegamento';
}

/**
 * Quanti secondi mancano, più o meno, alla fine del risveglio. Zero significa
 * "la stima è scaduta e non è ancora tornato": chi disegna deve dire qualcosa
 * di onesto ("ancora qualche secondo"), non continuare a contare all'indietro
 * sotto zero né restare fermo su "1s" mentendo a ogni secondo che passa.
 */
export function secondiAlRisveglio(attesaMs: number): number {
  return Math.max(0, Math.ceil((RISVEGLIO_ATTESO_MS - attesaMs) / 1000));
}

/**
 * Avanzamento da mostrare, in percentuale. Non arriva mai al 100% da sola: la
 * barra si riempie del tutto solo quando il collegamento c'è davvero, altrimenti
 * resterebbe piena e ferma davanti a un server che ancora non risponde — che è
 * di nuovo l'interfaccia che sembra rotta, solo con una barra in più.
 */
export function avanzamentoRisveglio(attesaMs: number): number {
  return Math.min(94, Math.round((attesaMs / RISVEGLIO_ATTESO_MS) * 100));
}

// ---------------------------------------------------------------------------
// Lo stato vero, alimentato dagli eventi del socket (vedi socket.ts)
// ---------------------------------------------------------------------------

let collegato = false;
/** Quando è cominciato il tentativo in corso, o null se siamo collegati. */
let tentativoIniziatoA: number | null = null;
const ascoltatori = new Set<() => void>();

function avvisaTutti() {
  ascoltatori.forEach((ascoltatore) => ascoltatore());
}

/**
 * È partito un tentativo di collegamento. Se ce n'è già uno in corso NON si
 * riazzera il cronometro: `ensureConnected` in App.tsx richiama il collegamento
 * a ogni ritorno in primo piano e a ogni evento `online` del browser, e
 * rimettere a zero il conto a ogni richiamo terrebbe la fase su "collegamento"
 * per sempre, cioè proprio nel caso — il risveglio lungo — che si vuole vedere.
 */
export function segnalaTentativoDiCollegamento(): void {
  if (collegato) collegato = false;
  else if (tentativoIniziatoA !== null) return;
  tentativoIniziatoA = Date.now();
  avvisaTutti();
}

export function segnalaCollegato(): void {
  if (collegato && tentativoIniziatoA === null) return;
  collegato = true;
  tentativoIniziatoA = null;
  avvisaTutti();
}

/** Da quanti ms si sta aspettando il collegamento; 0 se siamo collegati. */
export function attesaCollegamentoMs(adesso = Date.now()): number {
  return tentativoIniziatoA === null ? 0 : Math.max(0, adesso - tentativoIniziatoA);
}

export function iscrivitiAlCollegamento(ascoltatore: () => void): () => void {
  ascoltatori.add(ascoltatore);
  return () => {
    ascoltatori.delete(ascoltatore);
  };
}

/** Solo per i test: rimette il modulo com'era all'avvio. */
export function azzeraCollegamentoPerTest(): void {
  collegato = false;
  tentativoIniziatoA = null;
}

/**
 * Ogni quanto si ridisegna il conto alla rovescia mentre si aspetta. Mezzo
 * secondo: abbastanza fitto perché i secondi scendano senza scatti visibili,
 * abbastanza rado da non costare niente. Il timer esiste SOLO finché non si è
 * collegati — a partita in corso qui non gira nulla.
 */
const PASSO_TICCHETTIO_MS = 500;

/**
 * La fase corrente e da quanto si aspetta, già pronta da disegnare.
 * Si riaggiorna sia sugli eventi del socket sia col passare del tempo: senza il
 * secondo, l'attesa resterebbe ferma sul valore che aveva quando il tentativo è
 * iniziato e non si vedrebbe mai scattare la fase di risveglio.
 */
export function useStatoCollegamento(): { fase: FaseCollegamento; attesaMs: number } {
  const collegatoOra = useSyncExternalStore(
    iscrivitiAlCollegamento,
    () => collegato,
    () => true // sotto rendering server non si mostra nessuna attesa
  );
  const [, ticchetta] = useState(0);

  useEffect(() => {
    if (collegatoOra) return;
    const timer = setInterval(() => ticchetta((n) => n + 1), PASSO_TICCHETTIO_MS);
    return () => clearInterval(timer);
  }, [collegatoOra]);

  const attesaMs = attesaCollegamentoMs();
  return { fase: faseCollegamento(collegatoOra, attesaMs), attesaMs };
}
