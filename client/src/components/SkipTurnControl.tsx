import { useEffect, useMemo, useState } from 'react';
import { GameState, inviaAzione } from '../socket';
import { skipTurnPrompt } from '../skipTurn';
import { TOUCH_TARGET } from '../touchTarget';

/**
 * Il rimedio a una partita ferma perché chi ha il turno è caduto: gli altri
 * possono far proseguire il giro senza aspettarlo.
 *
 * Tre stati, in quest'ordine e mai fuori da qui:
 *  1. finché l'attesa non è scaduta si vede solo un avviso col conto alla
 *     rovescia — serve a spiegare perché il tabellone è fermo, che è la prima
 *     domanda di chi guarda, e a far capire che qualcosa si potrà fare;
 *  2. scaduta l'attesa compare il bottone;
 *  3. premuto il bottone si trasforma in una conferma che dice cosa succede
 *     davvero. È il punto più importante di tutto il componente: "salta" da
 *     solo suona come "caccia", e nessuno vuole cacciare l'altro dal tavolo
 *     per un telefono scarico. Va detto a chiare lettere che non è così.
 *
 * Il conto alla rovescia è locale: il server manda quanto manca (una durata,
 * vedi BlockedTurn in socket.ts) al momento in cui trasmette lo stato, e da lì
 * in poi non trasmette più niente — non succede nulla, è esattamente il
 * problema. Se il tempo lo aspettasse il server, il bottone comparirebbe solo
 * al prossimo evento, cioè mai.
 */
export default function SkipTurnControl({
  state,
  myId,
  compact = false,
}: {
  state: GameState;
  myId: string;
  compact?: boolean;
}) {
  const [confermando, setConfermando] = useState(false);
  const [ora, setOra] = useState(() => Date.now());

  const bloccato = state.turnoBloccato ?? null;

  // Istante locale in cui l'attesa scade, calcolato DURANTE il render (non in
  // un effetto) perché al primo giro il conto dev'essere già giusto: con un
  // effetto ci sarebbe un fotogramma con "mancano 0 secondi" e il bottone già
  // premibile. Si ricalcola solo quando arriva una segnalazione diversa.
  const scadenza = useMemo(
    () => (bloccato ? Date.now() + bloccato.attesaRimanenteMs : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bloccato?.playerId, bloccato?.attesaRimanenteMs]
  );

  useEffect(() => {
    if (scadenza === null) return;
    const timer = setInterval(() => {
      setOra(Date.now());
      // Scaduta l'attesa non c'è più niente da contare: il timer si spegne da
      // sé invece di far ridisegnare il pannello ogni mezzo secondo per tutto
      // il tempo in cui l'altro resta offline.
      if (Date.now() >= scadenza) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [scadenza]);

  // Un cambio di giocatore fermo (o il suo rientro) azzera la conferma a metà:
  // altrimenti resterebbe lì una domanda su una situazione che non c'è più.
  useEffect(() => {
    setConfermando(false);
  }, [bloccato?.playerId]);

  const prompt = skipTurnPrompt(state, myId, scadenza === null ? 0 : scadenza - ora);
  if (!prompt) return null;

  const nome = prompt.player.name;

  if (!prompt.ready) {
    return (
      <div style={styles.attesa}>
        {nome} è disconnesso. Se non rientra, fra {prompt.secondsLeft}s potrai saltare il suo turno.
      </div>
    );
  }

  const salta = () => {
    // Passa dal canale comune (vedi azioni.ts): il server ricontrolla tutto e
    // può rifiutare perché nel frattempo è rientrato, o perché il tavolo
    // aspetta la risposta di un altro. Il motivo lo mostra l'avviso unico
    // dell'applicazione, invece di un secondo posto che dice le stesse cose in
    // modo diverso. La conferma si chiude solo se il salto è davvero avvenuto.
    inviaAzione('skip_turn', {}, { alSuccesso: () => setConfermando(false) });
  };

  if (!confermando) {
    return (
      <button
        className="btn-ghost"
        style={{ ...styles.bottone, ...(compact ? styles.compatto : null) }}
        onClick={() => setConfermando(true)}
      >
        ⏭ Salta il turno di {nome}
      </button>
    );
  }

  return (
    <div style={styles.riquadro}>
      <p style={styles.domanda}>
        Saltare il turno di {nome}? Salta <strong>solo questo giro</strong>: resta al tavolo con le
        sue proprietà, i suoi soldi e la sua posizione, e riprende appena rientra. Non lo stai
        buttando fuori dalla partita.
      </p>
      {state.pendingAction?.playerId === prompt.player.id && (
        <p style={styles.dettaglio}>
          Quello che aveva in sospeso viene chiuso al posto suo nel modo che gli costa meno: paga
          quello che deve, rinuncia a comprare, passa all'asta. Non si arrende mai per lui.
        </p>
      )}
      <div style={styles.riga}>
        <button className="btn-primary" style={styles.conferma} onClick={salta}>
          Sì, salta il turno
        </button>
        <button
          className="btn-ghost"
          style={styles.annulla}
          onClick={() => setConfermando(false)}
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Colore dell'avviso, non del pericolo: qui non si distrugge niente. Il
  // rosso è di "Abbandona" e "Chiudi il tavolo" (vedi EndGameControl), e usarlo
  // anche qui suggerirebbe una gravità che questo comando non ha.
  attesa: {
    fontSize: '0.75rem',
    lineHeight: 1.4,
    color: 'rgba(243,234,216,0.6)',
    fontStyle: 'italic',
  },
  bottone: {
    width: '100%',
    minHeight: TOUCH_TARGET,
    fontSize: '0.85rem',
    fontWeight: 600,
    borderColor: 'rgba(201,150,44,0.55)',
    color: 'var(--brass-2)',
  },
  compatto: { minHeight: 44, fontSize: '0.88rem' },
  riquadro: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    border: '1px solid rgba(201,150,44,0.45)',
    background: 'rgba(201,150,44,0.10)',
  },
  domanda: { fontSize: '0.78rem', color: 'var(--paper)', margin: 0, lineHeight: 1.45 },
  dettaglio: { fontSize: '0.72rem', color: 'rgba(243,234,216,0.65)', margin: 0, lineHeight: 1.4 },
  riga: { display: 'flex', gap: 8 },
  conferma: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.85rem' },
  annulla: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.85rem' },
};
