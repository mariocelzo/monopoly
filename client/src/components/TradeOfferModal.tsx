import { BoardSquare, GameState, TradeOffer } from '../socket';
import BottoneAzione from './BottoneAzione';
import { GROUP_COLORS } from '../groupColors';
import { TOUCH_TARGET } from '../touchTarget';
import { LAYER } from '../layers';

/**
 * Offerta di scambio RICEVUTA: i due lati del baratto, Accetta e Rifiuta.
 *
 * Adesso la monta solo il destinatario. Prima serviva anche a chi aveva
 * proposto, per mostrargli "in attesa di X", e aveva senso: la proposta
 * congelava il tavolo, quindi il proponente non aveva comunque niente da fare
 * se non guardare. Da quando il gioco va avanti, quella stessa finestra
 * diventerebbe una gabbia — un velo a tutto schermo che gli impedisce di tirare
 * i dadi mentre l'altro decide, cioè il difetto di partenza rifatto in
 * interfaccia dopo averlo tolto dal motore. Chi propone vede una striscia che
 * non copre niente (vedi PropostaInAttesa.tsx).
 *
 * `restanti` è quante altre offerte aspettano dietro questa: verso lo stesso
 * giocatore adesso possono essercene più d'una, e si risponde una alla volta.
 */
export default function TradeOfferModal({
  offerta,
  restanti = 0,
  board,
  state,
}: {
  offerta: TradeOffer;
  restanti?: number;
  board: BoardSquare[];
  state: GameState;
}) {
  const pending = offerta;
  const from = state.players.find((p) => p.id === pending.fromId);
  const to = state.players.find((p) => p.id === pending.toId);

  /** Un lato del baratto: le proprietà più l'eventuale denaro. */
  const side = (title: string, positions: number[], money: number, jailCards: number) => (
    <div style={styles.side}>
      <h3 style={styles.sideTitle}>{title}</h3>
      {positions.length === 0 && money === 0 && jailCards === 0 && <p style={styles.none}>niente</p>}
      {positions.map((position) => {
        const square = board.find((s) => s.position === position);
        const owned = state.ownership[position];
        return (
          <div key={position} style={styles.row}>
            <span
              style={{
                ...styles.dot,
                background: square?.group ? GROUP_COLORS[square.group] : 'var(--brass)',
              }}
            />
            <span style={styles.rowName}>{square?.name || `Casella ${position}`}</span>
            {owned?.mortgaged && <span style={styles.mortgaged}>ipot.</span>}
          </div>
        );
      })}
      {money > 0 && <div className="mono" style={styles.money}>€{money}</div>}
      {jailCards > 0 && (
        <div style={styles.cards}>
          🔑 {jailCards} {jailCards === 1 ? 'carta uscita' : 'carte uscita'}
        </div>
      )}
    </div>
  );

  return (
    <div className="scrim" style={styles.overlay}>
      <div className="panel" style={styles.card}>
        <span style={styles.eyebrow}>
          scambio proposto{restanti > 0 ? ` · ne restano altre ${restanti}` : ''}
        </span>
        <h2 style={styles.title}>{from?.name} ti propone</h2>

        <div style={styles.columns}>
          {side(`${from?.name} dà`, pending.offerProperties, pending.offerMoney, pending.offerJailCards)}
          {side(`${to?.name} dà`, pending.requestProperties, pending.requestMoney, pending.requestJailCards)}
        </div>

        <div style={styles.actions}>
          {/* Accettare può fallire per davvero, e non per colpa di chi preme:
              fra la proposta e la risposta il proponente può aver speso i
              contanti promessi o ipotecato una casella. Adesso può capitare
              molto più spesso di prima — il tavolo non è più fermo, quindi fra
              i due momenti si gioca davvero — e il motore in quel caso non si
              limita a rifiutare: toglie di mezzo la proposta e scrive nel
              registro perché. Il rifiuto arriva comunque a schermo passando da
              `inviaAzione` (vedi azioni.ts), che è il motivo per cui questi
              bottoni non fanno `socket.emit` da soli.

              `tradeId` è obbligatorio: di offerte aperte verso di me ce ne
              possono essere più d'una, e un "accetta" senza indirizzo
              prenderebbe quella sbagliata. */}
          <BottoneAzione
            evento="respond_trade"
            payload={{ accept: true, tradeId: pending.id }}
            style={styles.actionBtn}
          >
            Accetta
          </BottoneAzione>
          <BottoneAzione
            evento="respond_trade"
            payload={{ accept: false, tradeId: pending.id }}
            className="btn-ghost"
            style={styles.actionBtn}
          >
            Rifiuta
          </BottoneAzione>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Su schermi bassi la finestra deve stare dentro il viewport e scorrere al
  // suo interno: `alignItems: flex-start` evita che il contenuto più alto dello
  // schermo esca da sopra, dove non lo raggiunge nessuno scorrimento.
  // L'`overflowY` qui sotto sembra ridondante col `maxHeight` della card, e non
  // lo è: non toglierlo. È la rete di sicurezza per i casi in cui nemmeno
  // comprimendo l'elenco il contenuto fisso ci sta — viewport bassissimi, nomi
  // lunghi che vanno a capo — e per i browser mobile dove 100vh non coincide
  // con l'area davvero visibile.
  // `offertaScambio` e non più `decisione`: un'offerta si può rimandare senza
  // fermare nessuno, un affitto o un'asta no. Vedi il perché in layers.ts.
  overlay: { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: LAYER.offertaScambio, padding: 20, overflowY: 'auto' },
  // `margin: auto` centra la finestra quando c'è spazio e collassa quando non
  // ce n'è, lasciando che sia `alignItems: flex-start` a tenerla attaccata in
  // alto invece di farla uscire da sopra.
  card: { padding: 28, width: 480, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  title: { fontSize: '1.4rem' },
  // minHeight: 0 è indispensabile: senza, un figlio flex non si restringe sotto
  // il proprio contenuto e deborda in silenzio, che è la causa del difetto.
  columns: { display: 'flex', gap: 16, flexWrap: 'wrap', overflowY: 'auto', minHeight: 0 },
  side: { flex: '1 1 190px', display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(201,150,44,0.15)' },
  sideTitle: { fontSize: '0.74rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  none: { fontSize: '0.78rem', color: 'rgba(243,234,216,0.4)', fontStyle: 'italic', margin: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 7 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0, border: '1px solid rgba(0,0,0,0.35)' },
  rowName: { fontSize: '0.8rem', flex: 1 },
  mortgaged: { fontSize: '0.62rem', color: '#e18a8a', fontFamily: 'var(--font-mono)' },
  money: { fontSize: '1rem', color: 'var(--brass-2)', marginTop: 4 },
  cards: { fontSize: '0.78rem', color: 'var(--paper)', marginTop: 2 },
  // flexShrink: 0 tiene i bottoni fuori dall'area che scorre: qualunque cosa ci
  // sia nel baratto, Accetta e Rifiuta restano raggiungibili.
  actions: { display: 'flex', gap: 10, flexShrink: 0 },
  wait: { color: 'rgba(243,234,216,0.6)', fontSize: '0.85rem', margin: 0 },
  actionBtn: { flex: 1, minHeight: TOUCH_TARGET, fontSize: '0.95rem' },
};
