import { useState } from 'react';
import { BoardSquare, GameState, socket } from '../socket';
import { GROUP_COLORS, GROUP_LABELS } from '../groupColors';
import { propertyGroups } from '../propertyGroups';
import { TOUCH_TARGET } from '../touchTarget';
import MoneyStepper from './MoneyStepper';

/**
 * Composizione di uno scambio su telefono e tablet, una domanda per schermata:
 * cosa vuoi da lui, cosa gli dai, riepilogo.
 *
 * La ragione della procedura guidata è di spazio. La schermata a due colonne
 * del computer, su 375px, finiva per chiudere 682px di contenuto dentro una
 * finestrella di 148px, con altri due scorrimenti annidati dentro: la colonna
 * delle richieste e i campi del denaro erano di fatto irraggiungibili. Qui
 * l'intestazione è ferma, i bottoni sono fermi, e in mezzo scorre una cosa
 * sola.
 *
 * Come sempre il client raccoglie solo l'intento: ogni regola la applica il
 * server, e l'errore che torna dall'ack viene mostrato in fondo.
 */
export default function TradeWizard({
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
  const avversari = state.players.filter((p) => p.id !== myId && !p.bankrupt);

  const [toId, setToId] = useState<string | null>(avversari[0]?.id ?? null);
  const other = avversari.find((p) => p.id === toId) ?? avversari[0];

  const [passo, setPasso] = useState(1);
  const [offerProperties, setOfferProperties] = useState<number[]>([]);
  const [requestProperties, setRequestProperties] = useState<number[]>([]);
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerJailCards, setOfferJailCards] = useState(0);
  const [requestJailCards, setRequestJailCards] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!other || !me) return null;

  const cambiaDestinatario = (id: string) => {
    setToId(id);
    // Le richieste erano rivolte a un altro giocatore: si azzerano.
    setRequestProperties([]);
    setRequestMoney(0);
    setRequestJailCards(0);
    setError(null);
  };

  const toggle = (list: number[], setList: (v: number[]) => void, position: number) => {
    setError(null);
    setList(list.includes(position) ? list.filter((p) => p !== position) : [...list, position]);
  };

  const manda = () => {
    setError(null);
    socket.emit(
      'propose_trade',
      {
        toId: other.id,
        offerProperties,
        requestProperties,
        offerMoney,
        requestMoney,
        offerJailCards,
        requestJailCards,
      },
      (res: { error?: string }) => {
        if (res?.error) setError(res.error);
        else onClose();
      }
    );
  };

  /** Elenco spuntabile delle proprietà di un giocatore, raggruppate per colore. */
  const elenco = (playerId: string, selected: number[], setSelected: (v: number[]) => void) => {
    const gruppi = propertyGroups(board, state.ownership, playerId);
    if (gruppi.length === 0) {
      return <p style={styles.vuoto}>Nessuna proprietà da mettere sul piatto.</p>;
    }
    return gruppi.map((gruppo) => (
      <div key={gruppo.key} style={styles.gruppo}>
        <div style={styles.gruppoTesta}>
          <span
            style={{ ...styles.chip, background: GROUP_COLORS[gruppo.key] || 'var(--brass)' }}
          />
          <span style={styles.gruppoNome}>{GROUP_LABELS[gruppo.key] || gruppo.key}</span>
          <span style={gruppo.complete ? styles.completo : styles.parziale}>
            {gruppo.complete ? 'completo' : `${gruppo.owned} di ${gruppo.total}`}
          </span>
        </div>

        {gruppo.squares.map((square) => {
          const owned = state.ownership[square.position];
          const isOn = selected.includes(square.position);
          return (
            <label
              key={square.position}
              style={{
                ...styles.riga,
                borderColor: isOn ? 'var(--brass)' : 'transparent',
                background: isOn ? 'rgba(201,150,44,0.14)' : 'rgba(0,0,0,0.18)',
              }}
            >
              <input
                type="checkbox"
                style={styles.check}
                checked={isOn}
                onChange={() => toggle(selected, setSelected, square.position)}
              />
              <span style={styles.rigaNome}>{square.name}</span>
              {owned?.mortgaged && <span style={styles.ipotecata}>ipotecata</span>}
            </label>
          );
        })}
      </div>
    ));
  };

  /** Un lato del baratto, per il riepilogo finale. */
  const riepilogo = (
    titolo: string,
    positions: number[],
    money: number,
    jailCards: number
  ) => (
    <div style={styles.lato}>
      <h3 style={styles.latoTitolo}>{titolo}</h3>
      {positions.length === 0 && money === 0 && jailCards === 0 && (
        <p style={styles.vuoto}>niente</p>
      )}
      {positions.map((position) => {
        const square = board.find((s) => s.position === position);
        return (
          <div key={position} style={styles.riepRiga}>
            <span
              style={{
                ...styles.pallino,
                background: square?.group ? GROUP_COLORS[square.group] : 'var(--brass)',
              }}
            />
            {square?.name || `Casella ${position}`}
          </div>
        );
      })}
      {money > 0 && <div className="mono" style={styles.riepDenaro}>€{money}</div>}
      {jailCards > 0 && (
        <div style={styles.riepRiga}>🔑 {jailCards} {jailCards === 1 ? 'carta uscita' : 'carte uscita'}</div>
      )}
    </div>
  );

  const titoli = ['Cosa vuoi da lui?', 'Cosa gli dai in cambio?', 'Ecco il patto'];
  const vuotoDaEntrambiILati =
    offerProperties.length + requestProperties.length === 0 &&
    offerMoney + requestMoney + offerJailCards + requestJailCards === 0;

  return (
    <div style={styles.overlay}>
      <div className="panel" style={styles.foglio}>
        <div style={styles.testa}>
          <div style={styles.testaRiga}>
            <span style={styles.eyebrow}>passo {passo} di 3</span>
            <button style={styles.chiudi} onClick={onClose} aria-label="Chiudi">✕</button>
          </div>
          <h2 style={styles.titolo}>{titoli[passo - 1]}</h2>

          {passo === 1 && avversari.length > 1 && (
            <div style={styles.destinatari}>
              {avversari.map((p) => (
                <button
                  key={p.id}
                  className={p.id === other.id ? 'btn-primary' : 'btn-ghost'}
                  style={styles.destBtn}
                  onClick={() => cambiaDestinatario(p.id)}
                >
                  {p.token} {p.name}
                </button>
              ))}
            </div>
          )}
          {passo !== 1 && (
            <p style={styles.conChi}>con {other.token} {other.name}</p>
          )}
        </div>

        {/* L'unico contenitore che scorre di tutta la schermata. */}
        <div style={styles.corpo}>
          {passo === 1 && (
            <>
              {elenco(other.id, requestProperties, setRequestProperties)}
              <MoneyStepper
                label={`Denaro che chiedi a ${other.name}`}
                value={requestMoney}
                max={other.balance}
                onChange={setRequestMoney}
              />
              {other.jailCards > 0 && (
                <MoneyStepper
                  label={`Carte uscita che chiedi (ne ha ${other.jailCards})`}
                  value={requestJailCards}
                  max={other.jailCards}
                  onChange={setRequestJailCards}
                  step={1}
                  quick={[]}
                  unit=""
                />
              )}
            </>
          )}

          {passo === 2 && (
            <>
              {elenco(myId, offerProperties, setOfferProperties)}
              <MoneyStepper
                label="Denaro che offri"
                value={offerMoney}
                max={me.balance}
                onChange={setOfferMoney}
              />
              {me.jailCards > 0 && (
                <MoneyStepper
                  label={`Carte uscita che offri (ne hai ${me.jailCards})`}
                  value={offerJailCards}
                  max={me.jailCards}
                  onChange={setOfferJailCards}
                  step={1}
                  quick={[]}
                  unit=""
                />
              )}
            </>
          )}

          {passo === 3 && (
            <>
              {riepilogo('Tu dai', offerProperties, offerMoney, offerJailCards)}
              <div style={styles.freccia}>⇅</div>
              {riepilogo(`${other.name} dà`, requestProperties, requestMoney, requestJailCards)}
              {vuotoDaEntrambiILati && (
                <p style={styles.avviso}>
                  Non hai messo niente da nessuna delle due parti: torna indietro e scegli qualcosa.
                </p>
              )}
            </>
          )}

          {error && <p style={styles.errore}>{error}</p>}
        </div>

        <div style={styles.piede}>
          <div style={styles.puntini}>
            {[1, 2, 3].map((n) => (
              <span key={n} style={{ ...styles.puntino, ...(n === passo ? styles.puntinoAttivo : null) }} />
            ))}
          </div>
          <div style={styles.bottoni}>
            <button
              className="btn-ghost"
              style={styles.btn}
              onClick={() => (passo === 1 ? onClose() : setPasso(passo - 1))}
            >
              {passo === 1 ? 'Annulla' : 'Indietro'}
            </button>
            {passo < 3 ? (
              <button className="btn-primary" style={styles.btn} onClick={() => setPasso(passo + 1)}>
                Avanti →
              </button>
            ) : (
              <button
                className="btn-primary"
                style={styles.btn}
                disabled={vuotoDaEntrambiILati}
                onClick={manda}
              >
                Manda la proposta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.62)',
    zIndex: 25,
    display: 'flex',
    alignItems: 'flex-end',
  },
  // Il foglio occupa quasi tutta l'altezza e si divide in tre fasce: testa
  // ferma, corpo che scorre, piede fermo.
  foglio: {
    width: '100%',
    height: '94vh',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
    padding: 0,
    overflow: 'hidden',
  },
  testa: {
    padding: '14px 16px 10px',
    borderBottom: '1px solid rgba(201,150,44,0.22)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },
  testaRiga: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  chiudi: { background: 'none', border: 'none', color: 'rgba(243,234,216,0.55)', fontSize: '1.15rem', cursor: 'pointer', minWidth: 44, minHeight: 44, padding: 0 },
  titolo: { fontSize: '1.3rem' },
  conChi: { fontSize: '0.82rem', color: 'rgba(243,234,216,0.6)', margin: 0 },
  destinatari: { display: 'flex', gap: 7, flexWrap: 'wrap' },
  destBtn: { minHeight: TOUCH_TARGET, fontSize: '0.82rem', padding: '0 13px' },
  // minHeight: 0 è indispensabile perché un figlio flex si restringa e scorra
  // invece di debordare in silenzio.
  corpo: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 },
  gruppo: { display: 'flex', flexDirection: 'column', gap: 5 },
  gruppoTesta: { display: 'flex', alignItems: 'center', gap: 8 },
  chip: { width: 14, height: 14, borderRadius: 3, border: '1px solid rgba(0,0,0,0.35)', flexShrink: 0 },
  gruppoNome: { fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  completo: { fontSize: '0.62rem', color: 'var(--brass-2)', border: '1px solid var(--brass)', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto' },
  parziale: { fontSize: '0.66rem', color: 'rgba(243,234,216,0.45)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' },
  // Volutamente più alta di TOUCH_TARGET: è il bersaglio toccato più spesso di
  // tutta la schermata (ogni proprietà da spuntare), quindi conviene tenerla
  // comoda anche oltre il minimo.
  riga: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '6px 11px', borderRadius: 8, border: '1px solid transparent', cursor: 'pointer' },
  check: { width: 20, height: 20, flexShrink: 0, accentColor: 'var(--brass)' },
  rigaNome: { fontSize: '0.88rem', flex: 1 },
  ipotecata: { fontSize: '0.64rem', color: '#e18a8a', fontFamily: 'var(--font-mono)' },
  vuoto: { fontSize: '0.82rem', color: 'rgba(243,234,216,0.45)', fontStyle: 'italic', margin: 0 },
  lato: { display: 'flex', flexDirection: 'column', gap: 6, padding: 13, borderRadius: 10, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(201,150,44,0.16)' },
  latoTitolo: { fontSize: '0.74rem', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  riepRiga: { display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' },
  pallino: { width: 11, height: 11, borderRadius: 3, flexShrink: 0, border: '1px solid rgba(0,0,0,0.35)' },
  riepDenaro: { fontSize: '1.05rem', color: 'var(--brass-2)', marginTop: 3 },
  freccia: { textAlign: 'center', fontSize: '1.3rem', color: 'var(--brass)' },
  avviso: { fontSize: '0.8rem', color: 'rgba(243,234,216,0.6)', margin: 0, fontStyle: 'italic' },
  errore: { fontSize: '0.82rem', color: '#e18a8a', margin: 0 },
  piede: {
    padding: '10px 16px calc(12px + env(safe-area-inset-bottom))',
    borderTop: '1px solid rgba(201,150,44,0.22)',
    background: 'rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
    flexShrink: 0,
  },
  puntini: { display: 'flex', gap: 6, justifyContent: 'center' },
  puntino: { width: 7, height: 7, borderRadius: '50%', background: 'rgba(243,234,216,0.25)' },
  puntinoAttivo: { background: 'var(--brass)' },
  bottoni: { display: 'flex', gap: 9 },
  // I tre comandi principali del foglio (Indietro/Avanti/Manda): usano
  // TOUCH_TARGET come ogni altro comando primario, non un numero per conto suo.
  btn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
};
