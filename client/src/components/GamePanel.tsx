import { BoardSquare, GameState, socket } from '../socket';
import PropertiesPanel from './PropertiesPanel';

export default function GamePanel({
  state,
  myId,
  board,
}: {
  state: GameState;
  myId: string;
  board: BoardSquare[];
}) {
  const current = state.players[state.turnIndex];
  const isMyTurn = current?.id === myId;
  const me = state.players.find((p) => p.id === myId);

  const roll = () => socket.emit('roll_dice', {});
  const payJail = () => socket.emit('pay_jail_fine', {});
  const useCard = () => socket.emit('use_jail_card', {});
  const endTurn = () => socket.emit('end_turn', {});

  return (
    <div className="panel" style={styles.wrap}>
      <div style={styles.roomCode}>
        Codice tavolo: <span className="mono" style={{ color: 'var(--brass-2)' }}>{state.roomCode}</span>
      </div>

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
              <div style={{ fontWeight: 600 }}>{p.name}{p.id === myId ? ' (tu)' : ''}</div>
              <div
                className={`mono ${p.balance < 0 ? 'money-negative' : ''}`}
                style={{ fontSize: '1.1rem' }}
              >
                €{p.balance}
              </div>
              {p.inJail && <div style={styles.badge}>In prigione ({p.jailTurns}/3)</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={styles.turnBox}>
        {!state.started ? (
          <button className="btn-primary" onClick={() => socket.emit('start_game')}>
            Inizia partita
          </button>
        ) : isMyTurn && me?.inJail ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={roll}>Tira i dadi (esci con doppio)</button>
            <button className="btn-ghost" onClick={payJail}>Paga €50</button>
            {me.jailCards > 0 && <button className="btn-ghost" onClick={useCard}>Usa carta uscita</button>}
          </div>
        ) : isMyTurn ? (
          <div style={{ display: 'flex', gap: 8 }}>
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

      {state.started && (
        <div style={styles.properties}>
          <h3 style={styles.sectionTitle}>Le mie proprietà</h3>
          <PropertiesPanel board={board} state={state} myId={myId} />
        </div>
      )}

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
  turnBox: { paddingTop: 8, borderTop: '1px solid rgba(201,150,44,0.2)' },
  properties: { paddingTop: 12, borderTop: '1px solid rgba(201,150,44,0.2)', maxHeight: 300, overflowY: 'auto' },
  sectionTitle: { fontSize: '0.95rem', marginBottom: 10, color: 'var(--paper)' },
  log: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'rgba(243,234,216,0.75)' },
  logLine: { borderLeft: '2px solid rgba(201,150,44,0.3)', paddingLeft: 8 },
};
