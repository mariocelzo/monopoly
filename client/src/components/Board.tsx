import { useEffect, useRef, useState } from 'react';
import { BoardSquare, GameState } from '../socket';
import { GROUP_COLORS } from '../groupColors';
import Dice from './Dice';
import { LAYER } from '../layers';

/**
 * Riga e colonna (1-based) della casella nella griglia 11x11. Esportata perche'
 * la mappa in miniatura dello scambio deve disporre le caselle allo stesso modo.
 */
export function gridPos(position: number): { row: number; col: number } {
  if (position === 0) return { row: 11, col: 11 };
  if (position >= 1 && position <= 9) return { row: 11, col: 11 - position };
  if (position === 10) return { row: 11, col: 1 };
  if (position >= 11 && position <= 19) return { row: 11 - (position - 10), col: 1 };
  if (position === 20) return { row: 1, col: 1 };
  if (position >= 21 && position <= 29) return { row: 1, col: 1 + (position - 20) };
  if (position === 30) return { row: 1, col: 11 };
  return { row: 1 + (position - 30), col: 11 }; // 31-39
}

// La griglia è `1.4fr repeat(9, 1fr) 1.4fr`: gli angoli sono più larghi, quindi
// il centro di una cella non si ricava dividendo per 11.
const CORNER = 1.4;
const TRACK = CORNER * 2 + 9;

/** Centro di una riga o colonna, in percentuale sul lato del tabellone. */
function centerPercent(index: number): number {
  const i = index - 1;
  if (i === 0) return (CORNER / 2 / TRACK) * 100;
  if (i === 10) return ((CORNER + 9 + CORNER / 2) / TRACK) * 100;
  return ((CORNER + (i - 1) + 0.5) / TRACK) * 100;
}

// Un colore per giocatore, fino a sei: pedine, bordi di proprietà e legenda.
// Devono restare distinguibili sul feltro verde scuro, quindi niente verdi.
export const PLAYER_COLORS = [
  '#E8B85A', // ottone
  '#7EC8E3', // azzurro
  '#F2718A', // rosa
  '#B9E06A', // lime
  '#C39BF0', // viola
  '#F58C4B', // arancio
];

const CORNER_ICONS: Record<number, string> = { 0: '➜', 10: '⛓', 20: '🅿', 30: '👮' };
const CORNER_LABELS: Record<number, string> = { 0: 'VIA', 10: 'PRIGIONE', 20: 'SOSTA', 30: 'IN GALERA' };

/** Da '#rrggbb' a 'rgba(r,g,b,a)', per velare le caselle possedute senza toccare l'opacità dell'intero elemento. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Quanto è forte la velatura del colore del proprietario sulla casella.
// Tenuta bassa apposta: i colori dei giocatori (l'ottone, il rosa) sono vicini
// a quelli dei gruppi (giallo, rosa), e con troppa intensità le due fasce di
// colore si confondono — non si capisce più né il gruppo né il proprietario.
// La fascia del gruppo resta sempre a piena intensità sopra questa velatura.
const OWNER_WASH_ALPHA = 0.16;

/**
 * Tutte le misure interne del tabellone derivano dalla sua larghezza (--bw), non
 * da rem fissi: così su telefono i testi rimpiccioliscono insieme alle caselle
 * invece di uscire dai bordi.
 */
const scaled = (factor: number, min?: string) =>
  min ? `max(${min}, calc(var(--bw) * ${factor}))` : `calc(var(--bw) * ${factor})`;

// Durata di un passo del cammino della pedina.
const STEP_MS = 110;

// Sotto questa larghezza del tabellone una casella scende sotto i ~52px e il
// nome della proprietà diventa illeggibile: meglio toglierlo del tutto.
const NAME_THRESHOLD = 620;

// Per quanto i dadi restano visibili dopo che il turno si è chiuso.
const DADI_GRAZIA_MS = 2600;

/**
 * L'ultimo tiro da mostrare, che non è sempre quello che dice il server.
 *
 * Il motore azzera `lastRoll` a fine turno, così il tabellone non attribuisce
 * a chi sta giocando adesso il tiro di chi ha già finito. Ma quando un tiro
 * non apre nulla — si atterra su una casella propria, sulla sosta, sul
 * transito — il turno si chiude nello stesso istante del lancio: il server
 * manda un solo stato, in cui `lastRoll` è già null, e i dadi **non si vedono
 * affatto**. È il difetto per cui sembrava che a volte i dadi non uscissero.
 *
 * Qui il tiro appena sparito si tiene ancora per qualche secondo, poi si
 * lascia andare: si vede sempre cosa è uscito, e non resta comunque appeso a
 * mostrare il tiro di qualcun altro mentre tocca a te.
 */
function useUltimoTiro(lastRoll: GameState['lastRoll']) {
  const [mostrato, setMostrato] = useState(lastRoll);

  useEffect(() => {
    if (lastRoll) {
      setMostrato(lastRoll);
      return;
    }
    // Sparito dal server: lo si tiene ancora un momento, non un istante.
    const t = setTimeout(() => setMostrato(null), DADI_GRAZIA_MS);
    return () => clearTimeout(t);
  }, [lastRoll]);

  return mostrato;
}

/**
 * Larghezza reale del tabellone in pixel. Si misura invece di dedurla dal tipo
 * di dispositivo: un tablet in verticale ha caselle comode quanto un desktop, e
 * la stessa pagina cambia dimensione ruotando il telefono.
 */
function useMeasuredWidth(ref: React.RefObject<HTMLDivElement>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Muove le pedine una casella alla volta invece di farle saltare a destinazione.
 * I salti lunghi (carte "avanza fino a", prigione) non si percorrono a piedi: si
 * scivola direttamente, altrimenti l'attesa sarebbe interminabile.
 */
function useWalkingPositions(state: GameState): Record<string, number> {
  const [shown, setShown] = useState<Record<string, number>>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setShown((prev) => {
      const next = { ...prev };
      let changed = false;
      state.players.forEach((p) => {
        if (next[p.id] === undefined) {
          next[p.id] = p.position;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [state.players]);

  useEffect(() => {
    if (timer.current !== null) return;

    const step = () => {
      setShown((prev) => {
        const next = { ...prev };
        let moving = false;
        state.players.forEach((p) => {
          const current = next[p.id];
          if (current === undefined || current === p.position) return;
          const forward = (p.position - current + 40) % 40;
          // Un tiro di dadi non supera mai le 12 caselle: oltre è un salto.
          next[p.id] = forward <= 12 ? (current + 1) % 40 : p.position;
          if (next[p.id] !== p.position) moving = true;
        });
        if (!moving && timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        return next;
      });
    };

    const needsWalk = state.players.some((p) => shown[p.id] !== undefined && shown[p.id] !== p.position);
    if (needsWalk) timer.current = window.setInterval(step, STEP_MS);

    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [state.players, shown]);

  /**
   * Rete di sicurezza: la posizione mostrata deve sempre finire per combaciare
   * con quella del server. Il browser congela i timer delle schede in secondo
   * piano, quindi un cammino iniziato e poi interrotto lascerebbe la pedina su
   * una casella sbagliata a tempo indeterminato. Qui si allinea comunque: al
   * più tardi allo scadere del cammino più lungo possibile, e subito quando la
   * pagina torna in primo piano.
   */
  useEffect(() => {
    const allinea = () => {
      setShown((prev) => {
        const next = { ...prev };
        let changed = false;
        state.players.forEach((p) => {
          if (next[p.id] !== p.position) {
            next[p.id] = p.position;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };

    // Un tiro non supera le 12 caselle, più un margine per i ritardi di rete.
    const scadenza = window.setTimeout(allinea, 12 * STEP_MS + 900);
    const alRitorno = () => { if (!document.hidden) allinea(); };
    document.addEventListener('visibilitychange', alRitorno);

    return () => {
      window.clearTimeout(scadenza);
      document.removeEventListener('visibilitychange', alRitorno);
    };
  }, [state.players]);

  return shown;
}

export default function Board({
  board,
  state,
  onSquareClick,
  isMobile = false,
}: {
  board: BoardSquare[];
  state: GameState;
  onSquareClick: (position: number) => void;
  isMobile?: boolean;
}) {
  const walking = useWalkingPositions(state);
  const gridRef = useRef<HTMLDivElement>(null);
  const measured = useMeasuredWidth(gridRef);
  // Non `state.lastRoll` diretto: vedi useUltimoTiro, i dadi devono restare
  // visibili anche quando il turno si chiude nello stesso istante del lancio.
  const ultimoTiro = useUltimoTiro(state.lastRoll);
  const colorOf = (playerId: string) =>
    PLAYER_COLORS[state.players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];

  // Su telefono il tabellone prende tutta la larghezza, lasciando spazio alla
  // barra dei comandi in fondo. dvh tiene conto della barra del browser.
  const boardWidth = isMobile
    ? 'min(calc(100vw - 14px), calc(100dvh - 200px))'
    : 'min(78vh, 92vw)';

  // Finché la misura non è arrivata si presume largo: evita che i nomi
  // spariscano per un istante al primo disegno su desktop.
  const compact = measured > 0 && measured < NAME_THRESHOLD;

  // Sotto i ~400px di tabellone (un telefono stretto) il centro è troppo
  // piccolo per il sottotitolo del marchio oltre a dadi e pastiglie: si
  // toglie quello, che è il pezzo meno utile a chi gioca.
  const veryCompact = measured > 0 && measured < 400;

  const roller = ultimoTiro ? state.players.find((p) => p.id === ultimoTiro.playerId) : null;
  const somma = ultimoTiro ? ultimoTiro.dice[0] + ultimoTiro.dice[1] : null;
  // Dimensione dei dadi: protagonisti del centro, ma con margine per non
  // strabordare quando il tabellone è stretto.
  const diceSize = compact ? 32 : 50;

  return (
    <div style={{ ...styles.frame, padding: isMobile ? 5 : 10 }}>
      <div
        ref={gridRef}
        style={{ ...styles.grid, width: boardWidth, ['--bw' as string]: boardWidth } as React.CSSProperties}
      >
        {board.map((square) => {
          const { row, col } = gridPos(square.position);
          const owned = state.ownership[square.position];
          const owner = owned ? state.players.find((p) => p.id === owned.ownerId) : null;
          const isCorner = square.position % 10 === 0;
          // Con caselle da ~28px i nomi verrebbero tagliati: restano colore,
          // prezzo e proprietario, e il nome si legge toccando la casella.
          const showName = !compact || isCorner;

          return (
            <div
              key={square.position}
              className="board-square"
              onClick={() => onSquareClick(square.position)}
              style={{
                ...styles.square,
                ...(isCorner ? styles.cornerSquare : null),
                gridRow: row,
                gridColumn: col,
                boxShadow: owner
                  ? `inset 0 0 0 2px ${colorOf(owner.id)}, inset 0 2px 6px rgba(0,0,0,0.28)`
                  : 'inset 0 2px 6px rgba(0,0,0,0.18)',
                opacity: owned?.mortgaged ? 0.5 : 1,
              }}
              title={
                owner
                  ? `${square.name} — di ${owner.name}${owned?.mortgaged ? ' (ipotecata)' : ''}`
                  : square.name
              }
            >
              {/* Velatura del colore del proprietario: sta sotto la fascia del
                  gruppo (che la ricopre a piena intensità) e sopra lo sfondo
                  della casella, così il tabellone legge come una mappa di
                  territori senza far sparire il colore del gruppo. */}
              {owner && <div style={{ ...styles.ownerWash, background: hexToRgba(colorOf(owner.id), OWNER_WASH_ALPHA) }} />}

              {square.group && (
                <div
                  style={{
                    ...styles.colorBar,
                    background: `linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.16) 100%), ${GROUP_COLORS[square.group]}`,
                    height: compact ? '34%' : '20%',
                  }}
                >
                  {/* Case e hotel disegnati sulla fascia, come sul tabellone vero. */}
                  {owned?.hotel && <span style={styles.hotel} />}
                  {!owned?.hotel &&
                    Array.from({ length: owned?.houses || 0 }).map((_, i) => (
                      <span key={i} style={styles.house} />
                    ))}
                </div>
              )}

              {isCorner && <span style={styles.cornerIcon}>{CORNER_ICONS[square.position]}</span>}
              {showName && (
                <span style={{ ...styles.squareName, ...(isCorner ? styles.cornerName : null) }}>
                  {isCorner && compact ? CORNER_LABELS[square.position] : square.name}
                </span>
              )}
              {square.price !== undefined && !isCorner && (
                <span style={styles.squarePrice}>{square.price}</span>
              )}
              {owned?.mortgaged &&
                (compact ? <span style={styles.mortgageDot}>✕</span> : <span style={styles.mortgageTag}>IPOT.</span>)}

              {/* Pedone del proprietario in un angolo: conferma la velatura
                  anche per chi non distingue bene le tinte vicine. */}
              {owner && (
                <span style={{ ...styles.ownerBadge, borderColor: colorOf(owner.id) }}>{owner.token}</span>
              )}
            </div>
          );
        })}

        <div style={styles.center}>
          {/* Il marchio resta, ma solo come filigrana dietro la plancia:
              qui si guarda soprattutto mentre si gioca, non per leggere
              "MONOPOLY". Posizionato in assoluto e senza z-index proprio,
              così l'ordine nel markup basta a tenerlo dietro al contenuto
              vero (vedi le regole di stacking di un elemento position:
              relative seguito da un fratello position: relative). */}
          <div style={styles.watermark}>
            <span className="display" style={styles.watermarkTitle}>MONOPOLY</span>
            {!veryCompact && <span style={styles.watermarkSub}>edizione Noi Due</span>}
          </div>

          <div style={styles.plancia}>
            {/* I dadi restano al loro posto anche senza un tiro da mostrare:
                le due varianti (vero tiro / in attesa) hanno la stessa
                struttura e la stessa altezza, così la plancia non salta
                quando ultimoTiro torna a null (vedi useUltimoTiro sopra). */}
            <div style={styles.diceArea}>
              {ultimoTiro ? (
                <>
                  <Dice dice={ultimoTiro.dice} seq={ultimoTiro.seq} size={diceSize} />
                  <span style={styles.diceCaption}>
                    <strong style={{ color: roller ? colorOf(roller.id) : undefined }}>
                      {roller?.name}
                    </strong>{' '}
                    ha fatto {somma}
                  </span>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: diceSize * 0.25 }}>
                    <span style={{ ...styles.diceGhost, width: diceSize, height: diceSize, borderRadius: diceSize * 0.18 }} />
                    <span style={{ ...styles.diceGhost, width: diceSize, height: diceSize, borderRadius: diceSize * 0.18 }} />
                  </div>
                  <span style={{ ...styles.diceCaption, opacity: 0.45 }}>in attesa del tiro…</span>
                </>
              )}
            </div>

            <div style={styles.playerRow}>
              {state.players.map((p) => {
                const diTurno = !state.finished && state.players[state.turnIndex]?.id === p.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      ...styles.playerPill,
                      ...(diTurno
                        ? {
                            ...styles.playerPillActive,
                            borderColor: colorOf(p.id),
                            boxShadow: `0 0 0 1px ${colorOf(p.id)}, 0 0 10px ${colorOf(p.id)}66`,
                          }
                        : null),
                      opacity: p.bankrupt ? 0.35 : 1,
                    }}
                  >
                    {diTurno && <span style={{ ...styles.pillArrow, color: colorOf(p.id) }}>▶</span>}
                    <span style={styles.pillToken}>{p.token}</span>
                    <span style={styles.pillName}>{p.name}</span>
                    <span style={{ ...styles.pillBalance, color: p.balance < 0 ? '#e18a8a' : 'var(--brass-2)' }}>
                      €{p.balance}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* I pedoni vivono in un piano sopra la griglia: così possono scivolare
            da una casella all'altra invece di ricomparire altrove. */}
        {state.players.map((p, index) => {
          if (p.bankrupt) return null;
          const at = walking[p.id] ?? p.position;
          const { row, col } = gridPos(at);
          // In cerchio attorno al centro della casella: con due danno destra e
          // sinistra come prima, con sei restano tutte distinguibili.
          const quanti = Math.max(state.players.length, 2);
          const angolo = (index / quanti) * Math.PI * 2;
          const dx = (Math.cos(angolo) * 32).toFixed(1);
          const dy = (Math.sin(angolo) * 32).toFixed(1);
          return (
            <div
              key={p.id}
              style={{
                ...styles.pawn,
                left: `${centerPercent(col)}%`,
                top: `${centerPercent(row)}%`,
                transform: `translate(calc(-50% + ${dx}%), calc(-50% + ${dy}%))`,
                borderColor: colorOf(p.id),
                boxShadow: `0 2px 8px rgba(0,0,0,0.5), 0 0 12px ${colorOf(p.id)}55`,
              }}
              title={`${p.name} — ${board[at]?.name || ''}`}
            >
              {p.token}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frame: {
    borderRadius: 16,
    // Cornice in ottone spazzolato attorno al feltro.
    background: 'linear-gradient(145deg, #c9962c 0%, #7d5c16 40%, #e8b85a 70%, #a87f22 100%)',
    boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
  },
  grid: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1.4fr repeat(9, 1fr) 1.4fr',
    gridTemplateRows: '1.4fr repeat(9, 1fr) 1.4fr',
    aspectRatio: '1 / 1',
    background:
      'radial-gradient(ellipse at 50% 42%, #205f49 0%, #123f30 60%, #0c3125 100%), repeating-linear-gradient(45deg, rgba(255,255,255,0.014) 0 2px, transparent 2px 4px)',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: 'inset 0 0 40px rgba(0,0,0,0.45)',
  },
  square: {
    border: '1px solid rgba(201,150,44,0.16)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '4% 2% 3%',
    position: 'relative',
    overflow: 'hidden',
    background: 'linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.2) 100%)',
    cursor: 'pointer',
    transition: 'box-shadow 0.18s ease, opacity 0.18s ease, background 0.18s ease',
  },
  cornerSquare: {
    justifyContent: 'center',
    gap: '4%',
    background: 'radial-gradient(circle at 50% 40%, rgba(201,150,44,0.16), rgba(0,0,0,0.3))',
  },
  cornerIcon: { fontSize: scaled(0.026), lineHeight: 1, color: 'var(--brass-2)' },
  cornerName: { fontSize: scaled(0.0115, '6px'), letterSpacing: '0.04em', textTransform: 'uppercase' },
  colorBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderBottom: '1px solid rgba(0,0,0,0.5)',
    boxShadow: 'inset 0 -3px 5px rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4%',
  },
  // Copre tutta la casella; il colore vero arriva inline (dipende dal
  // proprietario). Sta prima della colorBar nel markup, quindi quella la
  // ricopre: la fascia del gruppo non si vela mai.
  ownerWash: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  ownerBadge: {
    position: 'absolute',
    bottom: '3%',
    right: '3%',
    width: scaled(0.022, '10px'),
    height: scaled(0.022, '10px'),
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: scaled(0.014, '7px'),
    lineHeight: 1,
    background: 'rgba(12,20,16,0.72)',
    border: '1px solid',
    boxShadow: '0 1px 3px rgba(0,0,0,0.55)',
  },
  // Sagoma di casetta col tetto a punta: il drop-shadow sta in filter perché
  // box-shadow verrebbe tagliato via dal clip-path.
  house: {
    width: scaled(0.011, '5px'),
    height: scaled(0.0105, '5px'),
    clipPath: 'polygon(50% 0, 100% 38%, 100% 100%, 0 100%, 0 38%)',
    background: 'linear-gradient(180deg, #63e89e 0%, #2a9e5f 100%)',
    filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))',
  },
  hotel: {
    width: scaled(0.02, '10px'),
    height: scaled(0.0135, '7px'),
    clipPath: 'polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)',
    background: 'linear-gradient(180deg, #ff8a7c 0%, #c93225 100%)',
    filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.6))',
  },
  squareName: {
    fontSize: scaled(0.0122, '6px'),
    textAlign: 'center',
    lineHeight: 1.1,
    color: 'var(--paper)',
    fontWeight: 600,
  },
  squarePrice: {
    fontSize: scaled(0.0115, '6px'),
    fontFamily: 'var(--font-mono)',
    color: 'var(--brass-2)',
    marginTop: '3%',
  },
  mortgageTag: {
    position: 'absolute',
    top: '24%',
    fontSize: scaled(0.0095, '5px'),
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.08em',
    color: '#e18a8a',
  },
  mortgageDot: { position: 'absolute', top: '38%', fontSize: scaled(0.016, '8px'), color: '#e18a8a' },
  center: {
    gridRow: '2 / 11',
    gridColumn: '2 / 11',
    position: 'relative',
    // Anello in ottone attorno al centro, come la cornice del tabellone vero.
    margin: '2.5%',
    border: '1.5px solid rgba(201,150,44,0.22)',
    borderRadius: 14,
    boxShadow: 'inset 0 0 34px rgba(0,0,0,0.22)',
  },
  // Filigrana del marchio: riempie il centro da dietro, la plancia vera
  // (position: relative, disegnata dopo nel markup) le sta sopra.
  // In alto, non al centro: filigrana e plancia erano entrambe centrate
  // verticalmente e finivano una sopra l'altra — la didascalia dei dadi
  // cadeva esattamente sulla scritta MONOPOLY e non si leggeva più né l'una
  // né l'altra. Abbassare l'opacità non bastava: testo su testo resta
  // illeggibile comunque, serve separarli.
  watermark: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '7%',
    gap: '1.5%',
    pointerEvents: 'none',
  },
  watermarkTitle: {
    fontSize: scaled(0.072),
    color: 'var(--brass)',
    letterSpacing: '0.06em',
    opacity: 0.22,
    textShadow: '0 2px 10px rgba(0,0,0,0.4)',
  },
  watermarkSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: scaled(0.017, '9px'),
    color: 'var(--paper)',
    opacity: 0.16,
  },
  // La plancia vera: dadi e pastiglie, quello che si guarda mentre si gioca.
  plancia: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4%',
    padding: '4%',
    height: '100%',
  },
  // Stessa forma sia col tiro vero sia in attesa, così l'altezza non cambia
  // e la plancia non "salta" quando ultimoTiro torna a null.
  diceArea: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  diceGhost: {
    display: 'block',
    background: 'rgba(243,234,216,0.06)',
    border: '1px dashed rgba(243,234,216,0.18)',
  },
  diceCaption: {
    fontFamily: 'var(--font-mono)',
    fontSize: scaled(0.019, '10px'),
    color: 'var(--paper)',
  },
  playerRow: { display: 'flex', gap: '4%', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%' },
  playerPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 999,
    border: '1px solid transparent',
    fontSize: scaled(0.015, '9px'),
    color: 'rgba(243,234,216,0.75)',
    background: 'rgba(0,0,0,0.18)',
  },
  // Chi sta giocando adesso: pastiglia col bordo e il bagliore del suo
  // colore, così si vede a colpo d'occhio senza dover leggere il testo.
  playerPillActive: {
    background: 'rgba(0,0,0,0.32)',
    color: 'var(--paper)',
  },
  pillArrow: { fontSize: scaled(0.011, '7px'), lineHeight: 1 },
  pillToken: { fontSize: scaled(0.021, '12px'), lineHeight: 1 },
  pillName: { fontFamily: 'var(--font-mono)' },
  pillBalance: { fontFamily: 'var(--font-mono)', fontWeight: 700 },
  pawn: {
    position: 'absolute',
    width: scaled(0.037, '17px'),
    height: scaled(0.037, '17px'),
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: scaled(0.022, '10px'),
    background: 'radial-gradient(circle at 35% 30%, #1e6b51, #0c3125)',
    border: '2px solid',
    pointerEvents: 'none',
    zIndex: LAYER.tabellone,
    // La transizione sta dentro la durata di un passo (STEP_MS).
    transition: 'left 0.1s linear, top 0.1s linear',
  },
};
