import { useEffect, useState } from 'react';
import { socket, GameState, BoardSquare } from './socket';
import { useIsMobile } from './useIsMobile';
import Lobby from './components/Lobby';
import Board from './components/Board';
import GamePanel from './components/GamePanel';
import MobileBar from './components/MobileBar';
import BuyModal from './components/BuyModal';
import DebtModal from './components/DebtModal';
import TradeModal from './components/TradeModal';
import TradeOfferModal from './components/TradeOfferModal';
import SquareDetail from './components/SquareDetail';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [board, setBoard] = useState<BoardSquare[]>([]);
  // Composizione di una nuova proposta di scambio, aperta dai comandi di gioco.
  const [composingTrade, setComposingTrade] = useState(false);
  // Casella toccata sul tabellone, di cui si mostra il contratto.
  const [inspected, setInspected] = useState<number | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    fetch(`${SERVER_URL}/board`).then((r) => r.json()).then(setBoard).catch(() => {});
  }, []);

  useEffect(() => {
    socket.on('state', (s: GameState) => setState(s));
    return () => { socket.off('state'); };
  }, []);

  if (!playerId || !state) {
    return <Lobby onJoined={(_code, pid) => setPlayerId(pid)} />;
  }

  const pending = state.pendingAction;
  // Un debito o uno scambio hanno la precedenza: congelano la partita.
  const buy = pending?.type === 'awaiting_buy' ? pending : null;
  const debt = pending?.type === 'awaiting_debt' ? pending : null;
  const trade = pending?.type === 'awaiting_trade' ? pending : null;
  const buySquare = buy ? board.find((s) => s.position === buy.position) : null;
  const winner = state.finished ? state.players.find((p) => p.id === state.winnerId) : null;
  const inspectedSquare = inspected !== null ? board.find((s) => s.position === inspected) : null;

  return (
    <div style={isMobile ? styles.wrapMobile : styles.wrap}>
      <div style={styles.boardArea}>
        {board.length > 0 && (
          <Board
            board={board}
            state={state}
            isMobile={isMobile}
            onSquareClick={(position) => setInspected(position)}
          />
        )}
      </div>

      {isMobile ? (
        <MobileBar
          state={state}
          myId={playerId}
          board={board}
          onProposeTrade={() => setComposingTrade(true)}
        />
      ) : (
        <GamePanel
          state={state}
          myId={playerId}
          board={board}
          onProposeTrade={() => setComposingTrade(true)}
        />
      )}

      {inspectedSquare && (
        <SquareDetail square={inspectedSquare} state={state} onClose={() => setInspected(null)} />
      )}
      {buy && buySquare && (
        <BuyModal pending={buy} square={buySquare} isMe={buy.playerId === playerId} />
      )}
      {debt && <DebtModal pending={debt} board={board} state={state} myId={playerId} />}
      {trade && <TradeOfferModal pending={trade} board={board} state={state} myId={playerId} />}
      {composingTrade && !pending && (
        <TradeModal
          board={board}
          state={state}
          myId={playerId}
          onClose={() => setComposingTrade(false)}
        />
      )}
      {winner && (
        <div style={styles.overlay}>
          <div className="panel" style={styles.winCard}>
            <span style={styles.eyebrow}>partita finita</span>
            <h2 style={styles.winTitle}>{winner.name} vince!</h2>
            <p style={styles.winSub}>
              {winner.id === playerId ? 'Complimenti.' : 'Sarà per la prossima.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap', minHeight: '100%' },
  // Su telefono i comandi stanno in una barra fissa in fondo: il padding lascia
  // lo spazio per non finirci sotto, e il centraggio verticale evita che il
  // tabellone resti incollato in alto con una fascia vuota sotto.
  wrapMobile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 7px 158px',
    minHeight: '100%',
  },
  boardArea: { display: 'flex', justifyContent: 'center' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: 18 },
  winCard: { padding: 40, width: 340, maxWidth: '100%', textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  winTitle: { fontSize: '2rem', marginTop: 10, color: 'var(--brass-2)' },
  winSub: { color: 'rgba(243,234,216,0.65)', marginTop: 10 },
};
