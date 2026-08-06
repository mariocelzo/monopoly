import { useState } from 'react';
import { BoardSquare, GameState } from '../socket';
import BottoneAzione from './BottoneAzione';
import { TOUCH_TARGET } from '../touchTarget';
import { PLAYER_COLORS } from './Board';
import PropertiesPanel from './PropertiesPanel';
import EndGameControl from './EndGameControl';
import SkipTurnControl from './SkipTurnControl';
import HomeButton from './HomeButton';
import InviteLink from './InviteLink';
import HouseRules from './HouseRules';
import { LAYER } from '../layers';
import { netWorthShares } from '../netWorthBar';
import { motivoScambioBloccato } from '../scambi';

type Sheet = 'proprieta' | 'registro' | null;

/**
 * Comandi di gioco su telefono: una barra fissa in fondo con saldi, turno e
 * dadi, sempre visibile sotto il tabellone, più un pannello che sale dal basso
 * per proprietà e registro. Così durante il turno non si scorre mai.
 *
 * L'avviso di azione rifiutata NON sta qui dentro, pur essendo qui che si
 * preme: la barra ha uno `zIndex` suo (LAYER.barraMobile) e quindi apre un
 * contesto di sovrapposizione: un figlio, per quanto alto lo si metta, non
 * riuscirebbe mai a salire sopra le finestre che congelano il turno — asta,
 * debito, scambio — che è proprio dove i rifiuti nascono più spesso. Sta
 * fisso in alto, montato da App.tsx (vedi AvvisoAzione.tsx).
 */
export default function MobileBar({
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
  const [sheet, setSheet] = useState<Sheet>(null);

  const current = state.players[state.turnIndex];
  const isMyTurn = current?.id === myId;
  const me = state.players.find((p) => p.id === myId);
  // `blocked` resta la domanda giusta per i dadi e per "Fine": quelle SÌ che
  // un'azione in sospeso le ferma, sempre.
  const blocked = !!state.pendingAction;
  // Lo scambio no: dipende da una regola sua, più permissiva, la stessa che
  // applica il motore (vedi scambi.ts). Con un acquisto o un affitto altrui in
  // sospeso si propone eccome — è tutto il senso di questa modifica.
  const scambiBloccati = motivoScambioBloccato(state, myId);

  // Il tiro extra da doppio confondeva: sembrava che il gioco facesse tirare
  // due volte a caso. Ora lo si dice.
  const rolledDouble =
    !!state.lastRoll &&
    state.lastRoll.playerId === current?.id &&
    state.lastRoll.dice[0] === state.lastRoll.dice[1];

  // Da quattro giocatori in su la fila dei saldi non ci sta più in larghezza.
  const affollato = state.players.length > 3;

  const colorOf = (playerId: string) =>
    PLAYER_COLORS[state.players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];
  // Sul telefono non c'è spazio per un numero in più accanto al saldo: la
  // barra sotto ciascuna pastiglia (vedi netWorthShares) basta da sola a far
  // vedere chi è avanti, senza aggiungere testo da leggere.
  const netWorthPercent = netWorthShares(state.players);

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
                <PropertiesPanel board={board} state={state} myId={myId} />
              ) : (
                <>
                  <div style={styles.codeRow}>
                    Codice tavolo: <span className="mono" style={styles.code}>{state.roomCode}</span>
                  </div>
                  {state.players.length < 6 && (
                    <InviteLink roomCode={state.roomCode} compact />
                  )}
                  <div style={styles.log}>
                    {state.log.slice().reverse().map((entry, i) => (
                      <div key={i} style={styles.logLine}>{entry.message}</div>
                    ))}
                  </div>
                  <HomeButton roomCode={state.roomCode} onLeave={onLeave} compact />
                  {state.started && <EndGameControl state={state} myId={myId} compact />}
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
        {/* Prima del via il codice serve per far entrare gli altri: va in evidenza. */}
        {!state.started && (
          <div style={styles.preStart}>
            <div style={styles.codeRow}>
              Codice tavolo: <span className="mono" style={styles.code}>{state.roomCode}</span>
            </div>
            {state.players.length < 6 && <InviteLink roomCode={state.roomCode} compact />}

            {/* I bot li mette e li toglie chi ha creato il tavolo. Su telefono
                la fila delle pastiglie è troppo stretta per starci dentro una
                ✕ toccabile, quindi i bot rimovibili stanno su una riga loro. */}
            {state.hostId === myId && (
              <>
                {state.players.length < 6 && (
                  <BottoneAzione evento="add_bot" className="btn-ghost" style={styles.addBot}>
                    + Aggiungi bot
                  </BottoneAzione>
                )}
                {state.players.some((p) => p.isBot) && (
                  <div style={styles.botList}>
                    {state.players.filter((p) => p.isBot).map((p) => (
                      <BottoneAzione
                        key={p.id}
                        evento="remove_bot"
                        payload={{ botId: p.id }}
                        className="btn-ghost"
                        style={styles.botChip}
                      >
                        {p.token} {p.name} ✕
                      </BottoneAzione>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Visibile a tutti (non solo all'host, come i bot qui sopra):
                chi si siede deve sapere a che regole gioca, anche se non può
                cambiarle. Richiudibile perché su telefono lo spazio sopra il
                tabellone è già conteso da codice, invito e bot. */}
            <HouseRules state={state} myId={myId} compact />
          </div>
        )}

        <div style={styles.players}>
          {/* Da quattro in su le pastiglie si stringono per stare su due righe. */}
          {state.players.map((p) => (
            <div
              key={p.id}
              style={{
                ...styles.player,
                ...(affollato ? styles.playerStretto : null),
                borderColor: p.id === current?.id ? colorOf(p.id) : 'transparent',
                opacity: p.bankrupt ? 0.35 : 1,
              }}
            >
              <span style={{ ...styles.playerToken, filter: p.connected ? 'none' : 'grayscale(1)' }}>
                {p.token}
              </span>
              <span
                className={`mono ${p.balance < 0 ? 'money-negative' : ''}`}
                style={styles.playerBalance}
              >
                €{p.balance}
              </span>
              {p.isBot && <span style={styles.botTag}>BOT</span>}
              {!p.connected && !p.bankrupt && !affollato && (
                <span style={styles.offline}>offline</span>
              )}
              {/* Niente testo, niente numero: solo una tacca proporzionale al
                  patrimonio (contanti + proprietà + edifici), qui non c'è
                  spazio per altro. Assoluta sul fondo della pastiglia, così
                  non allarga la riga: il saldo qui sopra resta l'unico numero.
                  aria-label perché visivamente è solo un colore, senza testo. */}
              {!p.bankrupt && (
                <div style={styles.netWorthTrack} aria-label={`Patrimonio: €${p.netWorth}`}>
                  <div
                    style={{
                      ...styles.netWorthFill,
                      width: `${netWorthPercent.find((s) => s.id === p.id)?.percent ?? 0}%`,
                      background: colorOf(p.id),
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={styles.actions}>
          {!state.started ? (
            <BottoneAzione evento="start_game" style={styles.mainBtn}>
              Inizia partita
            </BottoneAzione>
          ) : state.finished ? (
            <span style={styles.waiting}>Partita finita</span>
          ) : isMyTurn && me?.inJail ? (
            <>
              <BottoneAzione evento="roll_dice" style={styles.mainBtn}>
                Tira (doppio per uscire)
              </BottoneAzione>
              <BottoneAzione evento="pay_jail_fine" className="btn-ghost" style={styles.smallBtn}>
                €{state.jailFine}
              </BottoneAzione>
              {me.jailCards > 0 && (
                <BottoneAzione evento="use_jail_card" className="btn-ghost" style={styles.smallBtn}>
                  Carta
                </BottoneAzione>
              )}
            </>
          ) : isMyTurn ? (
            <>
              {/* Il bersaglio più premuto della partita, e su telefono ha
                  "Fine" appiccicato accanto: qui il segno d'attesa non può
                  allargare il bottone, o sposterebbe l'altro sotto il pollice
                  a metà attesa (vedi BottoneAzione.tsx). */}
              <BottoneAzione evento="roll_dice" style={styles.mainBtn} disabled={blocked}>
                {rolledDouble ? 'Doppio! Tira ancora' : 'Tira i dadi'}
              </BottoneAzione>
              <BottoneAzione
                evento="end_turn"
                className="btn-ghost"
                style={styles.smallBtn}
                disabled={blocked}
              >
                Fine
              </BottoneAzione>
            </>
          ) : (
            <span style={styles.waiting}>Turno di {current?.name}</span>
          )}
        </div>

        {/* Nella barra fissa e non dentro il foglio che sale dal basso: la
            partita ferma si vede da qui, e il rimedio deve stare dove si sta
            già guardando, non sepolto sotto due tocchi. Non occupa spazio
            quando non serve — si disegna da solo solo se c'è un turno da
            sbloccare (vedi skipTurnPrompt). */}
        <SkipTurnControl state={state} myId={myId} compact />

        <div style={styles.tabs}>
          <button className="btn-ghost" style={styles.tab} onClick={() => setSheet('proprieta')}>
            🏠 Proprietà
          </button>
          {/* Lo scambio sale di livello: prima era sepolto dentro il foglio
              delle proprietà. Il registro non si perde, ha la sua scheda lì
              dentro. Prima del via resta visibile ma spento, così la barra non
              cambia forma quando la partita comincia. */}
          <button
            className="btn-ghost"
            style={styles.tab}
            disabled={!!scambiBloccati}
            title={scambiBloccati ?? undefined}
            onClick={onProposeTrade}
          >
            🤝 Scambio
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
    zIndex: LAYER.barraMobile,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    padding: '9px 10px calc(9px + env(safe-area-inset-bottom))',
    background: 'linear-gradient(180deg, rgba(15,61,46,0.94) 0%, #0c3125 100%)',
    borderTop: '1px solid rgba(201,150,44,0.35)',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 -6px 20px rgba(0,0,0,0.4)',
  },
  preStart: { display: 'flex', flexDirection: 'column', gap: 6 },
  codeRow: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.6)', textAlign: 'center' },
  code: { color: 'var(--brass-2)', letterSpacing: '0.14em', fontSize: '0.92rem' },
  players: { display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' },
  player: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px 6px',
    borderRadius: 999,
    border: '1.5px solid',
    background: 'rgba(0,0,0,0.22)',
    // La barra del patrimonio sta assoluta sul fondo (vedi netWorthTrack):
    // deve ancorarsi a questa pastiglia, non alla barra intera sotto.
    position: 'relative',
  },
  playerStretto: { padding: '2px 7px 5px', gap: 4 },
  playerToken: { fontSize: '1rem' },
  playerBalance: { fontSize: '0.85rem' },
  offline: { fontSize: '0.62rem', color: 'rgba(243,234,216,0.45)', fontStyle: 'italic' },
  // Sottile per non pesare sulla pastiglia: qui lo spazio è pochissimo,
  // quindi conta la lunghezza relativa, non lo spessore.
  netWorthTrack: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 3,
    height: 2,
    borderRadius: 1,
    background: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  netWorthFill: { height: '100%', borderRadius: 1 },
  // Azzurro, distinto dall'ottone dei giocatori veri.
  botTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.55rem',
    letterSpacing: '0.06em',
    color: '#7EC8E3',
  },
  addBot: { minHeight: 42, fontSize: '0.88rem' },
  botList: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  botChip: { minHeight: 40, fontSize: '0.78rem', padding: '0 12px' },
  actions: { display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center' },
  mainBtn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
  smallBtn: { minHeight: TOUCH_TARGET, padding: '0 14px', fontSize: '0.85rem' },
  // Stessa altezza dei bottoni anche quando al loro posto c'è solo l'attesa,
  // così la barra non si alza e abbassa a ogni cambio di turno.
  waiting: { color: 'rgba(243,234,216,0.6)', fontSize: '0.88rem', minHeight: TOUCH_TARGET, display: 'flex', alignItems: 'center' },
  tabs: { display: 'flex', gap: 7 },
  tab: { flex: 1, minHeight: 38, fontSize: '0.8rem', padding: '0 10px' },

  sheetOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: LAYER.foglioMobile,
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
  log: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: '0.8rem', color: 'rgba(243,234,216,0.78)' },
  logLine: { borderLeft: '2px solid rgba(201,150,44,0.35)', paddingLeft: 9 },
  closeSheet: { minHeight: 42, marginTop: 12 },
};
