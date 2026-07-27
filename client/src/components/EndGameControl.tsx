import { useState } from 'react';
import { GameState, socket } from '../socket';

/**
 * Uscita anticipata dal tavolo. Chi lo ha creato può chiuderlo per entrambi,
 * l'altro può abbandonare cedendo la vittoria. In ogni caso la stanza viene
 * distrutta e il codice smette di valere, quindi si chiede conferma: il bottone
 * si trasforma invece di aprire un modale, così basta un tocco per ripensarci.
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

  const label = isHost ? 'Chiudi il tavolo' : 'Abbandona';
  const question = isHost
    ? 'Chiudere il tavolo? La partita finisce per entrambi e il codice non varrà più.'
    : 'Abbandonare? La vittoria va all\'altro giocatore.';

  const confirm = () => {
    socket.emit(isHost ? 'end_game' : 'abandon_game', {});
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
    minHeight: 46,
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
  danger: { flex: 1, minHeight: 44, fontSize: '0.85rem', borderColor: 'var(--danger)', color: '#e18a8a' },
  cancel: { flex: 1, minHeight: 44, fontSize: '0.85rem' },
};
