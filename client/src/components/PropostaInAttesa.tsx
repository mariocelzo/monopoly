import { BoardSquare, GameState, TradeOffer } from '../socket';
import BottoneAzione from './BottoneAzione';
import { TOUCH_TARGET } from '../touchTarget';
import { LAYER } from '../layers';

/**
 * La proposta che ho fatto io e che sto aspettando mi venga risposta.
 *
 * PERCHÉ NON È UNA FINESTRA. Prima chi proponeva vedeva lo stesso modale del
 * destinatario, con scritto "in attesa di X", e andava benissimo: la proposta
 * congelava il tavolo, quindi non c'era comunque niente che potesse fare. Ora
 * che il gioco prosegue, un velo a tutto schermo sarebbe la cosa peggiore
 * possibile — gli impedirebbe di tirare i dadi, costruire e ipotecare proprio
 * mentre il motore glielo permette. Avremmo tolto il blocco dal motore per
 * rimetterlo nell'interfaccia, che per chi gioca è esattamente la stessa cosa.
 *
 * Quindi: una striscia stretta, in alto, che non copre il tabellone e non
 * intercetta i tocchi fuori da sé. Dice due cose e basta — chi sta decidendo, e
 * come tirarsi indietro.
 *
 * IL BOTTONE "RITIRA" NON È UN DI PIÙ. Finché la proposta bloccava tutti,
 * l'altro doveva rispondere subito o nessuno giocava; adesso può prendersela
 * comoda, e nel frattempo la merce promessa resta congelata (vedi
 * tradeGoodsBlocker in gameEngine.js). Senza una via d'uscita, dimenticarsi di
 * rispondere — o staccare il telefono — diventerebbe un modo per tenere
 * bloccate le proprietà di un avversario a tempo indeterminato.
 */
export default function PropostaInAttesa({
  offerta,
  board,
  state,
  sottoBanner,
}: {
  offerta: TradeOffer;
  board: BoardSquare[];
  state: GameState;
  /** Vero quando la barra rossa della connessione persa occupa già l'angolo. */
  sottoBanner?: boolean;
}) {
  const to = state.players.find((p) => p.id === offerta.toId);

  /** I nomi delle caselle promesse, per ricordare cos'è che resta congelato. */
  const promesse = offerta.offerProperties
    .map((position) => board.find((s) => s.position === position)?.name)
    .filter(Boolean);

  return (
    <div style={{ ...styles.striscia, ...(sottoBanner ? styles.sottoBanner : null) }}>
      <div style={styles.testo}>
        <span style={styles.titolo}>In attesa di {to?.name}</span>
        {/* Perché certe cose non si possono toccare: senza questa riga, il
            rifiuto "è in gioco in uno scambio" che arriva provando a ipotecare
            sembrerebbe uscito dal nulla. */}
        {promesse.length > 0 && (
          <span style={styles.dettaglio}>
            {promesse.join(', ')} {promesse.length === 1 ? 'resta bloccata' : 'restano bloccate'} finché non risponde
          </span>
        )}
      </div>
      <BottoneAzione
        evento="cancel_trade"
        payload={{ tradeId: offerta.id }}
        className="btn-ghost"
        style={styles.ritira}
      >
        Ritira
      </BottoneAzione>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // `position: fixed` con `left/right: auto` sui lati: la striscia è larga
  // quanto il suo contenuto e centrata, così non fa da barriera invisibile
  // sopra il tabellone. Niente scrim, niente `inset: 0`: è la differenza fra
  // un promemoria e una gabbia.
  striscia: {
    position: 'fixed',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: LAYER.propostaInAttesa,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    maxWidth: 'calc(100vw - 16px)',
    padding: '8px 10px 8px 14px',
    borderRadius: 999,
    background: 'rgba(12,49,37,0.94)',
    border: '1px solid rgba(201,150,44,0.4)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(6px)',
  },
  // Come per AvvisoAzione: la barra della connessione persa spinge in basso
  // invece di accavallarsi.
  sottoBanner: { top: 44 },
  testo: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 },
  titolo: { fontSize: '0.82rem', color: 'var(--paper)' },
  dettaglio: {
    fontSize: '0.68rem',
    color: 'rgba(243,234,216,0.55)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ritira: { minHeight: TOUCH_TARGET, padding: '0 14px', fontSize: '0.8rem', flexShrink: 0 },
};
