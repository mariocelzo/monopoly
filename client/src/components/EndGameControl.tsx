import { useState } from 'react';
import { GameState, inviaAzione } from '../socket';
import { TOUCH_TARGET } from '../touchTarget';

/**
 * Uscita anticipata dal tavolo. Due comandi diversi, che facevano la stessa
 * cosa quando si giocava solo in due e oggi non più:
 *  - "Chiudi il tavolo" (solo chi lo ha creato) finisce la partita per tutti e
 *    distrugge la stanza: il codice smette di valere;
 *  - "Abbandona" fa uscire solo chi lo preme. Le sue proprietà tornano libere e
 *    la partita PROSEGUE fra i rimanenti (vedi abandonGame in gameEngine.js).
 *    In due questo coincide con la vittoria a tavolino dell'altro, perché resta
 *    lui solo; da tre in su la partita continua senza chi è uscito, e il tavolo
 *    resta in piedi.
 * Il testo di conferma diceva "la vittoria va all'altro giocatore" e questo
 * commento diceva che la stanza si distrugge in ogni caso: era vero finché i
 * giocatori erano due, ma adesso possono essere fino a sei.
 *
 * In entrambi i casi si chiede conferma: il bottone si trasforma invece di
 * aprire un modale, così basta un tocco per ripensarci.
 */
export default function EndGameControl({
  state,
  myId,
  compact = false,
}: {
  state: GameState;
  myId: string;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const isHost = state.hostId === myId;

  if (state.finished) return null;

  // Quanti restano in partita oltre a chi sta guardando: è il numero che
  // decide cosa vuol dire davvero abbandonare. Con uno solo si cede la
  // vittoria, con più di uno la partita va avanti senza di noi. I falliti non
  // si contano: sono già fuori.
  const altriInGioco = state.players.filter((p) => p.id !== myId && !p.bankrupt).length;

  const label = isHost ? 'Chiudi il tavolo' : 'Abbandona';
  const question = isHost
    ? 'Chiudere il tavolo? La partita finisce per tutti e il codice non varrà più.'
    : altriInGioco <= 1
      ? 'Abbandonare? Resti fuori dalla partita e la vittoria va all\'altro giocatore.'
      : 'Abbandonare? Esci solo tu: le tue proprietà tornano libere e la partita prosegue fra gli altri.';

  const confirm = () => {
    // La conferma si richiude comunque, anche se il server rifiuta: le due
    // uscite possibili sono entrambe definitive e un rifiuto qui vuol dire che
    // la partita è già finita per altra via (l'avversario è fallito mentre si
    // stava per abbandonare). Riaprire la domanda su un tavolo già chiuso
    // chiederebbe di confermare una cosa che non esiste più; il perché lo
    // racconta l'avviso.
    inviaAzione(isHost ? 'end_game' : 'abandon_game');
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <button
        className="btn-ghost"
        style={{ ...styles.button, ...(compact ? styles.compact : null) }}
        onClick={() => setConfirming(true)}
      >
        {isHost ? '✕ ' : '🏳️ '}{label}
      </button>
    );
  }

  return (
    <div style={styles.confirmBox}>
      <p style={styles.question}>{question}</p>
      <div style={styles.row}>
        <button className="btn-ghost" style={styles.danger} onClick={confirm}>
          Sì, {isHost ? 'chiudi' : 'abbandono'}
        </button>
        <button className="btn-ghost" style={styles.cancel} onClick={() => setConfirming(false)}>
          Annulla
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Deve essere trovabile a colpo d'occhio: bordo e testo del colore del
  // pericolo, e un bersaglio pieno. Dalle uscite accidentali protegge la
  // conferma a due passi, non il fatto di renderlo piccolo.
  button: {
    width: '100%',
    minHeight: TOUCH_TARGET,
    fontSize: '0.95rem',
    fontWeight: 700,
    borderColor: 'rgba(179,58,58,0.65)',
    color: '#e8a0a0',
  },
  compact: { minHeight: 50, fontSize: '1rem' },
  confirmBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    border: '1px solid rgba(179,58,58,0.5)',
    background: 'rgba(179,58,58,0.12)',
  },
  question: { fontSize: '0.78rem', color: 'var(--paper)', margin: 0, lineHeight: 1.4 },
  row: { display: 'flex', gap: 8 },
  danger: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.85rem', borderColor: 'var(--danger)', color: '#e18a8a' },
  cancel: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.85rem' },
};
