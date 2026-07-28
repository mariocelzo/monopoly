import { useEffect, useRef, useState } from 'react';
import { socket, GameState, BoardSquare } from './socket';
import { useIsMobile, useIsTouchLayout } from './useIsMobile';
import {
  clearLogBookmark,
  clearRoom,
  getClientId,
  loadLogBookmark,
  loadRoom,
  saveLogBookmark,
  saveRoom,
} from './identity';
import { clearInviteFromUrl, getInviteCodeFromUrl } from './invite';
import { latestLogAt, missedSince } from './awayRecap';
import { TOUCH_TARGET } from './touchTarget';
import Lobby from './components/Lobby';
import Board from './components/Board';
import GamePanel from './components/GamePanel';
import MobileBar from './components/MobileBar';
import BuyModal from './components/BuyModal';
import AuctionModal from './components/AuctionModal';
import DebtModal from './components/DebtModal';
import TradeModal from './components/TradeModal';
import TradeWizard from './components/TradeWizard';
import TradeOfferModal from './components/TradeOfferModal';
import CardModal from './components/CardModal';
import RentModal from './components/RentModal';
import TaxModal from './components/TaxModal';
import SquareDetail from './components/SquareDetail';
import AwayRecapModal from './components/AwayRecapModal';
import EventTicker from './components/EventTicker';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [board, setBoard] = useState<BoardSquare[]>([]);
  // Composizione di una nuova proposta di scambio, aperta dai comandi di gioco.
  const [composingTrade, setComposingTrade] = useState(false);
  // Casella toccata sul tabellone, di cui si mostra il contratto.
  const [inspected, setInspected] = useState<number | null>(null);
  // Codice letto da un link di invito (?tavolo=XXXXX). Ha la precedenza sul
  // rientro automatico silenzioso: se qualcuno manda un link a un tavolo
  // diverso da quello salvato, si presume che si voglia entrare lì, non
  // ritrovarsi nella vecchia partita senza nessun avviso.
  const [inviteCode, setInviteCode] = useState<string | null>(() => getInviteCodeFromUrl());
  // L'effect di rejoin si registra una volta sola: usa questo ref, non lo
  // state, per non restare agganciato al valore letto al primo giro quando
  // l'invito viene poi scartato o consumato.
  const inviteRef = useRef(inviteCode);
  useEffect(() => { inviteRef.current = inviteCode; }, [inviteCode]);

  // Finché si tenta il rientro automatico non si mostra la lobby, altrimenti
  // comparirebbe per un istante a chi sta solo ricaricando la pagina. Con un
  // invito verso un altro tavolo si salta dritti alla lobby.
  const [rejoining, setRejoining] = useState(() => {
    const saved = loadRoom();
    const invite = getInviteCodeFromUrl();
    return saved !== null && (!invite || invite === saved);
  });
  // Stato del collegamento: senza avviso si resterebbe a fissare un tabellone
  // fermo, credendo che stia solo giocando l'altro.
  const [online, setOnline] = useState(true);
  // Righe di registro arrivate mentre si era disconnessi, da mostrare come
  // riepilogo al rientro. `null` quando non c'è nulla da mostrare (chiuso
  // dall'utente, o perché non è successo niente durante l'assenza).
  const [missedLog, setMissedLog] = useState<{ message: string; at: number }[] | null>(null);
  // Punto del registro oltre il quale tutto è "successo mentre non c'ero":
  // parte da quanto salvato in localStorage (utile se la scheda è stata
  // chiusa del tutto) e viene aggiornato a ogni disconnessione vera con
  // l'ultimo punto davvero visto, non con un valore vecchio di sessioni fa.
  const awayBookmarkRef = useRef<number | null>(loadLogBookmark());
  // Punto più avanzato del registro mai ricevuto in questa sessione: si
  // aggiorna a ogni `state` e viene scritto in localStorage, così è sempre
  // pronto a diventare il prossimo `awayBookmarkRef` se la connessione cade.
  const lastSeenAtRef = useRef<number | null>(awayBookmarkRef.current);
  // Vero quando il prossimo `state` ricevuto va confrontato con
  // `awayBookmarkRef` per capire cosa si è perso: solo al primo stato di
  // questa sessione e subito dopo ogni disconnessione vera, mai durante il
  // gioco normale (altrimenti ogni singola riga nuova farebbe comparire il
  // riquadro anche mentre si sta guardando la partita dal vivo).
  const checkMissedRef = useRef(true);
  const isMobile = useIsMobile();
  // Domanda diversa da isMobile: non "come si dispone la pagina" ma "questo
  // comando si usa col pollice". Un tablet in orizzontale è largo ma resta
  // touch, e per comporre uno scambio conta quello.
  const isTouch = useIsTouchLayout();

  useEffect(() => {
    fetch(`${SERVER_URL}/board`).then((r) => r.json()).then(setBoard).catch(() => {});
  }, []);

  useEffect(() => {
    const onState = (s: GameState) => {
      // Confronto col segnalibro solo se questo `state` è il primo dopo il
      // rientro (mount o riconnessione vera): dopo, si consuma subito, così
      // gli aggiornamenti successivi del gioco dal vivo non lo rifanno scattare.
      if (checkMissedRef.current) {
        checkMissedRef.current = false;
        const missed = missedSince(s.log, awayBookmarkRef.current);
        if (missed.length > 0) setMissedLog(missed);
      }

      // Il punto più avanzato raggiunto dal registro finora, per capire fino
      // a dove si era arrivati prima di un'eventuale prossima disconnessione.
      lastSeenAtRef.current = latestLogAt(s.log, lastSeenAtRef.current);
      saveLogBookmark(lastSeenAtRef.current);
      setState(s);
    };
    socket.on('state', onState);
    return () => { socket.off('state', onState); };
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
      // Un invito ancora attivo verso un tavolo diverso blocca il rientro
      // automatico: si lascia decidere alla lobby, non si sceglie per l'utente.
      if (inviteRef.current && inviteRef.current !== roomCode) return;
      socket.emit(
        'rejoin_room',
        { roomCode, clientId: getClientId() },
        (res: { error?: string; playerId?: string }) => {
          if (res?.error) {
            // La stanza non c'è più (server riavviato, partita scaduta): si
            // ricomincia dalla lobby invece di restare bloccati.
            clearRoom();
            clearLogBookmark();
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
    const setOn = () => setOnline(true);
    // Una disconnessione vera: si fissa qui il punto da cui, al rientro,
    // ricostruire il riepilogo — l'ultimo davvero visto, non un segnalibro
    // vecchio rimasto da una sessione precedente.
    const setOff = () => {
      setOnline(false);
      awayBookmarkRef.current = lastSeenAtRef.current;
      checkMissedRef.current = true;
    };
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
        inviteCode={inviteCode}
        onDismissInvite={() => {
          setInviteCode(null);
          clearInviteFromUrl();
        }}
        onJoined={(code, pid) => {
          saveRoom(code);
          // Ingresso fresco in un tavolo, non un rientro: un segnalibro
          // rimasto da una partita precedente farebbe apparire come "successo
          // mentre non c'ero" tutto il registro di una partita mai vista.
          clearLogBookmark();
          awayBookmarkRef.current = null;
          lastSeenAtRef.current = null;
          checkMissedRef.current = true;
          // Consumato: né in un rientro futuro né in un ricaricamento deve
          // ripresentarsi la schermata d'invito sopra una partita già in corso.
          setInviteCode(null);
          clearInviteFromUrl();
          setPlayerId(pid);
        }}
      />
    );
  }

  /**
   * Torna alla lobby. A partita finita la stanza puo' essere gia' sparita; a
   * meta' partita resta viva e ci si rientra col codice.
   */
  const leaveTable = () => {
    clearRoom();
    clearLogBookmark();
    awayBookmarkRef.current = null;
    lastSeenAtRef.current = null;
    checkMissedRef.current = true;
    setMissedLog(null);
    setPlayerId(null);
    setState(null);
    setRejoining(false);
  };

  const pending = state.pendingAction;
  const buy = pending?.type === 'awaiting_buy' ? pending : null;
  const debt = pending?.type === 'awaiting_debt' ? pending : null;
  const trade = pending?.type === 'awaiting_trade' ? pending : null;
  const card = pending?.type === 'awaiting_card' ? pending : null;
  const rent = pending?.type === 'awaiting_rent' ? pending : null;
  const tax = pending?.type === 'awaiting_tax' ? pending : null;
  const auction = pending?.type === 'awaiting_auction' ? pending : null;
  const buySquare = buy ? board.find((s) => s.position === buy.position) : null;

  // Un modale a tutto schermo resta giustificato solo quando aspetta proprio
  // una decisione di chi guarda: acquisto, carta, affitto, tassa e debito
  // riguardano una sola persona (chi deve premere il bottone), quindi per
  // chiunque altro non c'è nulla da decidere — solo un fatto da vedere, che
  // ora arriva dalla striscia degli eventi invece di rubare lo schermo. È
  // esattamente la causa del difetto "il compositore di scambio si azzera da
  // solo": prima questi modali comparivano per *tutti* al tavolo, non solo
  // per chi doveva agire, e smontavano quel che c'era sotto.
  const buyIsMine = !!buy && buy.playerId === playerId;
  const cardIsMine = !!card && card.playerId === playerId;
  const rentIsMine = !!rent && rent.playerId === playerId;
  const taxIsMine = !!tax && tax.playerId === playerId;
  const debtIsMine = !!debt && debt.playerId === playerId;
  // Lo scambio è un'eccezione alla regola sopra: riguarda due persone, non
  // una sola. Il destinatario (`trade.playerId`, cioè `toId`) deve rispondere,
  // ma anche chi l'ha proposto (`fromId`) è parte in causa — vuole vedere che
  // l'altro sta decidendo, non solo saperlo dal registro dopo il fatto. Un
  // terzo giocatore non coinvolto, invece, non ha nulla da guardare qui.
  const tradeConcernsMe = !!trade && (trade.playerId === playerId || trade.fromId === playerId);
  // L'asta è l'altra eccezione, e non riguarda solo due persone ma tutto il
  // tavolo: gira a turno fra i partecipanti, e chi non deve rilanciare adesso
  // vuole comunque seguirla in diretta — è un'asta vera, non un affare privato
  // fra due giocatori. Resta quindi visibile a tutti, senza filtro.
  const winner = state.finished ? state.players.find((p) => p.id === state.winnerId) : null;
  const inspectedSquare = inspected !== null ? board.find((s) => s.position === inspected) : null;
  const hoChiestoRivincita = state.rematchVotes.includes(playerId);
  const mancanti = state.players.filter((p) => !state.rematchVotes.includes(p.id));
  const altriCheVogliono = state.players.filter(
    (p) => p.id !== playerId && state.rematchVotes.includes(p.id)
  );

  return (
    <div style={isMobile ? styles.wrapMobile : styles.wrap}>
      {!online && (
        <div style={styles.offlineBanner}>
          Connessione persa · riconnessione in corso…
        </div>
      )}
      {/* Non legata a nessun pendingAction: scorre da sola qualunque cosa
          succeda altrove, ed è per questo che sta fuori da ogni ramo
          condizionale qui sotto — deve continuare a funzionare anche mentre
          un modale bloccante copre lo schermo di qualcun altro. */}
      <EventTicker log={state.log} isMobile={isMobile} />

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
          onLeave={leaveTable}
        />
      ) : (
        <GamePanel
          state={state}
          myId={playerId}
          board={board}
          onProposeTrade={() => setComposingTrade(true)}
          onLeave={leaveTable}
        />
      )}

      {inspectedSquare && (
        <SquareDetail square={inspectedSquare} state={state} onClose={() => setInspected(null)} />
      )}
      {buy && buySquare && buyIsMine && <BuyModal pending={buy} square={buySquare} />}
      {card && cardIsMine && <CardModal pending={card} />}
      {rent && rentIsMine && (
        <RentModal
          pending={rent}
          square={board.find((s) => s.position === rent.position)}
          state={state}
        />
      )}
      {tax && taxIsMine && (
        <TaxModal
          pending={tax}
          square={board.find((s) => s.position === tax.position)}
          state={state}
        />
      )}
      {/* Nessun filtro qui: l'asta si segue in diretta anche da chi non deve
          rilanciare adesso, vedi il commento sopra su `tradeConcernsMe`. */}
      {auction && (
        <AuctionModal
          pending={auction}
          square={board.find((s) => s.position === auction.position)}
          state={state}
          myId={playerId}
        />
      )}
      {debt && debtIsMine && <DebtModal pending={debt} board={board} state={state} myId={playerId} />}
      {trade && tradeConcernsMe && (
        <TradeOfferModal pending={trade} board={board} state={state} myId={playerId} />
      )}
      {/* Non più condizionato da `!pending`: uno scambio altrui (o qualunque
          altra azione in sospeso non mia) non deve più smontare quello che
          sto componendo. Il server rifiuta comunque l'invio finché c'è un
          pendingAction aperto — è TradeModal/TradeWizard a disabilitare il
          bottone e spiegarlo, non questo componente a sparire. */}
      {composingTrade && (
        isTouch ? (
          <TradeWizard
            board={board}
            state={state}
            myId={playerId}
            onClose={() => setComposingTrade(false)}
          />
        ) : (
          <TradeModal
            board={board}
            state={state}
            myId={playerId}
            onClose={() => setComposingTrade(false)}
          />
        )
      )}
      {/* Un debito, uno scambio o la fine partita hanno la precedenza sullo
          schermo: si mostra il riepilogo solo quando nessuno di loro sta già
          reclamando l'attenzione del giocatore. */}
      {missedLog && !pending && !composingTrade && !state.finished && (
        <AwayRecapModal entries={missedLog} onClose={() => setMissedLog(null)} />
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
                    ? `Manca${mancanti.length === 1 ? '' : 'no'} ${mancanti
                        .map((p) => p.name)
                        .join(', ')}.`
                    : altriCheVogliono.length > 0
                      ? `${altriCheVogliono.map((p) => p.name).join(', ')} ${
                          altriCheVogliono.length === 1 ? 'vuole' : 'vogliono'
                        } la rivincita!`
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
  newGame: { marginTop: 18, width: '100%', minHeight: TOUCH_TARGET },
  rematchNote: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.55)', marginTop: 10, lineHeight: 1.4 },
};
