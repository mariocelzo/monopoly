import { useState } from 'react';
import { BoardSquare, GameState, socket } from '../socket';
import { GROUP_COLORS } from '../groupColors';

/**
 * Composizione di una proposta di scambio: si spuntano le proprietà da offrire e
 * quelle da chiedere, si aggiunge del denaro da una parte o dall'altra e si
 * manda. Come per il resto, il client si limita a raccogliere l'intento: ogni
 * regola (edifici sul colore, denaro disponibile) la applica il server.
 */
export default function TradeModal({
  board,
  state,
  myId,
  onClose,
}: {
  board: BoardSquare[];
  state: GameState;
  myId: string;
  onClose: () => void;
}) {
  const me = state.players.find((p) => p.id === myId);
  const other = state.players.find((p) => p.id !== myId && !p.bankrupt);

  const [offerProperties, setOfferProperties] = useState<number[]>([]);
  const [requestProperties, setRequestProperties] = useState<number[]>([]);
  const [offerMoney, setOfferMoney] = useState('0');
  const [requestMoney, setRequestMoney] = useState('0');
  const [offerJailCards, setOfferJailCards] = useState('0');
  const [requestJailCards, setRequestJailCards] = useState('0');
  const [error, setError] = useState<string | null>(null);

  if (!other || !me) {
    return null;
  }

  const ownedBy = (playerId: string) =>
    board.filter((s) => state.ownership[s.position]?.ownerId === playerId);

  const toggle = (list: number[], setList: (v: number[]) => void, position: number) => {
    setError(null);
    setList(list.includes(position) ? list.filter((p) => p !== position) : [...list, position]);
  };

  const send = () => {
    setError(null);
    socket.emit(
      'propose_trade',
      {
        toId: other.id,
        offerProperties,
        requestProperties,
        offerMoney: Number(offerMoney) || 0,
        requestMoney: Number(requestMoney) || 0,
        offerJailCards: Number(offerJailCards) || 0,
        requestJailCards: Number(requestJailCards) || 0,
      },
      (res: { error?: string }) => {
        if (res?.error) setError(res.error);
        else onClose();
      }
    );
  };

  /** Elenco spuntabile delle proprietà di un giocatore. */
  const propertyList = (playerId: string, selected: number[], setSelected: (v: number[]) => void) => {
    const squares = ownedBy(playerId);
    if (squares.length === 0) return <p style={styles.none}>nessuna proprietà</p>;
    return squares.map((square) => {
      const owned = state.ownership[square.position];
      const isOn = selected.includes(square.position);
      return (
        <label
          key={square.position}
          style={{ ...styles.item, borderColor: isOn ? 'var(--brass)' : 'transparent' }}
        >
          <input
            type="checkbox"
            checked={isOn}
            onChange={() => toggle(selected, setSelected, square.position)}
          />
          <span
            style={{
              ...styles.dot,
              background: square.group ? GROUP_COLORS[square.group] : 'var(--brass)',
            }}
          />
          <span style={styles.itemName}>{square.name}</span>
          {owned.mortgaged && <span style={styles.mortgaged}>ipot.</span>}
        </label>
      );
    });
  };

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>proposta di scambio</span>
        <h2 style={styles.title}>Tu ↔ {other.name}</h2>

        <div style={styles.columns}>
          <div style={styles.column}>
            <h3 style={styles.columnTitle}>Offri tu</h3>
            <div style={styles.list}>{propertyList(myId, offerProperties, setOfferProperties)}</div>
            <label style={styles.moneyLabel}>
              Denaro (hai €{me.balance})
              <input
                style={styles.money}
                type="number"
                min={0}
                max={me.balance}
                value={offerMoney}
                onChange={(e) => setOfferMoney(e.target.value)}
              />
            </label>
            {me.jailCards > 0 && (
              <label style={styles.moneyLabel}>
                Carte uscita di prigione (ne hai {me.jailCards})
                <input
                  style={styles.money}
                  type="number"
                  min={0}
                  max={me.jailCards}
                  value={offerJailCards}
                  onChange={(e) => setOfferJailCards(e.target.value)}
                />
              </label>
            )}
          </div>

          <div style={styles.column}>
            <h3 style={styles.columnTitle}>Chiedi a {other.name}</h3>
            <div style={styles.list}>
              {propertyList(other.id, requestProperties, setRequestProperties)}
            </div>
            <label style={styles.moneyLabel}>
              Denaro (ha €{other.balance})
              <input
                style={styles.money}
                type="number"
                min={0}
                max={other.balance}
                value={requestMoney}
                onChange={(e) => setRequestMoney(e.target.value)}
              />
            </label>
            {other.jailCards > 0 && (
              <label style={styles.moneyLabel}>
                Carte uscita di prigione (ne ha {other.jailCards})
                <input
                  style={styles.money}
                  type="number"
                  min={0}
                  max={other.jailCards}
                  value={requestJailCards}
                  onChange={(e) => setRequestJailCards(e.target.value)}
                />
              </label>
            )}
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.actions}>
          <button className="btn-primary" onClick={send}>Manda la proposta</button>
          <button className="btn-ghost" onClick={onClose}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 25, padding: 20 },
  card: { padding: 26, width: 560, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 12 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.4rem' },
  columns: { display: 'flex', gap: 16, flexWrap: 'wrap', overflowY: 'auto' },
  column: { flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 8 },
  columnTitle: { fontSize: '0.8rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  list: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto' },
  none: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.45)', fontStyle: 'italic', margin: 0 },
  item: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 6, border: '1px solid transparent', background: 'rgba(0,0,0,0.18)', cursor: 'pointer' },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0, border: '1px solid rgba(0,0,0,0.35)' },
  itemName: { fontSize: '0.78rem', flex: 1 },
  mortgaged: { fontSize: '0.62rem', color: '#e18a8a', fontFamily: 'var(--font-mono)' },
  moneyLabel: { fontSize: '0.74rem', color: 'rgba(243,234,216,0.6)', display: 'flex', flexDirection: 'column', gap: 5 },
  money: { padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(201,150,44,0.3)', background: 'rgba(0,0,0,0.25)', color: 'var(--paper)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' },
  error: { fontSize: '0.78rem', color: '#e18a8a', margin: 0 },
  actions: { display: 'flex', gap: 10, borderTop: '1px solid rgba(201,150,44,0.2)', paddingTop: 14 },
};
