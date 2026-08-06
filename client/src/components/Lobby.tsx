import { useState } from 'react';
import { collegaSocket, socket } from '../socket';
import { getClientId, saveRoom } from '../identity';
import AvvisoRisveglio from './AvvisoRisveglio';

const TOKENS = ['🐕', '🎩', '🚗', '🚢', '🐈', '🎸'];

export default function Lobby({
  onJoined,
  inviteCode,
  onDismissInvite,
}: {
  onJoined: (roomCode: string, playerId: string) => void;
  /** Codice letto da un link di invito: salta dritto a "unisciti". */
  inviteCode?: string | null;
  /** Chiamata quando si sceglie di ignorare l'invito e creare un tavolo proprio. */
  onDismissInvite?: () => void;
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState(TOKENS[0]);
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'join' | 'invite'>(
    inviteCode ? 'invite' : 'choose'
  );
  const [error, setError] = useState<string | null>(null);
  // Pedoni già occupati nella stanza: il server li comunica quando rifiuta
  // l'ingresso, così alla prova successiva sono già disabilitati.
  const [taken, setTaken] = useState<string[]>([]);
  // In attesa della risposta del server: disabilita i bottoni (un secondo clic
  // mentre il primo è ancora appeso creerebbe un secondo tavolo, non solo un
  // fastidio visivo) e cambia l'etichetta, così il tocco ha un riscontro
  // immediato anche quando la risposta ci mette un po'.
  //
  // Il messaggio sul server addormentato NON sta più qui. Prima si indovinava
  // a posteriori — mandata la richiesta, se dopo 2,5 secondi non tornava
  // niente si diceva "si sta svegliando" — e aveva due difetti: compariva solo
  // DOPO un clic, quando il risveglio era già in corso da un pezzo (il socket
  // si collega al caricamento della pagina, vedi App.tsx), e misurava la
  // lentezza di una risposta invece del fatto vero, cioè che la connessione non
  // c'è ancora. Adesso lo racconta AvvisoRisveglio guardando il collegamento,
  // che lo sa prima e lo sa con certezza (vedi statoCollegamento.ts).
  const [pending, setPending] = useState(false);

  /** Gestisce la risposta del server sia per la creazione sia per l'ingresso. */
  const handleResponse = (res: any) => {
    setPending(false);
    if (res.error) {
      setError(res.error);
      if (Array.isArray(res.takenTokens)) {
        setTaken(res.takenTokens);
        // Se il pedone scelto è occupato, si passa al primo libero.
        const free = TOKENS.find((t) => !res.takenTokens.includes(t));
        if (res.takenTokens.includes(token) && free) setToken(free);
      }
      return;
    }
    // Il tavolo si ricorda: alla riapertura si rientra da soli.
    saveRoom(res.roomCode);
    onJoined(res.roomCode, res.playerId);
  };

  /** Avvia l'attesa: va chiamata subito prima di ogni emit verso il server. */
  const avviaAttesa = () => {
    setError(null);
    setPending(true);
  };

  const createRoom = () => {
    if (pending) return;
    if (!name.trim()) return setError('Inserisci un nome');
    // collegaSocket e non socket.connect: segna l'istante da cui si aspetta, che
    // è quello che distingue "un attimo" da "il servizio sta ripartendo".
    collegaSocket();
    avviaAttesa();
    socket.emit('create_room', { name, token, clientId: getClientId() }, handleResponse);
  };

  /** Unisciti con un codice: quello digitato a mano, o quello del link. */
  const joinRoom = (code: string) => {
    if (pending) return;
    if (!name.trim()) return setError('Inserisci un nome');
    if (!code.trim()) return setError('Inserisci il codice stanza');
    collegaSocket();
    avviaAttesa();
    socket.emit(
      'join_room',
      { roomCode: code.toUpperCase(), name, token, clientId: getClientId() },
      handleResponse
    );
  };

  const isInvite = mode === 'invite' && !!inviteCode;

  return (
    <div style={styles.wrap}>
      <div style={styles.hero}>
        <span style={styles.eyebrow}>
          {isInvite ? 'invito ricevuto' : 'tavolo privato · da 2 a 6 giocatori'}
        </span>
        <h1 style={styles.title}>Noi Due Monopoly</h1>
        <p style={styles.subtitle}>
          {isInvite
            ? 'Sei stato invitato a un tavolo: scegli nome e pedone per entrare.'
            : 'Crea un tavolo o unisciti con un codice.'}
        </p>
      </div>

      <div className="panel" style={styles.card}>
        {isInvite && (
          <div style={styles.inviteBadge}>
            Tavolo <span className="mono" style={styles.inviteCode}>{inviteCode}</span>
          </div>
        )}

        <label style={styles.label}>Il tuo nome</label>
        <input
          style={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mario"
        />

        <label style={styles.label}>Il tuo pedone</label>
        <div style={styles.tokenRow}>
          {TOKENS.map((t) => {
            const isTaken = taken.includes(t);
            return (
              <button
                key={t}
                onClick={() => setToken(t)}
                disabled={isTaken}
                title={isTaken ? 'Pedone già preso' : undefined}
                style={{
                  ...styles.tokenBtn,
                  borderColor: token === t ? 'var(--brass)' : 'transparent',
                  background: token === t ? 'rgba(201,150,44,0.15)' : 'transparent',
                  opacity: isTaken ? 0.25 : 1,
                  cursor: isTaken ? 'not-allowed' : 'pointer',
                  filter: isTaken ? 'grayscale(1)' : 'none',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>

        {isInvite && (
          <>
            <div style={styles.actions}>
              <button className="btn-primary" disabled={pending} onClick={() => joinRoom(inviteCode!)}>
                {pending ? 'Un attimo…' : 'Entra nel tavolo'}
              </button>
            </div>
            <button
              style={styles.dismissLink}
              onClick={() => {
                setError(null);
                setMode('choose');
                onDismissInvite?.();
              }}
            >
              Preferisci creare un tavolo tuo?
            </button>
          </>
        )}

        {mode === 'choose' && (
          <div style={styles.actions}>
            <button className="btn-primary" disabled={pending} onClick={createRoom}>
              {pending ? 'Un attimo…' : 'Crea tavolo'}
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => setMode('join')}>Unisciti con codice</button>
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
              <button className="btn-primary" disabled={pending} onClick={() => joinRoom(joinCode)}>
                {pending ? 'Un attimo…' : 'Entra'}
              </button>
              <button className="btn-ghost" disabled={pending} onClick={() => setMode('choose')}>Indietro</button>
            </div>
          </>
        )}

        {/* Sotto ai comandi e non sopra al titolo: si legge quando si arriva
            a premere, che è il momento in cui l'attesa conta. Si disegna da
            solo quando serve e sparisce da solo quando il collegamento c'è. */}
        <AvvisoRisveglio nota="Puoi intanto scegliere nome e pedone: la partita parte appena è pronto." />

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
  inviteBadge: {
    alignSelf: 'center',
    marginBottom: 10,
    padding: '6px 16px',
    borderRadius: 999,
    border: '1px solid rgba(201,150,44,0.4)',
    background: 'rgba(201,150,44,0.1)',
    fontSize: '0.85rem',
    color: 'rgba(243,234,216,0.8)',
  },
  inviteCode: { color: 'var(--brass-2)', letterSpacing: '0.12em' },
  label: { fontSize: '0.8rem', color: 'rgba(243,234,216,0.6)', marginTop: 14, marginBottom: 6 },
  input: { padding: '11px 14px', borderRadius: 8, border: '1px solid rgba(201,150,44,0.3)', background: 'rgba(0,0,0,0.2)', color: 'var(--paper)', fontSize: '1rem' },
  tokenRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tokenBtn: { fontSize: '1.4rem', padding: '8px 10px', borderRadius: 8, border: '2px solid transparent', background: 'transparent' },
  actions: { display: 'flex', gap: 10, marginTop: 20 },
  dismissLink: {
    marginTop: 14,
    background: 'none',
    border: 'none',
    color: 'rgba(243,234,216,0.5)',
    fontSize: '0.78rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 0,
    alignSelf: 'center',
  },
  error: { color: '#e18a8a', fontSize: '0.85rem', marginTop: 10 },
};
