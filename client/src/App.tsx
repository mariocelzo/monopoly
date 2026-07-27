import { useEffect, useState } from 'react';
import { socket, GameState, BoardSquare } from './socket';
import { useIsMobile } from './useIsMobile';
import { clearRoom, getClientId, loadRoom, saveRoom } from './identity';
import Lobby from './components/Lobby';
import Board from './components/Board';
import GamePanel from './components/GamePanel';
import MobileBar from './components/MobileBar';
import BuyModal from './components/BuyModal';
import DebtModal from './components/DebtModal';
import TradeModal from './components/TradeModal';
import TradeOfferModal from './components/TradeOfferModal';
import CardModal from './components/CardModal';
import RentModal from './components/RentModal';
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
  // Finché si tenta il rientro automatico non si mostra la lobby, altrimenti
  // comparirebbe per un istante a chi sta solo ricaricando la pagina.
  const [rejoining, setRejoining] = useState(() => loadRoom() !== null);
  // Stato del collegamento: senza avviso si resterebbe a fissare un tabellone
  // fermo, credendo che stia solo giocando l'altro.
  const [online, setOnline] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    fetch(`${SERVER_URL}/board`).then((r) => r.json()).then(setBoard).catch(() => {});
  }, []);

  useEffect(() => {
    socket.on('state', (s: GameState) => setState(s));
    return () => { socket.off('state'); };
  }, []);

  /**
   * Rientro al tavolo salvato. Scatta a ogni `connect`, non solo all'avvio:
   * dopo una caduta di rete socket.io si riconnette con un socket nuovo, e il
   * server va riagganciato allo stesso giocatore.
   */
  useEffect(() => {
    const rejoin = () => {
      const roomCode = loadRoom();
      if (!roomCode) return;
      socket.emit(
        'rejoin_room',
        { roomCode, clientId: getClientId() },
        (res: { error?: string; playerId?: string }) => {
          if (res?.error) {
            // La stanza non c'è più (server riavviato, partita scaduta): si
            // ricomincia dalla lobby invece di restare bloccati.
            clearRoom();
            setPlayerId(null);
            setState(null);
          } else if (res?.playerId) {
            setPlayerId(res.playerId);
          }
          setRejoining(false);
        }
      );
    };

    socket.on('connect', rejoin);
    if (!socket.connected) socket.connect();
    else rejoin();

    return () => { socket.off('connect', rejoin); };
  }, []);

  // La sessione salvata si scarta solo se il tavolo è stato chiuso davvero.
  // Dopo una vittoria o un abbandono la stanza resta in piedi per la
  // rivincita, e ricaricando si deve poter rientrare.
  useEffect(() => {
    if (state?.finished && state.endedReason === 'closed') clearRoom();
  }, [state?.finished, state?.endedReason]);

  /**
   * Riaggancio forzato quando la pagina torna in primo piano o la rete ritorna.
   * Telefoni e schede in secondo piano vengono congelati dal browser: il server
   * fa scadere la connessione e il client, coi timer fermi, non se ne accorge e
   * resta a fissare un tabellone che non si aggiorna più.
   */
  useEffect(() => {
    const [setOn, setOff] = [() => setOnline(true), () => setOnline(false)];
    const ensureConnected = () => {
      if (!document.hidden && !socket.connected) socket.connect();
    };

    socket.on('connect', setOn);
    socket.on('disconnect', setOff);
    document.addEventListener('visibilitychange', ensureConnected);
    window.addEventListener('online', ensureConnected);
    window.addEventListener('focus', ensureConnected);

    return () => {
      socket.off('connect', setOn);
      socket.off('disconnect', setOff);
      document.removeEventListener('visibilitychange', ensureConnected);
      window.removeEventListener('online', ensureConnected);
      window.removeEventListener('focus', ensureConnected);
    };
  }, []);

  if (!playerId || !state) {
    if (rejoining) {
      return <div style={styles.loading}>Rientro al tavolo…</div>;
    }
    return (
      <Lobby
        onJoined={(code, pid) => {
          saveRoom(code);
          setPlayerId(pid);
        }}
      />
    );
  }

  /** Torna alla lobby dopo la fine: la stanza sul server non esiste più. */
  const leaveTable = () => {
    clearRoom();
    setPlayerId(null);
    setState(null);
    setRejoining(false);
  };

  const pending = state.pendingAction;
  // Un debito o uno scambio hanno la precedenza: congelano la partita.
  const buy = pending?.type === 'awaiting_buy' ? pending : null;
  const debt = pending?.type === 'awaiting_debt' ? pending : null;
  const trade = pending?.type === 'awaiting_trade' ? pending : null;
  const card = pending?.type === 'awaiting_card' ? pending : null;
  const rent = pending?.type === 'awaiting_rent' ? pending : null;
  const buySquare = buy ? board.find((s) => s.position === buy.position) : null;
  const winner = state.finished ? state.players.find((p) => p.id === state.winnerId) : null;
  const inspectedSquare = inspected !== null ? board.find((s) => s.position === inspected) : null;
  const altro = state.players.find((p) => p.id !== playerId);
  const hoChiestoRivincita = state.rematchVotes.includes(playerId);
  const altroVuoleRivincita = !!altro && state.rematchVotes.includes(altro.id);

  return (
    <div style={isMobile ? styles.wrapMobile : styles.wrap}>
      {!online && (
        <div style={styles.offlineBanner}>
          Connessione persa · riconnessione in corso…
        </div>
      )}
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
      {card && <CardModal pending={card} state={state} myId={playerId} />}
      {rent && (
        <RentModal
          pending={rent}
          square={board.find((s) => s.position === rent.position)}
          state={state}
          myId={playerId}
        />
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
      {state.finished && (
        <div style={styles.overlay}>
          <div className="panel" style={styles.winCard}>
            <span style={styles.eyebrow}>
              {state.endedReason === 'closed' ? 'tavolo chiuso' : 'partita finita'}
            </span>
            <h2 style={styles.winTitle}>
              {winner ? `${winner.name} vince!` : 'Partita interrotta'}
            </h2>
            <p style={styles.winSub}>{endingMessage(state, winner, playerId)}</p>

            {/* Dopo un tavolo chiuso non c'è più nulla a cui tornare. */}
            {state.endedReason !== 'closed' && (
              <>
                <button
                  className="btn-primary"
                  style={styles.newGame}
                  disabled={hoChiestoRivincita}
                  onClick={() => socket.emit('request_rematch', {})}
                >
                  {hoChiestoRivincita ? 'In attesa…' : 'Rivincita'}
                </button>
                <p style={styles.rematchNote}>
                  {hoChiestoRivincita
                    ? `Aspettiamo che ${altro?.name || "l'altro giocatore"} accetti.`
                    : altroVuoleRivincita
                      ? `${altro?.name} vuole la rivincita!`
                      : 'Stesso tavolo, tutto da capo.'}
                </p>
              </>
            )}

            <button
              className={state.endedReason === 'closed' ? 'btn-primary' : 'btn-ghost'}
              style={styles.newGame}
              onClick={leaveTable}
            >
              Lascia il tavolo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Spiega come è finita, dal punto di vista di chi legge. */
function endingMessage(
  state: GameState,
  winner: GameState['players'][number] | null | undefined,
  myId: string
): string {
  if (state.endedReason === 'closed') {
    return 'Chi ha creato il tavolo ha chiuso la partita.';
  }
  if (state.endedReason === 'abandoned') {
    return winner?.id === myId
      ? 'L\'altro giocatore ha abbandonato: vinci a tavolino.'
      : 'Hai abbandonato la partita.';
  }
  return winner?.id === myId ? 'Complimenti.' : 'Sarà per la prossima.';
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
  loading: { minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(243,234,216,0.6)', fontFamily: 'var(--font-mono)' },
  offlineBanner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    padding: '7px 12px calc(7px + env(safe-area-inset-top))',
    textAlign: 'center',
    fontSize: '0.8rem',
    background: 'var(--danger)',
    color: 'var(--paper)',
  },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: 18 },
  winCard: { padding: 40, width: 340, maxWidth: '100%', textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  winTitle: { fontSize: '2rem', marginTop: 10, color: 'var(--brass-2)' },
  winSub: { color: 'rgba(243,234,216,0.65)', marginTop: 10, lineHeight: 1.5 },
  newGame: { marginTop: 18, width: '100%', minHeight: 46 },
  rematchNote: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.55)', marginTop: 10, lineHeight: 1.4 },
};
