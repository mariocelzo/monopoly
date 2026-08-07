import { useEffect, useRef, useState } from 'react';
import {
  avanzamentoRisveglio,
  secondiAlRisveglio,
  useStatoCollegamento,
} from '../statoCollegamento';

/**
 * Quanto resta a schermo la conferma dopo un risveglio riuscito. Serve solo a
 * chiudere il cerchio: chi ha letto "ci vogliono una ventina di secondi" deve
 * vedere che quei secondi sono finiti, non solo veder sparire un riquadro.
 */
const DURATA_PRONTO_MS = 2500;

/**
 * Racconta l'attesa del collegamento al posto di lasciare una pagina ferma.
 *
 * IL CASO CHE COPRE
 * Il backend gira su un piano gratuito che spegne il servizio dopo un quarto
 * d'ora di inattività: la prima azione della serata paga la riaccensione, 22,9
 * secondi cronometrati in produzione. Chi apriva la pagina in quel momento
 * vedeva un'interfaccia che non rispondeva e concludeva che fosse rotta —
 * l'unica conclusione ragionevole, visto che niente diceva il contrario.
 *
 * Tre stati, e la differenza fra i primi due è tutto il punto:
 *  - **collegamento** (i primi istanti): una riga sottile e neutra. Dire "il
 *    server dorme" qui sarebbe falso il 99% delle sere, e un avviso che grida
 *    al lupo su un collegamento normale insegna a ignorarlo;
 *  - **risveglio** (oltre la soglia): si spiega cosa sta succedendo, PERCHÉ, e
 *    quanto ci vuole. La barra e il conto alla rovescia non sono decorazione:
 *    un'attesa con una fine dichiarata si sopporta, la stessa attesa muta no.
 *    Il conto è una stima e viene detto — quando scade, il testo cambia invece
 *    di continuare a promettere una fine già mancata;
 *  - **pronto**: due secondi e mezzo di conferma, poi sparisce.
 *
 * Sta nella lobby, dove il tempo si recupera: il socket si collega al
 * caricamento della pagina (vedi App.tsx), quindi il risveglio è già in corso
 * mentre si sceglie nome e pedone. I venti secondi peggiori diventano venti
 * secondi in cui si sta comunque facendo qualcosa — ed è per questo che
 * l'avviso NON blocca né spegne niente: si può scrivere, scegliere il pedone e
 * anche premere "Crea tavolo", perché l'invio parte comunque appena il
 * collegamento c'è (la coda ce l'ha già socket.io).
 */
export default function AvvisoRisveglio({ nota }: {
  /**
   * Cosa si può fare intanto. Cambia col posto da cui si guarda — nella lobby
   * c'è un nome da scegliere, sulla schermata di rientro non c'è niente da fare
   * se non aspettare — e una frase sola per entrambi mentirebbe da una parte o
   * dall'altra.
   */
  nota: string;
}) {
  const { fase, attesaMs } = useStatoCollegamento();
  const [mostraPronto, setMostraPronto] = useState(false);
  // Se si sia mai visto un risveglio in questa sessione: la conferma "pronto"
  // ha senso solo dopo un'attesa lunga. Un collegamento istantaneo non ha
  // bisogno di essere annunciato — sarebbe un riquadro che compare per due
  // secondi ogni volta che si apre la pagina, cioè rumore.
  const attesaLunga = useRef(false);

  useEffect(() => {
    if (fase === 'risveglio') attesaLunga.current = true;
    if (fase !== 'collegato' || !attesaLunga.current) return;
    attesaLunga.current = false;
    setMostraPronto(true);
    const timer = setTimeout(() => setMostraPronto(false), DURATA_PRONTO_MS);
    return () => clearTimeout(timer);
  }, [fase]);

  if (fase === 'collegato') {
    if (!mostraPronto) return null;
    return (
      <p role="status" aria-live="polite" style={styles.pronto}>
        Il tavolo è sveglio: da qui in poi si gioca alla velocità normale.
      </p>
    );
  }

  if (fase === 'collegamento') {
    return (
      <p role="status" aria-live="polite" style={styles.discreto}>
        Collegamento al tavolo…
      </p>
    );
  }

  const secondi = secondiAlRisveglio(attesaMs);

  return (
    // role/aria-live: chi usa un lettore di schermo deve sapere che il risveglio
    // sta succedendo, non solo vederlo scritto — stessa ragione dell'avviso di
    // rifiuto (vedi AvvisoAzione.tsx). "polite" perché non c'è niente da
    // interrompere: è un'attesa, non un allarme.
    <div role="status" aria-live="polite" style={styles.riquadro}>
      <p style={styles.testo}>
        Il tavolo dorme quando resta fermo troppo a lungo, e si sta svegliando
        adesso. {secondi > 0
          ? `Ancora una ventina di secondi (${secondi}s circa).`
          : 'Ci sta mettendo più del solito: ancora qualche secondo.'}
      </p>
      {/* aria-hidden: il conto alla rovescia è già scritto qui sopra, e una
          barra letta ad alta voce come "progresso 47 per cento" ripeterebbe la
          stessa cosa in modo peggiore. */}
      <div style={styles.barra} aria-hidden="true">
        <div style={{ ...styles.riempimento, width: `${avanzamentoRisveglio(attesaMs)}%` }} />
      </div>
      <p style={styles.nota}>{nota}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Non un errore (niente rosso): è un tavolo che si sta aprendo, solo più
  // lentamente del solito.
  discreto: {
    color: 'rgba(27,36,48,0.5)',
    fontSize: '0.78rem',
    margin: '10px 0 0',
    fontStyle: 'italic',
  },
  pronto: { color: 'var(--brass)', fontSize: '0.82rem', margin: '10px 0 0' },
  riquadro: {
    marginTop: 12,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid rgba(201,150,44,0.35)',
    background: 'rgba(201,150,44,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  testo: { color: 'rgba(27,36,48,0.85)', fontSize: '0.82rem', margin: 0, lineHeight: 1.45 },
  barra: { height: 4, borderRadius: 2, background: 'rgba(27,36,48,0.15)', overflow: 'hidden' },
  // La transizione copre il mezzo secondo fra un aggiornamento e il successivo:
  // senza, la barra avanzerebbe a scatti, e una barra a scatti si legge come
  // "si è inceppato" proprio mentre sta invece andando avanti.
  riempimento: { height: '100%', background: 'var(--brass)', transition: 'width 0.5s linear' },
  nota: { color: 'rgba(27,36,48,0.5)', fontSize: '0.74rem', margin: 0, lineHeight: 1.4 },
};
