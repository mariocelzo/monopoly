import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Quali azioni sono partite verso il server e non hanno ancora avuto risposta.
 *
 * IL PROBLEMA CHE RISOLVE
 * Il server risponde in circa 250ms anche quando è caldo e la richiesta non fa
 * nulla (misurato in produzione riusando la stessa connessione, quindi al netto
 * di ogni stretta di mano: è distanza geografica, non codice). Un quarto di
 * secondo è oltre la soglia entro cui un tocco si sente "collegato" a quello
 * che succede dopo, e in questa interfaccia fra il tocco e la risposta non
 * cambiava assolutamente niente: il bottone restava lì, acceso e identico,
 * finché non arrivava lo stato nuovo. È la stessa sensazione — "ho premuto e
 * non è successo niente" — che in questo progetto ha già tenuto nascosto un
 * difetto per settimane (il rilancio d'asta sotto il minimo, rifiutato in
 * silenzio: vedi azioni.ts). Lì mancava il messaggio di rifiuto, qui manca il
 * segnale che l'azione è partita: sono due metà dello stesso problema.
 *
 * PERCHÉ QUI E NON DENTRO OGNI COMPONENTE
 * Un `useState('sto aspettando')` per bottone sarebbe la ventesima copia della
 * stessa logica, e soprattutto non saprebbe quando l'attesa finisce: la
 * risposta la riceve `inviaAzione` in socket.ts, che è un modulo, non un
 * componente. Da lì il registro si aggiorna una volta sola e chiunque disegni
 * quel comando se ne accorge. È lo stesso schema — un modulo, un'istanza — già
 * usato per il socket e per l'avviso dei rifiuti.
 *
 * Il file resta puro (niente socket, niente `window`, niente import di Vite):
 * così la parte che decide le soglie si verifica in logic-test.ts sotto Node,
 * senza montare React né aprire una connessione.
 */

/**
 * Oltre questo tempo senza risposta il comando smette di essere solo "premuto"
 * e mostra che si sta ancora aspettando.
 *
 * La soglia è tarata sui 250ms del giro di rete vero: sotto, il segno di
 * attesa comparirebbe e sparirebbe come un lampo su OGNI azione riuscita, e
 * un'interfaccia che sfarfalla a ogni tocco si legge come rotta. Sopra, invece,
 * chi sta aspettando davvero (rete peggiore del solito, server che si sta
 * risvegliando) resterebbe di nuovo senza notizie. 220ms lascia passare in
 * silenzio il giro normale e accende il segnale solo quando c'è davvero da
 * aspettare.
 */
export const SOGLIA_ATTESA_VISIBILE_MS = 220;

/**
 * Quanto si aspetta al massimo la risposta prima di riaccendere il comando.
 *
 * Serve a non lasciare mai un bottone spento per sempre: se la risposta non
 * arriva (rete caduta fra l'invio e l'ack, server riavviato nel frattempo)
 * senza questo tetto quel comando resterebbe inutilizzabile per il resto della
 * serata — un rimedio peggiore del male che cura.
 *
 * Dieci secondi sono quaranta volte il giro di rete misurato: se sono passati,
 * non è lentezza, è che quella risposta non arriverà. Riaccendere il comando
 * non rischia di far partire l'azione due volte, perché il motore è comunque
 * l'unico arbitro e rifiuta la seconda copia (un secondo `roll_dice` trova il
 * turno già passato, un secondo `buy_property` non trova più niente da
 * comprare) — e quei rifiuti azioni.ts li riconosce già come corse innocue e
 * li tace.
 */
export const TETTO_ATTESA_MS = 10_000;

/**
 * Il nome sotto cui un'azione risulta "in volo".
 *
 * Di norma è l'evento e basta, ma i comandi del pannello proprietà (costruisci,
 * vendi, ipoteca, riscatta) sono lo stesso evento ripetuto su caselle diverse,
 * tutte a schermo insieme: senza la posizione nella chiave, premere
 * "Costruisci" su Via Roma spegnerebbe il "Costruisci" di tutte le altre.
 */
export function chiaveAzione(evento: string, payload?: unknown): string {
  const posizione = (payload as { position?: unknown } | null | undefined)?.position;
  return typeof posizione === 'number' ? `${evento}:${posizione}` : evento;
}

/** Chiave -> quante copie di quell'azione sono in volo (di solito una). */
const inVolo = new Map<string, number>();
const ascoltatori = new Set<() => void>();

function avvisaTutti() {
  ascoltatori.forEach((ascoltatore) => ascoltatore());
}

/** Si iscrive ai cambiamenti; la funzione tornata annulla l'iscrizione. */
export function iscrivitiAlleAzioniInVolo(ascoltatore: () => void): () => void {
  ascoltatori.add(ascoltatore);
  return () => {
    ascoltatori.delete(ascoltatore);
  };
}

/** L'azione è partita: da adesso il comando che l'ha mandata è in attesa. */
export function segnaPartenza(chiave: string): void {
  inVolo.set(chiave, (inVolo.get(chiave) ?? 0) + 1);
  avvisaTutti();
}

/**
 * La risposta è arrivata (o si è smesso di aspettarla). Una chiave che non
 * risulta in volo si ignora in silenzio invece di andare sotto zero: succede di
 * proposito quando `azzeraAzioniInVolo` ha già liberato tutto alla
 * riconnessione e l'ack di prima arriva comunque, in ritardo.
 */
export function segnaArrivo(chiave: string): void {
  const quante = inVolo.get(chiave);
  if (!quante) return;
  if (quante === 1) inVolo.delete(chiave);
  else inVolo.set(chiave, quante - 1);
  avvisaTutti();
}

/**
 * Libera tutti i comandi in un colpo solo. La chiama la riconnessione (vedi
 * socket.ts): dopo una caduta di rete lo stato che conta è quello che il server
 * sta per ritrasmettere, e qualunque attesa di prima è comunque finita — o
 * l'azione è passata, o non passerà mai. Senza, chi torna online si
 * ritroverebbe l'interfaccia bloccata fino allo scadere di TETTO_ATTESA_MS.
 */
export function azzeraAzioniInVolo(): void {
  if (inVolo.size === 0) return; // niente notifiche a vuoto
  inVolo.clear();
  avvisaTutti();
}

/** Se quell'azione è partita e non ha ancora avuto risposta. */
export function azioneInVolo(chiave: string): boolean {
  return inVolo.has(chiave);
}

/** Quante azioni distinte sono in volo adesso. Serve ai test. */
export function quanteAzioniInVolo(): number {
  return inVolo.size;
}

/** Se il comando dato è in volo adesso; si riaggiorna da solo. */
export function useAzioneInVolo(chiave: string): boolean {
  // useSyncExternalStore vuole uno snapshot stabile: qui è un booleano, quindi
  // due letture consecutive senza cambiamenti sono per forza uguali e React non
  // entra nel ciclo di render che darebbe un oggetto ricostruito ogni volta.
  return useSyncExternalStore(
    iscrivitiAlleAzioniInVolo,
    () => azioneInVolo(chiave),
    () => false // sotto rendering server non c'è niente in volo
  );
}

/**
 * Vero quando l'attesa dura abbastanza da meritare un segnale visibile.
 *
 * Separato da `useAzioneInVolo` perché sono due cose diverse e succedono in due
 * momenti diversi: il comando si spegne NELL'ISTANTE del tocco (è quello a dire
 * "ricevuto"), il segno di attesa arriva solo dopo, e solo se la risposta
 * tarda. Fonderli darebbe o un bottone che non reagisce subito, o un lampeggio
 * a ogni azione riuscita.
 */
export function useAttesaVisibile(inAttesa: boolean): boolean {
  const [visibile, setVisibile] = useState(false);
  useEffect(() => {
    if (!inAttesa) {
      setVisibile(false);
      return;
    }
    const timer = setTimeout(() => setVisibile(true), SOGLIA_ATTESA_VISIBILE_MS);
    return () => clearTimeout(timer);
  }, [inAttesa]);
  return visibile;
}
