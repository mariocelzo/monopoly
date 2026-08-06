import { useEffect, useRef, useState } from 'react';
import { LAYER } from './layers';
import { socket, collegaSocket, GameState, BoardSquare } from './socket';
import { azzeraRifiuto } from './azioni';
import { secondiAlRisveglio, useStatoCollegamento } from './statoCollegamento';
import { useIsMobile, useIsTouchLayout } from './useIsMobile';
import { useTurnAttention } from './useTurnAttention';
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
import { recordFinishedGame } from './scoreboardStorage';
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
import PropostaInAttesa from './components/PropostaInAttesa';
import CardModal from './components/CardModal';
import RentModal from './components/RentModal';
import TaxModal from './components/TaxModal';
import SquareDetail from './components/SquareDetail';
import AwayRecapModal from './components/AwayRecapModal';
import GameSummary from './components/GameSummary';
import Scoreboard from './components/Scoreboard';
import LogStrip from './components/LogStrip';
import BottoneAzione from './components/BottoneAzione';
import AvvisoRisveglio from './components/AvvisoRisveglio';
import AvvisoAzione from './components/AvvisoAzione';

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

      // Registrata QUI, prima di setState, e non in un useEffect separato:
      // il componente Scoreboard legge il tabellino dal proprio stato locale
      // al montaggio (vedi Scoreboard.tsx), che React inizializza durante il
      // render che segue questo setState — quindi ancora prima che un
      // eventuale useEffect di App abbia la possibilità di scattare. Se la
      // registrazione avvenisse dopo, il riquadro di fine partita
      // mostrerebbe il tabellino di *prima* di questa partita, un giro in
      // ritardo. La guardia contro il doppio conteggio (gameId già segnato)
      // vive dentro recordFinishedGame, quindi chiamarla anche sugli
      // aggiornamenti di stato successivi alla fine (es. un voto di
      // rivincita dell'altro giocatore, che il server ribroadcasta a tutti)
      // non fa danno: la seconda volta in poi non cambia nulla.
      if (s.finished) recordFinishedGame(s);
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
    // collegaSocket e non socket.connect: è da qui che parte il cronometro del
    // risveglio, ed è questo il collegamento che l'utente sta aspettando
    // mentre scrive il proprio nome nella lobby (vedi statoCollegamento.ts).
    if (!socket.connected) collegaSocket();
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
      if (!document.hidden && !socket.connected) collegaSocket();
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

  // Lo stato del collegamento serve alla barra rossa qui sotto per distinguere
  // "sto riprovando" da "il servizio è andato a dormire e ci mette una ventina
  // di secondi". Va letto qui, prima di ogni return condizionale, così l'ordine
  // degli hook resta lo stesso a ogni render.
  const { fase: faseRete, attesaMs: attesaRete } = useStatoCollegamento();
  const secondiRete = secondiAlRisveglio(attesaRete);

  // Titolo e favicon lampeggianti quando tocca a questo giocatore (turno o
  // pendingAction che lo nomina) e la scheda è in secondo piano: vedi
  // useTurnAttention.ts per il perché. Va chiamato qui, prima di ogni return
  // condizionale, così l'ordine degli hook resta lo stesso a ogni render.
  useTurnAttention(state, playerId);

  if (!playerId || !state) {
    if (rejoining) {
      return (
        // Chi ricarica la pagina a servizio addormentato aspettava qui, davanti
        // a tre parole ferme, per una ventina di secondi: la stessa attesa
        // della lobby e quindi lo stesso racconto, invece di due schermate che
        // trattano lo stesso fatto in due modi diversi.
        <div style={styles.loading}>
          <div style={styles.loadingBox}>
            <span>Rientro al tavolo…</span>
            <AvvisoRisveglio nota="Il tavolo e la partita sono al loro posto: si riprende da dov'era rimasta." />
          </div>
        </div>
      );
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
    // Un rifiuto rimasto a schermo parlava della partita che si sta lasciando:
    // se sopravvivesse, ricomparirebbe addosso al tavolo successivo.
    azzeraRifiuto();
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
  const card = pending?.type === 'awaiting_card' ? pending : null;
  const rent = pending?.type === 'awaiting_rent' ? pending : null;
  const tax = pending?.type === 'awaiting_tax' ? pending : null;
  const auction = pending?.type === 'awaiting_auction' ? pending : null;
  const buySquare = buy ? board.find((s) => s.position === buy.position) : null;

  // I giocatori hanno chiesto indietro i banner a tutto schermo per i fatti
  // altrui (la striscia discreta introdotta in seguito si notava troppo poco):
  // acquisto, carta, affitto, tassa e debito tornano a montarsi per chiunque
  // sia al tavolo, non solo per chi deve decidere. `*IsMine` distingue comunque
  // chi ha davvero il pendingAction assegnato (`pending.playerId`, il solo
  // "decisore" per ogni tipo, vedi socket.ts) da chi guarda soltanto: serve ai
  // modali per scegliere il testo giusto, e qui sotto per la soppressione
  // durante la composizione di uno scambio (vedi `composingTrade` più giù).
  const buyIsMine = !!buy && buy.playerId === playerId;
  const cardIsMine = !!card && card.playerId === playerId;
  const rentIsMine = !!rent && rent.playerId === playerId;
  const taxIsMine = !!tax && tax.playerId === playerId;
  const debtIsMine = !!debt && debt.playerId === playerId;
  // Le proposte di scambio non stanno più nel pendingAction e non fermano più
  // nessuno: si leggono da `tradeOffers`, e ognuno guarda solo le proprie.
  // Il terzo giocatore non coinvolto non vede assolutamente niente — è tutto il
  // senso della modifica: la trattativa di due non deve comparire addosso a chi
  // sta giocando.
  const offerte = state.tradeOffers ?? [];
  // Da rispondere: possono essere più d'una (chiunque può propormi qualcosa
  // nello stesso momento). Si mostra la più vecchia e si dice quante restano,
  // invece di impilare finestre una sull'altra.
  const daRispondere = offerte.filter((t) => t.toId === playerId);
  // Fatta da me: al più una, il motore ne ammette una per proponente.
  const miaProposta = offerte.find((t) => t.fromId === playerId) ?? null;
  // L'asta gira a turno fra i partecipanti (`pending.playerId` è chi deve
  // rilanciare o passare adesso): resta visibile a tutto il tavolo sempre,
  // perché è collettiva, ma solo il turno di chi guarda conta come "aspetta
  // te" più sotto.
  const auctionIsMine = !!auction && auction.playerId === playerId;
  const winner = state.finished ? state.players.find((p) => p.id === state.winnerId) : null;
  const inspectedSquare = inspected !== null ? board.find((s) => s.position === inspected) : null;
  const hoChiestoRivincita = state.rematchVotes.includes(playerId);
  const mancanti = state.players.filter((p) => !state.rematchVotes.includes(p.id));
  const altriCheVogliono = state.players.filter(
    (p) => p.id !== playerId && state.rematchVotes.includes(p.id)
  );

  return (
    <div style={isMobile ? styles.wrapMobile : styles.wrap}>
      {/* La barra rossa non dice più solo "connessione persa": se il
          collegamento non torna entro la soglia, il motivo quasi sempre è che
          il servizio si è addormentato e sta ripartendo — un fatto che ha una
          durata nota (una ventina di secondi) e che, detto, trasforma
          un'interfaccia apparentemente rotta in un'attesa che finisce. Il
          testo lo decide statoCollegamento.ts, lo stesso che parla nella
          lobby: una sola verità sul collegamento, raccontata in due posti. */}
      {!online && (
        <div style={styles.offlineBanner}>
          {faseRete === 'risveglio'
            ? `Il server si era addormentato e sta ripartendo${secondiRete > 0 ? ` · ancora ${secondiRete}s circa` : ' · ancora qualche secondo'}`
            : 'Connessione persa · riconnessione in corso…'}
        </div>
      )}

      {/* Montato una volta sola, qui: mostra l'ultimo rifiuto del server da
          qualunque parte arrivi (vedi azioni.ts). Sta accanto alla barra della
          connessione persa perché occupano lo stesso angolo di schermo, e
          `sottoBanner` è ciò che impedisce loro di sovrapporsi. */}
      <AvvisoAzione sottoBanner={!online} />

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

      {/* Su telefono, sotto il tabellone, restavano fino a 150px di feltro
          vuoto: il 37% dello schermo non mostrava niente mentre il registro
          stava sepolto a due tocchi di distanza, dentro il foglio delle
          proprietà. Ingrandire il tabellone non era la strada — è quadrato e
          già largo quanto lo schermo consente — quindi quello spazio si
          riempie con le ultime righe di registro. A partita non ancora
          iniziata non si mostra: lì il posto serve al codice del tavolo, al
          link d'invito e ai comandi dei bot. */}
      {isMobile && state.started && <LogStrip log={state.log} />}

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
      {/* Mentre si compone uno scambio (`composingTrade`), i banner di eventi
          ALTRUI non devono comparire: interromperebbero chi sta scegliendo cosa
          mettere sul piatto. Ma il PROPRIO banner deve comparire sempre, anche
          a compositore aperto — se lo si sopprimesse e nel frattempo toccasse a
          questo giocatore pagare un affitto o rilanciare in un'asta, non
          resterebbe alcun modo di agire: un pendingAction congela il turno di
          *tutti* finché non si risolve, quindi si pianterebbe la partita per
          l'intero tavolo, non solo per lui. Da qui il criterio uniforme
          applicato a ogni ramo qui sotto: si sopprime un banner solo se
          `composingTrade` è aperto E quel pendingAction non aspetta proprio
          questo giocatore (`*IsMine`, cioè `pending.playerId === playerId` —
          vedi socket.ts, è sempre il "decisore" indipendentemente dal tipo).
          Non semplificare in "nascondi tutto mentre si compone": è la stessa
          classe di difetto già capitata due volte su questo progetto. */}
      {buy && buySquare && (!composingTrade || buyIsMine) && (
        <BuyModal pending={buy} square={buySquare} state={state} myId={playerId} />
      )}
      {card && (!composingTrade || cardIsMine) && (
        <CardModal pending={card} state={state} myId={playerId} />
      )}
      {rent && (!composingTrade || rentIsMine) && (
        <RentModal
          pending={rent}
          square={board.find((s) => s.position === rent.position)}
          state={state}
          myId={playerId}
        />
      )}
      {tax && (!composingTrade || taxIsMine) && (
        <TaxModal
          pending={tax}
          square={board.find((s) => s.position === tax.position)}
          state={state}
          myId={playerId}
        />
      )}
      {/* L'asta è collettiva (vedi commento su `auctionIsMine` più sopra), ma
          solo chi deve rilanciare o passare adesso ha davvero una decisione in
          sospeso: per chiunque altro, mentre si compone uno scambio, è un
          evento "altrui" come gli altri e si sopprime allo stesso modo. Quando
          il turno dell'asta arriva a questo giocatore, `auctionIsMine` diventa
          vero e il banner ricompare da solo — niente di speciale da gestire. */}
      {auction && (!composingTrade || auctionIsMine) && (
        <AuctionModal
          pending={auction}
          square={board.find((s) => s.position === auction.position)}
          state={state}
          myId={playerId}
        />
      )}
      {debt && (!composingTrade || debtIsMine) && (
        <DebtModal pending={debt} board={board} state={state} myId={playerId} />
      )}
      {/* L'offerta ricevuta: la vede solo il destinatario, e resta visibile
          anche mentre si compone un'altra proposta — è l'unica delle eccezioni
          qui sopra che NON si sopprime, perché il compositore è mio e
          l'offerta pure, e sepolta sotto non la vedrei mai. Sta comunque sotto
          le finestre che fermano il tavolo (vedi layers.ts): se arriva un
          affitto da pagare, quello viene prima. */}
      {daRispondere.length > 0 && (
        <TradeOfferModal
          offerta={daRispondere[0]}
          restanti={daRispondere.length - 1}
          board={board}
          state={state}
        />
      )}
      {/* Chi ha proposto vede una striscia, non una finestra: deve poter
          continuare a giocare mentre l'altro decide. Vedi PropostaInAttesa. */}
      {miaProposta && (
        <PropostaInAttesa
          offerta={miaProposta}
          board={board}
          state={state}
          sottoBanner={!online}
        />
      )}
      {/* Non condizionato da `!pending`: uno scambio altrui (o qualunque altra
          azione in sospeso non mia) non deve smontare quello che sto
          componendo. Il server rifiuta comunque l'invio finché c'è un
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
            {/* Il riepilogo può crescere parecchio (una statistica per ogni
                giocatore): scorre per conto suo dentro un'altezza massima,
                così Rivincita e Lascia il tavolo restano sempre raggiungibili
                sotto, fuori dallo scorrimento. Stesso schema di
                TradeOfferModal (vedi i commenti lì per il perché di ogni
                pezzo: maxHeight sulla card, overflowY+minHeight:0 solo qui,
                bottoni con flexShrink:0 fuori da quest'area). */}
            <div style={styles.winScroll}>
              <span style={styles.eyebrow}>
                {state.endedReason === 'closed' ? 'tavolo chiuso' : 'partita finita'}
              </span>
              <h2 style={styles.winTitle}>
                {winner ? `${winner.name} vince!` : 'Partita interrotta'}
              </h2>
              <p style={styles.winSub}>{endingMessage(state, winner, playerId)}</p>

              {/* Niente riepilogo per un tavolo chiuso a metà: i numeri di una
                  partita interrotta prima di finire non raccontano nulla di
                  compiuto. Stessa esclusione per il tabellino: qui accanto
                  al riepilogo della partita appena giocata ha senso, da solo
                  sopra un tavolo chiuso a metà no. */}
              {state.endedReason !== 'closed' && (
                <>
                  <GameSummary state={state} board={board} myId={playerId} />
                  <Scoreboard board={board} />
                </>
              )}

              {state.endedReason !== 'closed' && (
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
              )}
            </div>

            {/* Dopo un tavolo chiuso non c'è più nulla a cui tornare. */}
            {state.endedReason !== 'closed' && (
              <BottoneAzione
                evento="request_rematch"
                style={styles.newGame}
                disabled={hoChiestoRivincita}
              >
                {hoChiestoRivincita ? 'In attesa…' : 'Rivincita'}
              </BottoneAzione>
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
    // Non più `center`: il centraggio spalmava lo spazio libero metà sopra e
    // metà sotto il tabellone, lasciando due bande di feltro vuoto (150px
    // ciascuna su un telefono da 812). Allineando in alto lo spazio si
    // raccoglie tutto sotto, dove LogStrip lo riempie col registro.
    justifyContent: 'flex-start',
    padding: '7px 7px 158px',
    minHeight: '100%',
  },
  boardArea: { display: 'flex', justifyContent: 'center' },
  loading: { minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(243,234,216,0.6)', fontFamily: 'var(--font-mono)', padding: 24 },
  // Larghezza contenuta: il riquadro del risveglio ha due righe di testo, e a
  // tutta pagina si leggerebbero attraversando lo schermo da un bordo all'altro.
  loadingBox: { width: 360, maxWidth: '100%', textAlign: 'center' },
  offlineBanner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: LAYER.connessionePersa,
    padding: '7px 12px calc(7px + env(safe-area-inset-top))',
    textAlign: 'center',
    fontSize: '0.8rem',
    background: 'var(--danger)',
    color: 'var(--paper)',
  },
  // alignItems: flex-start + overflowY: auto sull'overlay stesso, come in
  // TradeOfferModal: rete di sicurezza per i viewport bassissimi dove nemmeno
  // comprimendo il contenuto della card tutto ci starebbe.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: LAYER.finePartita, padding: 18, overflowY: 'auto' },
  // margin: auto centra la card quando c'è spazio e la tiene attaccata in
  // alto (senza uscire da sopra) quando non ce n'è. maxHeight + flex column
  // sono ciò che rende scorrevole solo winScroll qui sotto, coi bottoni
  // sempre fuori e sempre raggiungibili.
  winCard: { padding: 40, width: 340, maxWidth: '100%', maxHeight: 'calc(100vh - 36px)', margin: 'auto', display: 'flex', flexDirection: 'column', textAlign: 'center' },
  // minHeight: 0 è indispensabile: senza, questo figlio flex non si
  // restringe sotto il proprio contenuto e la card deborda in silenzio —
  // esattamente il difetto già capitato due volte in questo progetto.
  winScroll: { overflowY: 'auto', minHeight: 0 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  winTitle: { fontSize: '2rem', marginTop: 10, color: 'var(--brass-2)' },
  winSub: { color: 'rgba(243,234,216,0.65)', marginTop: 10, lineHeight: 1.5 },
  // flexShrink: 0 tiene Rivincita e Lascia il tavolo fuori dall'area che
  // scorre: qualunque cosa contenga il riepilogo, restano raggiungibili.
  newGame: { marginTop: 18, width: '100%', minHeight: TOUCH_TARGET, flexShrink: 0 },
  rematchNote: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.55)', marginTop: 10, lineHeight: 1.4 },
};
