import { useState } from 'react';
import { GameState, HouseRules as HouseRulesType, inviaAzione } from '../socket';
import { useAzioneInVolo } from '../azioniInVolo';
import { TOUCH_TARGET } from '../touchTarget';

// Opzioni mostrate per le due regole a scelta multipla. Devono restare
// allineate a GO_AMOUNT_OPTIONS / STARTING_BALANCE_OPTIONS in
// server/src/gameEngine.js: è il server a validare per davvero, questo
// elenco serve solo a disegnare i comandi giusti.
const GO_AMOUNT_OPTIONS: HouseRulesType['goAmount'][] = [200, 500];
const STARTING_BALANCE_OPTIONS: HouseRulesType['startingBalance'][] = [1000, 1500, 2000];

/**
 * Regole della casa scelte per questo tavolo, prima del via: quanto paga il
 * Via, se il montepremi della Sosta Gratuita è acceso, se la proprietà
 * rifiutata va all'asta, e il saldo di partenza.
 *
 * Tutti seduti al tavolo le vedono — chi si siede a una partita deve sapere a
 * che regole gioca — ma solo chi ha creato il tavolo può cambiarle: il
 * server rifiuta comunque ogni tentativo altrui o fatto a partita iniziata
 * (vedi GameEngine.setRules), questo componente si limita a non dare i
 * comandi a chi non può usarli, per non promettere un cambio che poi il
 * server rifiuterebbe.
 *
 * `compact` disegna un blocco richiudibile, di default chiuso, invece delle
 * righe sempre aperte: su telefono (vedi MobileBar.tsx) lo spazio sopra il
 * tabellone è già conteso dal codice tavolo, dal link d'invito e dai bot.
 */
export default function HouseRules({
  state,
  myId,
  compact = false,
}: {
  state: GameState;
  myId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isHost = state.hostId === myId;
  const rules = state.rules;

  /**
   * Invia il cambiamento al server. Chi non è l'host non ha nemmeno il comando
   * cliccabile; il rifiuto (partita già iniziata, valore non ammesso) finisce
   * nell'avviso comune come ogni altra azione — su telefono queste righe
   * vivono dentro un blocco richiudibile in fondo allo schermo, dove un
   * messaggio in coda alla lista si sarebbe letto solo scorrendo.
   */
  const set = (changes: Partial<HouseRulesType>) => {
    if (!isHost) return;
    inviaAzione('set_rules', changes);
  };

  // Queste pastiglie mostrano la regola che il SERVER ha registrato, non quella
  // appena scelta: fra il tocco e il cambio di colore passa il giro di rete, e
  // in quei 250ms non succedeva niente — l'errore tipico era premere due o tre
  // volte credendo di aver sbagliato mira, mandando altrettanti cambi. Finché
  // la risposta è in viaggio le pastiglie si spengono tutte: sono la stessa
  // impostazione vista da più bottoni, e spegnerne una sola lascerebbe le
  // altre a raccogliere clic sullo stesso valore ancora da confermare.
  const regoleInVolo = useAzioneInVolo('set_rules');

  const riepilogo = `Via ${rules.goAmount} · Montepremi ${rules.freeParkingEnabled ? 'acceso' : 'spento'} · Asta ${rules.auctionEnabled ? 'accesa' : 'spenta'} · Saldo ${rules.startingBalance} · Grattacieli ${rules.skyscraperEnabled ? 'accesi' : 'spenti'}`;

  const corpo = (
    <div style={styles.rows}>
      <RigaRegola label="Il Via paga">
        {GO_AMOUNT_OPTIONS.map((valore) => (
          <Pillola
            key={valore}
            active={rules.goAmount === valore}
            disabled={!isHost || regoleInVolo}
            onClick={() => set({ goAmount: valore })}
          >
            {valore}
          </Pillola>
        ))}
      </RigaRegola>

      <RigaRegola label="Saldo iniziale">
        {STARTING_BALANCE_OPTIONS.map((valore) => (
          <Pillola
            key={valore}
            active={rules.startingBalance === valore}
            disabled={!isHost || regoleInVolo}
            onClick={() => set({ startingBalance: valore })}
          >
            {valore}
          </Pillola>
        ))}
      </RigaRegola>

      <RigaRegola label="Montepremi Sosta Gratuita">
        <Pillola active={rules.freeParkingEnabled} disabled={!isHost || regoleInVolo} onClick={() => set({ freeParkingEnabled: true })}>
          Acceso
        </Pillola>
        <Pillola active={!rules.freeParkingEnabled} disabled={!isHost || regoleInVolo} onClick={() => set({ freeParkingEnabled: false })}>
          Spento
        </Pillola>
      </RigaRegola>

      <RigaRegola label="Asta sulla proprietà rifiutata">
        <Pillola active={rules.auctionEnabled} disabled={!isHost || regoleInVolo} onClick={() => set({ auctionEnabled: true })}>
          Accesa
        </Pillola>
        <Pillola active={!rules.auctionEnabled} disabled={!isHost || regoleInVolo} onClick={() => set({ auctionEnabled: false })}>
          Spenta
        </Pillola>
      </RigaRegola>

      {/* Fino a quattro hotel per proprietà invece di uno solo, a prezzi e
          affitti crescenti (vedi gameEngine.js, buildHouse/calculateRent):
          serve a dare ancora qualcosa da costruire dopo il primo hotel, che
          altrimenti chiude ogni decisione a metà partita. */}
      <RigaRegola label="Modalità grattacieli (fino a 4 hotel)">
        <Pillola active={rules.skyscraperEnabled} disabled={!isHost || regoleInVolo} onClick={() => set({ skyscraperEnabled: true })}>
          Accesa
        </Pillola>
        <Pillola active={!rules.skyscraperEnabled} disabled={!isHost || regoleInVolo} onClick={() => set({ skyscraperEnabled: false })}>
          Spenta
        </Pillola>
      </RigaRegola>

      {!isHost && <p style={styles.hint}>Solo chi ha creato il tavolo può cambiarle.</p>}
    </div>
  );

  if (!compact) {
    return (
      <div style={styles.wrap}>
        <h4 style={styles.title}>Regole della casa</h4>
        {corpo}
      </div>
    );
  }

  return (
    <div style={styles.wrapCompact}>
      <button
        type="button"
        className="btn-ghost"
        style={styles.toggle}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.toggleLabel}>⚙️ Regole della casa</span>
        {!open && <span style={styles.toggleSummary}>{riepilogo}</span>}
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={styles.compactBody}>{corpo}</div>}
    </div>
  );
}

function RigaRegola({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <div style={styles.rowOptions}>{children}</div>
    </div>
  );
}

function Pillola({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn-mini"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles.pill,
        ...(active ? styles.pillActive : null),
        // Da disabilitata (chi non è l'host) la scelta corrente deve restare
        // ben leggibile: .btn-mini:disabled la spegnerebbe come tutte le
        // altre, ma qui non è "non disponibile", è "quella scelta". Lo style
        // inline vince sempre sulla regola CSS, senza bisogno di !important.
        ...(disabled && active ? { opacity: 1 } : null),
      }}
    >
      {children}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { paddingTop: 12, borderTop: '1px solid rgba(27,36,48,0.12)' },
  title: { fontSize: '0.95rem', marginBottom: 10, color: 'var(--ink)' },
  rows: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', flexDirection: 'column', gap: 4 },
  rowLabel: { fontSize: '0.72rem', color: 'rgba(27,36,48,0.6)' },
  rowOptions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  pill: { minWidth: 44 },
  pillActive: { borderColor: 'var(--brass)', color: 'var(--brass)', background: 'rgba(201,150,44,0.15)' },
  hint: { fontSize: '0.68rem', color: 'rgba(27,36,48,0.45)', fontStyle: 'italic', margin: 0 },

  // Variante richiudibile per il poco spazio su telefono: chiusa mostra solo
  // un riepilogo su una riga, aperta espone gli stessi comandi di sopra.
  wrapCompact: { display: 'flex', flexDirection: 'column' },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: TOUCH_TARGET,
    fontSize: '0.78rem',
    padding: '0 12px',
    justifyContent: 'flex-start',
  },
  toggleLabel: { flexShrink: 0 },
  toggleSummary: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'rgba(27,36,48,0.5)',
    fontSize: '0.7rem',
    textAlign: 'left',
  },
  compactBody: {
    marginTop: 8,
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(27,36,48,0.04)',
    border: '1px solid rgba(27,36,48,0.15)',
  },
};
