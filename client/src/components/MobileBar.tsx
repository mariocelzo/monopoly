import { useState } from 'react';
import { BoardSquare, GameState, socket } from '../socket';
import { PLAYER_COLORS } from './Board';
import PropertiesPanel from './PropertiesPanel';

type Sheet = 'proprieta' | 'registro' | null;

/**
 * Comandi di gioco su telefono: una barra fissa in fondo con saldi, turno e
 * dadi, sempre visibile sotto il tabellone, più un pannello che sale dal basso
 * per proprietà e registro. Così durante il turno non si scorre mai.
 */
export default function MobileBar({
  state,
  myId,
  board,
  onProposeTrade,
}: {
  state: GameState;
  myId: string;
  board: BoardSquare[];
  onProposeTrade: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);

  const current = state.players[state.turnIndex];
  const isMyTurn = current?.id === myId;
  const me = state.players.find((p) => p.id === myId);
  const blocked = !!state.pendingAction;

  const colorOf = (playerId: string) =>
    PLAYER_COLORS[state.players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];

  return (
    <>
      {sheet && (
        <div style={styles.sheetOverlay} onClick={() => setSheet(null)}>
          <div className="panel" style={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.grabber} />
            <div style={styles.sheetTabs}>
              <button
                className={sheet === 'proprieta' ? 'btn-primary' : 'btn-ghost'}
                style={styles.sheetTab}
                onClick={() => setSheet('proprieta')}
              >
                Proprietà
              </button>
              <button
                className={sheet === 'registro' ? 'btn-primary' : 'btn-ghost'}
                style={styles.sheetTab}
                onClick={() => setSheet('registro')}
              >
                Registro
              </button>
            </div>

            <div style={styles.sheetBody}>
              {sheet === 'proprieta' ? (
                <>
                  <PropertiesPanel board={board} state={state} myId={myId} />
                  <button
                    className="btn-ghost"
                    style={styles.tradeBtn}
                    disabled={blocked || state.finished}
                    onClick={() => {
                      setSheet(null);
                      onProposeTrade();
                    }}
                  >
                    Proponi scambio
                  </button>
                </>
              ) : (
                <>
                  <div style={styles.codeRow}>
                    Codice tavolo: <span className="mono" style={styles.code}>{state.roomCode}</span>
                  </div>
                  <div style={styles.log}>
                    {state.log.slice().reverse().map((entry, i) => (
                      <div key={i} style={styles.logLine}>{entry.message}</div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button className="btn-ghost" style={styles.closeSheet} onClick={() => setSheet(null)}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      <div style={styles.bar}>
        {/* Prima del via il codice serve per far entrare l'altro: va in evidenza. */}
        {!state.started && (
          <div style={styles.codeRow}>
            Codice tavolo: <span className="mono" style={styles.code}>{state.roomCode}</span>
          </div>
        )}

        <div style={styles.players}>
          {state.players.map((p) => (
            <div
              key={p.id}
              style={{
                ...styles.player,
                borderColor: p.id === current?.id ? colorOf(p.id) : 'transparent',
                opacity: p.bankrupt ? 0.35 : 1,
              }}
            >
              <span style={styles.playerToken}>{p.token}</span>
              <span
                className={`mono ${p.balance < 0 ? 'money-negative' : ''}`}
                style={styles.playerBalance}
              >
                €{p.balance}
              </span>
            </div>
          ))}
        </div>

        <div style={styles.actions}>
          {!state.started ? (
            <button className="btn-primary" style={styles.mainBtn} onClick={() => socket.emit('start_game')}>
              Inizia partita
            </button>
          ) : state.finished ? (
            <span style={styles.waiting}>Partita finita</span>
          ) : isMyTurn && me?.inJail ? (
            <>
              <button className="btn-primary" style={styles.mainBtn} onClick={() => socket.emit('roll_dice', {})}>
                Tira (doppio per uscire)
              </button>
              <button className="btn-ghost" style={styles.smallBtn} onClick={() => socket.emit('pay_jail_fine', {})}>
                €50
              </button>
              {me.jailCards > 0 && (
                <button className="btn-ghost" style={styles.smallBtn} onClick={() => socket.emit('use_jail_card', {})}>
                  Carta
                </button>
              )}
            </>
          ) : isMyTurn ? (
            <>
              <button
                className="btn-primary"
                style={styles.mainBtn}
                disabled={blocked}
                onClick={() => socket.emit('roll_dice', {})}
              >
                Tira i dadi
              </button>
              <button
                className="btn-ghost"
                style={styles.smallBtn}
                disabled={blocked}
                onClick={() => socket.emit('end_turn', {})}
              >
                Fine
              </button>
            </>
          ) : (
            <span style={styles.waiting}>Turno di {current?.name}</span>
          )}
        </div>

        <div style={styles.tabs}>
          <button className="btn-ghost" style={styles.tab} onClick={() => setSheet('proprieta')}>
            🏠 Proprietà
          </button>
          <button className="btn-ghost" style={styles.tab} onClick={() => setSheet('registro')}>
            📜 Registro
          </button>
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 15,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    padding: '9px 10px calc(9px + env(safe-area-inset-bottom))',
    background: 'linear-gradient(180deg, rgba(15,61,46,0.94) 0%, #0c3125 100%)',
    borderTop: '1px solid rgba(201,150,44,0.35)',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 -6px 20px rgba(0,0,0,0.4)',
  },
  codeRow: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.6)', textAlign: 'center' },
  code: { color: 'var(--brass-2)', letterSpacing: '0.14em', fontSize: '0.92rem' },
  players: { display: 'flex', gap: 8, justifyContent: 'center' },
  player: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 999,
    border: '1.5px solid',
    background: 'rgba(0,0,0,0.22)',
  },
  playerToken: { fontSize: '1rem' },
  playerBalance: { fontSize: '0.85rem' },
  actions: { display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center' },
  // 44px è la dimensione minima raccomandata per un bersaglio da toccare.
  mainBtn: { flex: 1, minHeight: 44, fontSize: '0.95rem' },
  smallBtn: { minHeight: 44, padding: '0 14px', fontSize: '0.85rem' },
  waiting: { color: 'rgba(243,234,216,0.6)', fontSize: '0.88rem', minHeight: 44, display: 'flex', alignItems: 'center' },
  tabs: { display: 'flex', gap: 7 },
  tab: { flex: 1, minHeight: 38, fontSize: '0.8rem', padding: '0 10px' },

  sheetOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 18,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '78vh',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
    padding: '10px 14px calc(14px + env(safe-area-inset-bottom))',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, background: 'rgba(243,234,216,0.3)', alignSelf: 'center', marginBottom: 10 },
  sheetTabs: { display: 'flex', gap: 8, marginBottom: 12 },
  sheetTab: { flex: 1, minHeight: 40, fontSize: '0.85rem', padding: '0 10px' },
  sheetBody: { overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 },
  tradeBtn: { minHeight: 44, fontSize: '0.9rem' },
  log: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: '0.8rem', color: 'rgba(243,234,216,0.78)' },
  logLine: { borderLeft: '2px solid rgba(201,150,44,0.35)', paddingLeft: 9 },
  closeSheet: { minHeight: 42, marginTop: 12 },
};
