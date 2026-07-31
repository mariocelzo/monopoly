import { BoardSquare, GameState } from '../socket';
import { GROUP_COLORS } from '../groupColors';
import { TOUCH_TARGET } from '../touchTarget';
import { PLAYER_COLORS } from './Board';
import { LAYER } from '../layers';

const STATION_RENT = [25, 50, 100, 200];

// L'affitto per livello di hotel arriva dal motore insieme al tabellone (vedi
// boardWithAmounts in gameEngine.js): prima il moltiplicatore e
// l'arrotondamento ai 25 erano ricopiati qui, ed erano la stessa regola scritta
// in due posti. `hotelRents[0]` è l'affitto con un hotel.
const hotelRent = (square: BoardSquare, hotels: number): number =>
  square.hotelRents?.[hotels - 1] ?? 0;

/**
 * Il contratto di una casella, come la targhetta del gioco vero. Si apre
 * toccando il tabellone ed è indispensabile su telefono, dove le caselle sono
 * troppo strette per mostrare il nome.
 */
export default function SquareDetail({
  square,
  state,
  onClose,
}: {
  square: BoardSquare;
  state: GameState;
  onClose: () => void;
}) {
  const owned = state.ownership[square.position];
  const owner = owned ? state.players.find((p) => p.id === owned.ownerId) : null;
  const ownerColor = owner
    ? PLAYER_COLORS[state.players.findIndex((p) => p.id === owner.id) % PLAYER_COLORS.length]
    : null;
  const bandColor = square.group ? GROUP_COLORS[square.group] : 'var(--brass)';

  /** Righe della tabella affitti, diverse per proprietà, stazioni e società. */
  const rentRows = (): [string, string][] => {
    if (square.type === 'property' && square.rents) {
      const rows: [string, string][] = [
        ['Terreno scoperto', `€${square.rents[0]}`],
        ['Con 1 casa', `€${square.rents[1]}`],
        ['Con 2 case', `€${square.rents[2]}`],
        ['Con 3 case', `€${square.rents[3]}`],
        ['Con 4 case', `€${square.rents[4]}`],
        ['Con 1 hotel', `€${square.rents[5]}`],
      ];
      // I livelli oltre il primo esistono solo con la modalità grattacieli:
      // mostrarli anche a regola spenta confonderebbe chi non può costruirli.
      if (state.rules.skyscraperEnabled) {
        rows.push(
          ['Con 2 hotel', `€${hotelRent(square, 2)}`],
          ['Con 3 hotel', `€${hotelRent(square, 3)}`],
          ['Con 4 hotel', `€${hotelRent(square, 4)}`],
        );
      }
      return rows;
    }
    if (square.type === 'station') {
      return STATION_RENT.map((rent, i) => [
        `${i + 1} stazione${i > 0 ? 'i' : ''} possedut${i > 0 ? 'e' : 'a'}`,
        `€${rent}`,
      ]);
    }
    if (square.type === 'utility') {
      return [
        ['Con 1 società', '4 × i dadi'],
        ['Con 2 società', '10 × i dadi'],
      ];
    }
    if (square.type === 'tax') return [['Da pagare', `€${square.amount}`]];
    return [];
  };

  const rows = rentRows();

  /**
   * Quale riga della tabella è quella in vigore adesso. Sapere che "con 3 case"
   * costa 750 serve poco se non si vede a colpo d'occhio a che punto siamo.
   */
  const rigaAttiva = (): number => {
    if (!owned || owned.mortgaged || square.type !== 'property') return -1;
    // Indice nella tabella qui sopra: 0 = scoperto, 1-4 = case, 5-8 = livelli
    // di hotel (5 = un hotel solo, fino a 8 col quarto) — le righe da 6 in su
    // esistono solo quando la modalità grattacieli è accesa, ma a modalità
    // spenta owned.hotels non supera comunque 1, quindi l'indice resta al
    // più 5 e la tabella (sempre a sei righe minimo) lo copre sempre.
    if (owned.hotels > 0) return 4 + owned.hotels;
    return owned.houses;
  };
  const attiva = rigaAttiva();

  return (
    <div className="scrim" style={styles.overlay} onClick={onClose}>
      <div className="panel" style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...styles.band, background: bandColor }}>
          <span style={styles.bandLabel}>
            {square.type === 'property' ? 'contratto' : square.type === 'station' ? 'stazione' : square.type === 'utility' ? 'società' : 'casella'}
          </span>
        </div>

        <h2 style={styles.title}>{square.name}</h2>
        {square.price !== undefined && <p style={styles.price}>€{square.price}</p>}

        {rows.length > 0 && (
          <div style={styles.rents}>
            {rows.map(([label, value], i) => (
              <div
                key={label}
                style={{ ...styles.rentRow, ...(i === attiva ? styles.rentRowActive : null) }}
              >
                <span style={i === attiva ? styles.rentLabelActive : styles.rentLabel}>
                  {i === attiva ? `▸ ${label}` : label}
                </span>
                <span style={i === attiva ? styles.rentValueActive : styles.rentValue}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {square.houseCost !== undefined && (
          <p style={styles.note}>
            Casa o primo hotel: €{square.houseCost} l'una
            {state.rules.skyscraperEnabled && ' · dal 2° hotel il prezzo cresce'}
          </p>
        )}
        {square.price !== undefined && (
          <p style={styles.note}>Valore d'ipoteca: €{square.mortgageValue ?? 0}</p>
        )}

        <div style={styles.ownerRow}>
          {owner ? (
            <>
              <span style={{ ...styles.ownerDot, background: ownerColor! }} />
              <span>
                Di <strong>{owner.name}</strong>
                {owned?.mortgaged
                  ? ' — ipotecata'
                  : owned?.hotels
                    ? (owned.hotels === 1 ? ' — con hotel' : ` — con ${owned.hotels} hotel`)
                    : owned?.houses
                      ? ` — ${owned.houses} case`
                      : ''}
              </span>
            </>
          ) : (
            <span style={styles.free}>
              {square.price !== undefined ? 'Libera' : 'Casella senza proprietario'}
            </span>
          )}
        </div>

        <button className="btn-ghost" style={styles.close} onClick={onClose}>Chiudi</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: LAYER.dettaglioCasella, padding: 18 },
  card: { width: 300, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', padding: 0, display: 'flex', flexDirection: 'column' },
  band: { height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', borderBottom: '2px solid rgba(0,0,0,0.4)' },
  bandLabel: { fontFamily: 'var(--font-mono)', fontSize: '0.66rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.65)', fontWeight: 700 },
  title: { fontSize: '1.25rem', textAlign: 'center', padding: '16px 18px 0' },
  price: { fontFamily: 'var(--font-mono)', fontSize: '1.35rem', color: 'var(--brass-2)', textAlign: 'center', margin: '6px 0 0' },
  rents: { display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 18px 0' },
  rentRow: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.78rem', borderBottom: '1px dotted rgba(201,150,44,0.22)', paddingBottom: 3 },
  rentRowActive: { background: 'rgba(201,150,44,0.16)', borderRadius: 4, padding: '2px 6px', marginLeft: -6, marginRight: -6 },
  rentLabel: { color: 'rgba(243,234,216,0.72)' },
  rentLabelActive: { color: 'var(--brass-2)', fontWeight: 700 },
  rentValueActive: { fontFamily: 'var(--font-mono)', color: 'var(--brass-2)', fontWeight: 700 },
  rentValue: { fontFamily: 'var(--font-mono)', color: 'var(--paper)' },
  note: { fontSize: '0.72rem', color: 'rgba(243,234,216,0.5)', margin: '8px 18px 0' },
  ownerRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', margin: '14px 18px 0', paddingTop: 12, borderTop: '1px solid rgba(201,150,44,0.2)' },
  ownerDot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  free: { color: 'rgba(243,234,216,0.55)', fontStyle: 'italic' },
  close: { margin: 18, marginTop: 14, minHeight: TOUCH_TARGET },
};
