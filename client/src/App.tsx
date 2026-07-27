import { useEffect, useState } from 'react';
import { socket, GameState, BoardSquare } from './socket';
import Lobby from './components/Lobby';
import Board from './components/Board';
import GamePanel from './components/GamePanel';
import BuyModal from './components/BuyModal';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [board, setBoard] = useState<BoardSquare[]>([]);

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
  const pendingSquare = pending ? board.find((s) => s.position === pending.position) : null;

  return (
    <div style={styles.wrap}>
      <div style={styles.boardArea}>
        {board.length > 0 && <Board board={board} state={state} onSquareClick={() => {}} />}
      </div>
      <GamePanel state={state} myId={playerId} />
      {pending && pendingSquare && (
        <BuyModal pending={pending} square={pendingSquare} isMe={pending.playerId === playerId} />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap', minHeight: '100%' },
  boardArea: { display: 'flex', justifyContent: 'center' },
};
