import { BoardSquare, GameState, Ownership, inviaAzione } from '../socket';
import { GROUP_COLORS, GROUP_LABELS } from '../groupColors';

/**
 * Pannello "le mie proprietà": costruzione, vendita, ipoteca e riscatto.
 *
 * Le condizioni di `disabled` qui sotto rispecchiano quelle di gameEngine.js
 * solo per dare un feedback immediato e spiegare il perché nel tooltip: la
 * validazione vera resta esclusivamente sul server, e ogni errore che torna
 * dall'ack del socket viene mostrato nell'avviso comune (vedi azioni.ts).
 *
 * L'errore non si mostra più in fondo al pannello: questo componente compare
 * in tre posti diversi — la colonna su computer, il foglio che sale dal basso
 * su telefono, e dentro la finestra del debito — e "in fondo al pannello"
 * voleva dire tre posizioni diverse, in due casi su tre fuori dalla vista,
 * sotto un elenco che scorre. Adesso il messaggio compare sempre nello stesso
 * punto, qualunque comando lo abbia provocato.
 */
export default function PropertiesPanel({
  board,
  state,
  myId,
}: {
  board: BoardSquare[];
  state: GameState;
  myId: string;
}) {
  const me = state.players.find((p) => p.id === myId);
  const mine = board.filter((s) => state.ownership[s.position]?.ownerId === myId);

  // Un debito aperto congela le azioni che costano denaro (vedi gameEngine.js).
  const pendingDebt = state.pendingAction?.type === 'awaiting_debt';

  /** Invia l'intento al server; il rifiuto lo mostra l'avviso comune. */
  const emit = (event: string, position: number) => inviaAzione(event, { position });

  // Il tetto di hotel per proprietà segue la regola scelta al tavolo: 1 come da
  // regolamento classico, 4 con la modalità grattacieli accesa.
  const maxHotels = state.rules.skyscraperEnabled ? 4 : 1;

  const unitsOf = (owned: Ownership) => (owned.hotels > 0 ? 4 + owned.hotels : owned.houses);

  /** Unità casa su ogni casella del colore, incluse quelle non possedute (0). */
  const groupUnits = (group?: string) =>
    board
      .filter((s) => s.group === group)
      .map((s) => {
        const owned = state.ownership[s.position];
        return owned ? unitsOf(owned) : 0;
      });

  const ownsFullGroup = (group?: string) =>
    board.filter((s) => s.group === group).every((s) => state.ownership[s.position]?.ownerId === myId);

  const groupHasMortgage = (group?: string) =>
    board.filter((s) => s.group === group).some((s) => state.ownership[s.position]?.mortgaged);

  // Gli importi qui sotto NON si calcolano più: arrivano dal motore insieme al
  // tabellone (vedi boardWithAmounts in gameEngine.js e la rotta /board). Prima
  // le formule erano ricopiate qui — costo per livello di hotel, metà del
  // prezzo, il 10% di interesse in aritmetica intera — e vivevano di vita
  // propria: due copie della stessa regola che nessuno tiene allineate a mano
  // per sempre. In questo progetto quella famiglia di guai è già costata i bot
  // bloccati all'asta e il tasto "Rilancia" che offriva sotto il minimo su 24
  // caselle su 28.
  //
  // Gli array del server sono indicizzati per numero di unità meno uno:
  // `buildCosts[0]` è la prima casa, `buildCosts[4]` il primo hotel.

  /** Costo per costruire la prossima unità (casa o hotel) su questa casella. */
  const nextBuildCost = (square: BoardSquare, owned: Ownership): number =>
    square.buildCosts?.[unitsOf(owned)] ?? 0;

  /** Rimborso vendendo l'unità in cima alla pila (l'ultima costruita). */
  const currentSellRefund = (square: BoardSquare, owned: Ownership): number => {
    const units = unitsOf(owned);
    if (units === 0) return 0;
    return square.buildRefunds?.[units - 1] ?? 0;
  };

  /**
   * Affitto che quella casella incassa adesso. È solo informativo: il conto che
   * conta lo fa il server. Stazioni e società dipendono da quante se ne
   * possiedono e dai dadi, quindi qui si omettono.
   */
  const rentNow = (square: BoardSquare, owned: Ownership): number | null => {
    if (square.type !== 'property' || !square.rents) return null;
    if (owned.hotels > 0) return square.hotelRents?.[owned.hotels - 1] ?? null;
    if (owned.houses > 0) return square.rents[owned.houses];
    // Il raddoppio sul colore completo resta l'unica cosa che si legge qui: è
    // scritta sulla carta della proprietà, non è una formula con arrotondamenti.
    return ownsFullGroup(square.group) ? square.rents[0] * 2 : square.rents[0];
  };

  const mortgageValue = (square: BoardSquare) => square.mortgageValue ?? 0;
  const unmortgageCost = (square: BoardSquare) => square.unmortgageCost ?? 0;

  /** Motivo per cui non si può costruire, o null se si può. */
  const buildBlocker = (square: BoardSquare, owned: Ownership): string | null => {
    if (square.type !== 'property') return 'Su stazioni e società non si costruisce';
    if (pendingDebt) return 'Prima risolvi il debito in sospeso';
    if (!ownsFullGroup(square.group)) return 'Serve il monopolio del colore';
    if (groupHasMortgage(square.group)) return 'Riscatta prima le ipoteche del colore';
    if (owned.hotels >= maxHotels) return maxHotels === 1 ? "C'è già un hotel" : 'Hai già il massimo di hotel';
    if (unitsOf(owned) > Math.min(...groupUnits(square.group))) return 'Costruisci prima sulle altre del colore';
    if ((me?.balance ?? 0) < nextBuildCost(square, owned)) return 'Saldo insufficiente';
    return null;
  };

  const sellBlocker = (square: BoardSquare, owned: Ownership): string | null => {
    if (unitsOf(owned) === 0) return 'Nessuna casa da vendere';
    if (unitsOf(owned) < Math.max(...groupUnits(square.group))) return 'Vendi prima dalle altre del colore';
    return null;
  };

  const mortgageBlocker = (_square: BoardSquare, owned: Ownership): string | null => {
    if (owned.mortgaged) return 'Già ipotecata';
    if (unitsOf(owned) > 0) return 'Vendi prima case e hotel';
    return null;
  };

  const unmortgageBlocker = (square: BoardSquare, owned: Ownership): string | null => {
    if (!owned.mortgaged) return 'Non è ipotecata';
    if (pendingDebt) return 'Prima risolvi il debito in sospeso';
    if ((me?.balance ?? 0) < unmortgageCost(square)) return 'Saldo insufficiente';
    return null;
  };

  if (mine.length === 0) {
    return <p style={styles.empty}>Non possiedi ancora nessuna proprietà.</p>;
  }

  // Le proprietà colorate si raggruppano per colore, stazioni e società per tipo.
  const groups = new Map<string, BoardSquare[]>();
  mine.forEach((square) => {
    const key = square.group || square.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(square);
  });

  return (
    <div style={styles.wrap}>
      {[...groups.entries()].map(([key, squares]) => (
        <div key={key} style={styles.group}>
          <div style={styles.groupHeader}>
            <span style={{ ...styles.chip, background: GROUP_COLORS[key] || 'var(--brass)' }} />
            <span style={styles.groupName}>{GROUP_LABELS[key] || key}</span>
            {GROUP_COLORS[key] && ownsFullGroup(squares[0].group) && (
              <span style={styles.monopolyTag}>monopolio</span>
            )}
          </div>

          {squares.map((square) => {
            const owned = state.ownership[square.position];
            const build = buildBlocker(square, owned);
            const sell = sellBlocker(square, owned);
            const mortgage = mortgageBlocker(square, owned);
            const unmortgage = unmortgageBlocker(square, owned);
            const isProperty = square.type === 'property';

            return (
              <div key={square.position} style={styles.row}>
                <div style={styles.rowInfo}>
                  <span style={{ ...styles.name, opacity: owned.mortgaged ? 0.5 : 1 }}>{square.name}</span>
                  <span style={styles.status}>
                    {owned.mortgaged
                      ? 'ipotecata'
                      : owned.hotels > 0
                        ? (owned.hotels === 1 ? '🏨 hotel' : `🏨×${owned.hotels} hotel`)
                        : owned.houses > 0
                          ? `${'🏠'.repeat(owned.houses)} ${owned.houses}/4`
                          : 'terreno scoperto'}
                  </span>
                </div>
                {!owned.mortgaged && rentNow(square, owned) !== null && (
                  <div style={styles.rentNow}>
                    Affitto adesso: <strong>€{rentNow(square, owned)}</strong>
                  </div>
                )}
                <div style={styles.rowActions}>
                  {isProperty && (
                    <>
                      <button
                        className="btn-mini"
                        disabled={!!build}
                        title={build || `Costruisci per €${nextBuildCost(square, owned)}`}
                        onClick={() => emit('build_house', square.position)}
                      >
                        Costruisci
                      </button>
                      <button
                        className="btn-mini"
                        disabled={!!sell}
                        title={sell || `Vendi per €${currentSellRefund(square, owned)}`}
                        onClick={() => emit('sell_house', square.position)}
                      >
                        Vendi
                      </button>
                    </>
                  )}
                  {owned.mortgaged ? (
                    <button
                      className="btn-mini"
                      disabled={!!unmortgage}
                      title={unmortgage || `Riscatta per €${unmortgageCost(square)}`}
                      onClick={() => emit('unmortgage_property', square.position)}
                    >
                      Riscatta €{unmortgageCost(square)}
                    </button>
                  ) : (
                    <button
                      className="btn-mini"
                      disabled={!!mortgage}
                      title={mortgage || `Ipoteca per €${mortgageValue(square)}`}
                      onClick={() => emit('mortgage_property', square.position)}
                    >
                      Ipoteca €{mortgageValue(square)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  empty: { fontSize: '0.8rem', color: 'rgba(243,234,216,0.5)', fontStyle: 'italic' },
  group: { display: 'flex', flexDirection: 'column', gap: 6 },
  groupHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  chip: { width: 14, height: 14, borderRadius: 3, border: '1px solid rgba(0,0,0,0.35)' },
  groupName: { fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  monopolyTag: { fontSize: '0.62rem', color: 'var(--brass-2)', border: '1px solid var(--brass)', borderRadius: 4, padding: '1px 5px' },
  row: { display: 'flex', flexDirection: 'column', gap: 5, padding: '7px 9px', borderRadius: 8, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(201,150,44,0.15)' },
  rowInfo: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  name: { fontSize: '0.82rem', fontWeight: 600, color: 'var(--paper)' },
  status: { fontSize: '0.7rem', color: 'var(--brass-2)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' },
  rentNow: { fontSize: '0.7rem', color: 'rgba(243,234,216,0.6)' },
  rowActions: { display: 'flex', gap: 5, flexWrap: 'wrap' },
};
