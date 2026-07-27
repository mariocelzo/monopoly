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
        {label}
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
  button: { width: '100%', fontSize: '0.82rem', padding: '8px 14px', opacity: 0.75 },
  compact: { minHeight: 42, fontSize: '0.88rem', opacity: 1 },
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
  danger: { flex: 1, minHeight: 38, fontSize: '0.8rem', borderColor: 'var(--danger)', color: '#e18a8a' },
  cancel: { flex: 1, minHeight: 38, fontSize: '0.8rem' },
};
