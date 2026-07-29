import { BoardSquare, GameState, socket } from '../socket';
import PropertiesPanel from './PropertiesPanel';
import EndGameControl from './EndGameControl';
import HomeButton from './HomeButton';
import InviteLink from './InviteLink';
import HouseRules from './HouseRules';

export default function GamePanel({
  state,
  myId,
  board,
  onProposeTrade,
  onLeave,
}: {
  state: GameState;
  myId: string;
  board: BoardSquare[];
  onProposeTrade: () => void;
  onLeave: () => void;
}) {
  const current = state.players[state.turnIndex];
  const isMyTurn = current?.id === myId;
  const me = state.players.find((p) => p.id === myId);

  // Il tiro extra da doppio confondeva: sembrava che il gioco facesse tirare
  // due volte a caso. Ora lo si dice.
  const rolledDouble =
    !!state.lastRoll &&
    state.lastRoll.playerId === current?.id &&
    state.lastRoll.dice[0] === state.lastRoll.dice[1];

  const roll = () => socket.emit('roll_dice', {});
  const payJail = () => socket.emit('pay_jail_fine', {});
  const useCard = () => socket.emit('use_jail_card', {});
  const endTurn = () => socket.emit('end_turn', {});

  return (
    <div className="panel" style={styles.wrap}>
      <div style={styles.roomCode}>
        Codice tavolo: <span className="mono" style={{ color: 'var(--brass-2)' }}>{state.roomCode}</span>
      </div>
      {state.players.length < 6 && <InviteLink roomCode={state.roomCode} />}

      <div style={styles.players}>
        {state.players.map((p) => (
          <div
            key={p.id}
            style={{
              ...styles.playerCard,
              borderColor: p.id === current?.id ? 'var(--brass)' : 'rgba(201,150,44,0.15)',
              opacity: p.bankrupt ? 0.4 : 1,
            }}
          >
            <span style={{ fontSize: '1.3rem' }}>{p.token}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.name}{p.id === myId ? ' (tu)' : ''}
                {p.isBot && <span style={styles.botTag}>BOT</span>}
                {p.isBot && !state.started && state.hostId === myId && (
                  <button
                    style={styles.removeBot}
                    title="Togli questo bot"
                    onClick={() => socket.emit('remove_bot', { botId: p.id })}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div
                className={`mono ${p.balance < 0 ? 'money-negative' : ''}`}
                style={{ fontSize: '1.1rem' }}
              >
                €{p.balance}
              </div>
              {p.inJail && <div style={styles.badge}>In prigione ({p.jailTurns}/3)</div>}
              {!p.connected && !p.bankrupt && <div style={styles.offline}>Disconnesso…</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Riempire il tavolo di bot è una scelta di chi lo ha creato, e solo
          prima del via: a partita iniziata i posti sono quelli. */}
      {!state.started && state.hostId === myId && state.players.length < 6 && (
        <button
          className="btn-ghost"
          style={styles.addBot}
          onClick={() => socket.emit('add_bot', {})}
        >
          + Aggiungi bot
        </button>
      )}

      {/* Le regole si scelgono solo prima del via: a partita iniziata questo
          blocco sparisce e le regole restano quelle scelte, mostrate sola
          lettura dentro il tabellone finché la partita dura. */}
      {!state.started && <HouseRules state={state} myId={myId} />}

      <div style={styles.turnBox}>
        {!state.started ? (
          <button className="btn-primary" onClick={() => socket.emit('start_game')}>
            Inizia partita
          </button>
        ) : state.finished ? (
          <span style={{ color: 'rgba(243,234,216,0.6)' }}>Partita finita</span>
        ) : isMyTurn && me?.inJail ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={roll}>Tira i dadi (esci con doppio)</button>
            <button className="btn-ghost" onClick={payJail}>Paga €50</button>
            {me.jailCards > 0 && <button className="btn-ghost" onClick={useCard}>Usa carta uscita</button>}
          </div>
        ) : isMyTurn ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rolledDouble && <div style={styles.doubleHint}>Doppio! Tiri ancora.</div>}
            <button className="btn-primary" onClick={roll} disabled={!!state.pendingAction}>
              Tira i dadi
            </button>
            <button className="btn-ghost" onClick={endTurn} disabled={!!state.pendingAction}>
              Fine turno
            </button>
          </div>
        ) : (
          <span style={{ color: 'rgba(243,234,216,0.6)' }}>Turno di {current?.name}...</span>
        )}
      </div>

      {state.started && !state.finished && (
        <button
          className="btn-ghost"
          style={styles.tradeBtn}
          onClick={onProposeTrade}
          disabled={!!state.pendingAction}
          title={state.pendingAction ? 'Prima risolvi l\'azione in sospeso' : 'Proponi uno scambio'}
        >
          Proponi scambio
        </button>
      )}

      {state.started && (
        <div style={styles.properties}>
          <h3 style={styles.sectionTitle}>Le mie proprietà</h3>
          <PropertiesPanel board={board} state={state} myId={myId} />
        </div>
      )}

      <div style={styles.exits}>
        <HomeButton roomCode={state.roomCode} onLeave={onLeave} />
        {state.started && <EndGameControl state={state} myId={myId} />}
      </div>

      <div style={styles.log}>
        {state.log.slice().reverse().map((entry, i) => (
          <div key={i} style={styles.logLine}>{entry.message}</div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { width: 320, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: 'fit-content' },
  roomCode: { fontSize: '0.85rem', color: 'rgba(243,234,216,0.6)' },
  players: { display: 'flex', flexDirection: 'column', gap: 8 },
  playerCard: { display: 'flex', gap: 10, alignItems: 'center', padding: 10, borderRadius: 10, border: '1.5px solid', background: 'rgba(0,0,0,0.15)' },
  badge: { fontSize: '0.7rem', color: '#e18a8a', marginTop: 2 },
  // Azzurro, distinto dall'ottone dei giocatori veri: un bot si riconosce a
  // colpo d'occhio senza confonderlo con un umano disconnesso.
  botTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.58rem',
    letterSpacing: '0.08em',
    padding: '1px 5px',
    borderRadius: 4,
    border: '1px solid rgba(126,200,227,0.5)',
    color: '#7EC8E3',
  },
  removeBot: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: 'rgba(243,234,216,0.45)',
    fontSize: '0.85rem',
    cursor: 'pointer',
    padding: '0 4px',
  },
  addBot: { width: '100%', fontSize: '0.82rem', padding: '8px 14px' },
  offline: { fontSize: '0.7rem', color: 'rgba(243,234,216,0.45)', marginTop: 2, fontStyle: 'italic' },
  turnBox: { paddingTop: 8, borderTop: '1px solid rgba(201,150,44,0.2)' },
  doubleHint: { width: '100%', fontSize: '0.8rem', color: 'var(--brass-2)', marginBottom: 2 },
  tradeBtn: { width: '100%', fontSize: '0.85rem', padding: '8px 14px' },
  properties: { paddingTop: 12, borderTop: '1px solid rgba(201,150,44,0.2)', maxHeight: 300, overflowY: 'auto' },
  sectionTitle: { fontSize: '0.95rem', marginBottom: 10, color: 'var(--paper)' },
  exits: { display: 'flex', flexDirection: 'column', gap: 8 },
  log: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'rgba(243,234,216,0.75)' },
  logLine: { borderLeft: '2px solid rgba(201,150,44,0.3)', paddingLeft: 8 },
};
