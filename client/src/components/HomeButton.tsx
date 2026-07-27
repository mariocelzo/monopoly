import { useState } from 'react';
import { socket } from '../socket';

/**
 * Torna alla home lasciando il tavolo in piedi. Non è una resa: la partita
 * resta dov'è e si rientra col codice. Serve quando si vuole solo uscire dalla
 * schermata, senza regalare la vittoria all'altro.
 */
export default function HomeButton({
  roomCode,
  onLeave,
  compact = false,
}: {
  roomCode: string;
  onLeave: () => void;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const leave = () => {
    // Prima si avvisa il server, così l'altro ci vede offline invece di
    // aspettare un turno che non arriverebbe mai.
    socket.emit('leave_table', {}, () => onLeave());
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <button
        className="btn-ghost"
        style={{ ...styles.button, ...(compact ? styles.compact : null) }}
        onClick={() => setConfirming(true)}
      >
        ← Torna alla home
      </button>
    );
  }

  return (
    <div style={styles.box}>
      <p style={styles.question}>
        La partita resta dov'è: puoi rientrare col codice{' '}
        <span className="mono" style={styles.code}>{roomCode}</span>.
      </p>
      <div style={styles.row}>
        <button className="btn-ghost" style={styles.half} onClick={leave}>Esci</button>
        <button className="btn-ghost" style={styles.half} onClick={() => setConfirming(false)}>
          Resta
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: { width: '100%', fontSize: '0.82rem', padding: '8px 14px', opacity: 0.75 },
  compact: { minHeight: 42, fontSize: '0.88rem', opacity: 1 },
  box: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    border: '1px solid rgba(201,150,44,0.35)',
    background: 'rgba(0,0,0,0.2)',
  },
  question: { fontSize: '0.78rem', color: 'var(--paper)', margin: 0, lineHeight: 1.45 },
  code: { color: 'var(--brass-2)', letterSpacing: '0.12em' },
  row: { display: 'flex', gap: 8 },
  half: { flex: 1, minHeight: 38, fontSize: '0.8rem' },
};
