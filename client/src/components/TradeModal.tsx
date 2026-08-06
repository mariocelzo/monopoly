import { useState } from 'react';
import { BoardSquare, GameState, inviaAzione } from '../socket';
import { azzeraRifiuto } from '../azioni';
import { useAttesaVisibile, useAzioneInVolo } from '../azioniInVolo';
import { motivoScambioBloccato } from '../scambi';
import { GROUP_COLORS, GROUP_LABELS } from '../groupColors';
import { propertyGroups } from '../propertyGroups';
import MoneyStepper from './MoneyStepper';
import TradeBoard from './TradeBoard';
import { LAYER } from '../layers';

/**
 * Composizione di una proposta di scambio: si spuntano le proprietà da offrire e
 * quelle da chiedere, si aggiunge del denaro da una parte o dall'altra e si
 * manda. Come per il resto, il client si limita a raccogliere l'intento: ogni
 * regola (edifici sul colore, denaro disponibile) la applica il server.
 *
 * App.tsx tiene questo componente montato anche quando nel frattempo si apre
 * un `pendingAction` altrui (l'affitto di un bot, per esempio): prima si
 * smontava e tutto quello che si era composto andava perso. Per questo il
 * bottone "Manda la proposta" si disabilita da solo, invece che far sparire il
 * componente intero.
 *
 * Quando si disabilita è cambiato, ed è cambiato in meglio: non più a ogni
 * `pendingAction`, ma solo quando il motore rifiuterebbe davvero — debito o
 * asta in corso, o una propria proposta già aperta. La regola sta in scambi.ts,
 * scritta una volta sola. Con un acquisto o un affitto altrui in sospeso adesso
 * si manda eccome: la trattativa non ferma nessuno e nessuno ferma lei.
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
  // Con più di due al tavolo bisogna poter scegliere con chi trattare:
  // prima si agganciava al primo avversario e gli altri erano irraggiungibili.
  const avversari = state.players.filter((p) => p.id !== myId && !p.bankrupt);
  const [toId, setToId] = useState<string | null>(avversari[0]?.id ?? null);
  const other = avversari.find((p) => p.id === toId) ?? avversari[0];

  const [offerProperties, setOfferProperties] = useState<number[]>([]);
  const [requestProperties, setRequestProperties] = useState<number[]>([]);
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerJailCards, setOfferJailCards] = useState(0);
  const [requestJailCards, setRequestJailCards] = useState(0);

  if (!other || !me) {
    return null;
  }

  // Toccare l'offerta cancella il rifiuto ancora a schermo: parlava della
  // proposta di prima, e lasciarlo lì mentre si sta già cambiando le carte in
  // tavola vorrebbe dire far leggere un motivo che non vale più.
  const cambiaDestinatario = (id: string) => {
    setToId(id);
    // Le richieste erano rivolte a un altro giocatore: si azzerano.
    setRequestProperties([]);
    setRequestMoney(0);
    setRequestJailCards(0);
    azzeraRifiuto();
  };

  const toggle = (list: number[], setList: (v: number[]) => void, position: number) => {
    azzeraRifiuto();
    setList(list.includes(position) ? list.filter((p) => p !== position) : [...list, position]);
  };

  // Il compositore si chiude SOLO se la proposta è partita davvero: chiuderlo
  // comunque butterebbe via un'offerta appena composta per un rifiuto che
  // magari si correggeva con un ritocco.
  // La proposta in viaggio verso il server: finché non torna, il comando che
  // l'ha mandata resta spento (vedi azioniInVolo.ts).
  const inVolo = useAzioneInVolo('propose_trade');
  const attesa = useAttesaVisibile(inVolo);
  // Perché l'invio è fermo, se lo è: la regola sta in scambi.ts, in un posto
  // solo, perché non è più il semplice "c'è un pendingAction" di prima.
  const bloccato = motivoScambioBloccato(state, myId);

  const send = () => {
    inviaAzione(
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
      { alSuccesso: onClose }
    );
  };

  /** Elenco spuntabile delle proprietà di un giocatore, raggruppate per colore. */
  const propertyList = (playerId: string, selected: number[], setSelected: (v: number[]) => void) => {
    const gruppi = propertyGroups(board, state.ownership, playerId);
    if (gruppi.length === 0) return <p style={styles.none}>nessuna proprietà</p>;

    return gruppi.map((gruppo) => (
      <div key={gruppo.key} style={styles.gruppo}>
        <div style={styles.gruppoTesta}>
          <span style={{ ...styles.chip, background: GROUP_COLORS[gruppo.key] || 'var(--brass)' }} />
          <span style={styles.gruppoNome}>{GROUP_LABELS[gruppo.key] || gruppo.key}</span>
          {/* "completo" o "2 di 3": l'unica cosa che conta davvero quando si
              tratta è a chi manca cosa. */}
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
                ...styles.item,
                borderColor: isOn ? 'var(--brass)' : 'transparent',
                background: isOn ? 'rgba(201,150,44,0.14)' : 'rgba(0,0,0,0.18)',
              }}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => toggle(selected, setSelected, square.position)}
              />
              <span style={styles.itemName}>{square.name}</span>
              {owned?.mortgaged && <span style={styles.mortgaged}>ipot.</span>}
            </label>
          );
        })}
      </div>
    ));
  };

  /** Un lato del baratto in una riga sola, per il riepilogo del patto. */
  const descrivi = (positions: number[], money: number, jailCards: number) => {
    const pezzi = positions.map(
      (position) => board.find((s) => s.position === position)?.name || `Casella ${position}`
    );
    if (money > 0) pezzi.push(`€${money}`);
    if (jailCards > 0) pezzi.push(`${jailCards} carta uscita`);
    return pezzi.length > 0 ? pezzi.join(' + ') : 'niente';
  };

  return (
    <div className="scrim" style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>proposta di scambio</span>
        <h2 style={styles.title}>Tu ↔ {other.name}</h2>

        {avversari.length > 1 && (
          <div style={styles.destinatari}>
            <span style={styles.destLabel}>Con chi:</span>
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

        <div style={styles.columns}>
          <div style={styles.column}>
            <h3 style={styles.columnTitle}>Offri tu · €{me.balance}</h3>
            <div style={styles.list}>{propertyList(myId, offerProperties, setOfferProperties)}</div>
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
          </div>

          {/* La mappa sta in mezzo ai due: è il posto dove si guarda mentre si
              confronta una colonna con l'altra. */}
          <div style={styles.mapColumn}>
            <TradeBoard
              board={board}
              state={state}
              myId={myId}
              otherId={other.id}
              offered={offerProperties}
              requested={requestProperties}
            />
          </div>

          <div style={styles.column}>
            <h3 style={styles.columnTitle}>Chiedi a {other.name} · €{other.balance}</h3>
            <div style={styles.list}>
              {propertyList(other.id, requestProperties, setRequestProperties)}
            </div>
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
          </div>
        </div>

        {/* Il patto, aggiornato mentre si sceglie e non solo dopo aver mandato. */}
        <div style={styles.patto}>
          <span style={styles.pattoLabel}>Il patto</span>
          <div style={styles.pattoRiga}>
            <span style={styles.pattoLato}>{descrivi(offerProperties, offerMoney, offerJailCards)}</span>
            <span style={styles.pattoFreccia}>⇄</span>
            <span style={styles.pattoLato}>{descrivi(requestProperties, requestMoney, requestJailCards)}</span>
          </div>
        </div>

        {/* Un'altra azione in sospeso (l'affitto di un bot, un'asta, un
            debito...) fa rifiutare la proposta dal server comunque: non ha
            senso far credere che si possa mandare. Prima questo si traduceva
            nello smontare tutto il compositore, buttando via ciò che si era
            già scelto — ora si resta montati e si spiega perché il bottone è
            spento, così si può continuare a comporre e mandare non appena si
            libera. */}
        {bloccato && (
          <p style={styles.pendingNote}>
            {bloccato} Si può continuare a comporre: l'invio si riattiva da sé.
          </p>
        )}

        <div style={styles.actions}>
          {/* Non passa da BottoneAzione perché il patto da mandare si legge
              da otto stati locali al momento del clic; l'attesa però si
              racconta allo stesso identico modo, con le stesse classi. Mandare
              due volte la stessa proposta è un guaio vero: la seconda si
              prende un rifiuto ("C'è già uno scambio in sospeso") su un patto
              che era invece appena partito. */}
          <button
            className={['btn-primary', inVolo && 'comando-in-volo', attesa && 'comando-in-attesa']
              .filter(Boolean)
              .join(' ')}
            onClick={send}
            aria-busy={inVolo || undefined}
            disabled={!!bloccato || inVolo}
            title={bloccato ?? undefined}
          >
            Manda la proposta
          </button>
          <button className="btn-ghost" onClick={onClose}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: LAYER.compositoreScambio, padding: 20 },
  card: { padding: 26, width: 900, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 12 },
  destinatari: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' },
  destLabel: { fontSize: '0.76rem', color: 'rgba(243,234,216,0.6)' },
  destBtn: { minHeight: 38, fontSize: '0.8rem', padding: '0 12px' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.4rem' },
  // minHeight: 0 è indispensabile: senza, un figlio flex non si restringe sotto
  // il proprio contenuto e deborda invece di scorrere.
  columns: { display: 'flex', gap: 16, alignItems: 'flex-start', overflowY: 'auto', minHeight: 0, flex: 1 },
  column: { flex: '1 1 250px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  mapColumn: { flex: '0 0 190px', position: 'sticky', top: 0 },
  columnTitle: { fontSize: '0.8rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  list: { display: 'flex', flexDirection: 'column', gap: 9 },
  none: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.45)', fontStyle: 'italic', margin: 0 },
  item: { display: 'flex', alignItems: 'center', gap: 9, minHeight: 38, padding: '5px 9px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer' },
  itemName: { fontSize: '0.78rem', flex: 1 },
  mortgaged: { fontSize: '0.62rem', color: '#e18a8a', fontFamily: 'var(--font-mono)' },
  pendingNote: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.6)', fontStyle: 'italic', margin: 0 },
  gruppo: { display: 'flex', flexDirection: 'column', gap: 4 },
  gruppoTesta: { display: 'flex', alignItems: 'center', gap: 7 },
  chip: { width: 13, height: 13, borderRadius: 3, border: '1px solid rgba(0,0,0,0.35)', flexShrink: 0 },
  gruppoNome: { fontSize: '0.68rem', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.58)' },
  completo: { fontSize: '0.6rem', color: 'var(--brass-2)', border: '1px solid var(--brass)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' },
  parziale: { fontSize: '0.64rem', color: 'rgba(243,234,216,0.42)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' },
  // Il patto, aggiornato mentre si sceglie: fuori dallo scorrimento come i bottoni.
  patto: { borderTop: '1px solid rgba(201,150,44,0.2)', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 },
  pattoLabel: { fontFamily: 'var(--font-mono)', fontSize: '0.64rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  pattoRiga: { display: 'flex', alignItems: 'center', gap: 12 },
  pattoLato: { flex: 1, fontSize: '0.85rem', padding: '8px 11px', borderRadius: 8, background: 'rgba(0,0,0,0.24)' },
  pattoFreccia: { fontSize: '1.1rem', color: 'var(--brass)' },
  actions: { display: 'flex', gap: 10, borderTop: '1px solid rgba(201,150,44,0.2)', paddingTop: 14, flexShrink: 0 },
};
