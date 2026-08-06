import { ReactNode } from 'react';
import { inviaAzione } from '../socket';
import { chiaveAzione, useAttesaVisibile, useAzioneInVolo } from '../azioniInVolo';

/**
 * Un comando che parte verso il server: tira i dadi, compra, rinuncia, paga,
 * rilancia, accetta uno scambio.
 *
 * COSA FA CHE UN `<button onClick={() => inviaAzione(...)}>` NON FACEVA
 * Fra il tocco e la risposta passano circa 250ms anche a server caldo (misurati
 * in produzione: è distanza geografica, non codice), e in quel quarto di
 * secondo sullo schermo non cambiava niente. Qui succedono tre cose, in
 * quest'ordine e per tre motivi diversi:
 *
 *  1. il gettone si abbassa sotto il dito — non è codice, è il `:active` che il
 *     foglio di stile dà già a tutti i bottoni: risposta a costo zero e senza
 *     un solo millisecondo di ritardo;
 *  2. NELL'ISTANTE del tocco il comando si spegne e resta spento finché la
 *     risposta non torna. Serve a dire "ricevuto", e insieme toglie di mezzo il
 *     secondo clic di chi, non vedendo succedere niente, ripreme — il doppio
 *     tocco su "Fine turno" era il caso tipico, e finiva in un rifiuto del
 *     motore da tacere (vedi azioni.ts);
 *  3. SOLO SE la risposta tarda oltre la soglia (vedi
 *     SOGLIA_ATTESA_VISIBILE_MS) compare il segno di attesa. È l'ultima cosa
 *     perché è la più invadente: su un giro di rete normale non deve comparire
 *     affatto, o si avrebbe un lampeggio a ogni singola azione riuscita.
 *
 * Il segno di attesa è una riga sottile che scorre sul bordo basso del gettone,
 * disegnata in `::after` e quindi FUORI dal flusso: un indicatore inline
 * allargherebbe il bottone di una quindicina di pixel a metà attesa, e su
 * telefono "Tira i dadi" e "Fine" stanno appaiati — spostare un bersaglio
 * mentre il dito è già in aria è il modo migliore per far premere la cosa
 * sbagliata.
 *
 * Chi ha bisogno di logica propria attorno all'invio (chiudere un compositore,
 * una conferma a due passi, un importo da calcolare) continua a chiamare
 * `inviaAzione` da sé e prende lo stato d'attesa con `useAzioneInVolo`: questo
 * componente è la scorciatoia per il caso normale, non un passaggio obbligato.
 */
export default function BottoneAzione({
  evento,
  payload,
  alSuccesso,
  className = 'btn-primary',
  style,
  disabled,
  title,
  'aria-label': ariaLabel,
  children,
}: {
  /** L'evento del motore, gli stessi nomi di server.js: `roll_dice`, `buy_property`… */
  evento: string;
  payload?: unknown;
  /** Chiamata solo se il server ha accettato davvero (vedi inviaAzione). */
  alSuccesso?: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Motivi PROPRI del componente per tenerlo spento; l'attesa si aggiunge da sé. */
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
  children: ReactNode;
}) {
  const chiave = chiaveAzione(evento, payload);
  const inVolo = useAzioneInVolo(chiave);
  const attesa = useAttesaVisibile(inVolo);

  return (
    <button
      className={[className, inVolo && 'comando-in-volo', attesa && 'comando-in-attesa']
        .filter(Boolean)
        .join(' ')}
      style={style}
      title={title}
      aria-label={ariaLabel}
      // Per chi non guarda lo schermo la riga che scorre non esiste: aria-busy è
      // il modo standard di dire "questo comando sta lavorando", e senza
      // resterebbe solo un bottone diventato inerte, cioè di nuovo un bottone
      // che sembra rotto — lo stesso difetto, spostato su chi usa un lettore.
      aria-busy={inVolo || undefined}
      disabled={disabled || inVolo}
      onClick={() => inviaAzione(evento, payload ?? {}, alSuccesso ? { alSuccesso } : undefined)}
    >
      {children}
    </button>
  );
}
