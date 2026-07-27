import { useState } from 'react';
import { socket } from '../socket';

const TOKENS = ['🐕', '🎩', '🚗', '🚢', '🐈', '🎸'];

export default function Lobby({
  onJoined,
}: {
  onJoined: (roomCode: string, playerId: string) => void;
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState(TOKENS[0]);
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'join'>('choose');
  const [error, setError] = useState<string | null>(null);

  const createRoom = () => {
    if (!name.trim()) return setError('Inserisci un nome');
    if (!socket.connected) socket.connect();
    socket.emit('create_room', { name, token }, (res: any) => {
      if (res.error) return setError(res.error);
      onJoined(res.roomCode, res.playerId);
    });
  };

  const joinRoom = () => {
    if (!name.trim()) return setError('Inserisci un nome');
    if (!joinCode.trim()) return setError('Inserisci il codice stanza');
    if (!socket.connected) socket.connect();
    socket.emit('join_room', { roomCode: joinCode.toUpperCase(), name, token }, (res: any) => {
      if (res.error) return setError(res.error);
      onJoined(res.roomCode, res.playerId);
    });
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.hero}>
        <span style={styles.eyebrow}>tavolo privato · 2 giocatori</span>
        <h1 style={styles.title}>Noi Due Monopoly</h1>
        <p style={styles.subtitle}>Crea un tavolo o unisciti con un codice.</p>
      </div>

      <div className="panel" style={styles.card}>
        <label style={styles.label}>Il tuo nome</label>
        <input
          style={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mario"
        />

        <label style={styles.label}>Il tuo pedone</label>
        <div style={styles.tokenRow}>
          {TOKENS.map((t) => (
            <button
              key={t}
              onClick={() => setToken(t)}
              style={{
                ...styles.tokenBtn,
                borderColor: token === t ? 'var(--brass)' : 'transparent',
                background: token === t ? 'rgba(201,150,44,0.15)' : 'transparent',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {mode === 'choose' && (
          <div style={styles.actions}>
            <button className="btn-primary" onClick={createRoom}>Crea tavolo</button>
            <button className="btn-ghost" onClick={() => setMode('join')}>Unisciti con codice</button>
          </div>
        )}

        {mode === 'join' && (
          <>
            <label style={styles.label}>Codice stanza</label>
            <input
              style={{ ...styles.input, fontFamily: 'var(--font-mono)', letterSpacing: '0.15em' }}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="AB12C"
              maxLength={5}
            />
            <div style={styles.actions}>
              <button className="btn-primary" onClick={joinRoom}>Entra</button>
              <button className="btn-ghost" onClick={() => setMode('choose')}>Indietro</button>
            </div>
          </>
        )}

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 32 },
  hero: { textAlign: 'center', maxWidth: 480 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '3rem', marginTop: 8, color: 'var(--paper)' },
  subtitle: { color: 'rgba(243,234,216,0.7)', marginTop: 8 },
  card: { padding: 32, width: 380, display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: '0.8rem', color: 'rgba(243,234,216,0.6)', marginTop: 14, marginBottom: 6 },
  input: { padding: '11px 14px', borderRadius: 8, border: '1px solid rgba(201,150,44,0.3)', background: 'rgba(0,0,0,0.2)', color: 'var(--paper)', fontSize: '1rem' },
  tokenRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tokenBtn: { fontSize: '1.4rem', padding: '8px 10px', borderRadius: 8, border: '2px solid transparent', background: 'transparent' },
  actions: { display: 'flex', gap: 10, marginTop: 20 },
  error: { color: '#e18a8a', fontSize: '0.85rem', marginTop: 10 },
};
