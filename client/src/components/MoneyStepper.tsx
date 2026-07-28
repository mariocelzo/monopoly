/**
 * Campo denaro pensato per il pollice: due tasti −/+ e le scorciatoie, invece
 * del campo numerico che su telefono apre la tastiera e si mangia mezzo schermo
 * proprio mentre stai guardando l'elenco delle proprietà. Il valore resta
 * digitabile per chi vuole una cifra precisa.
 *
 * Il limite qui è solo un aiuto immediato: quello vero lo mette il server.
 */
export default function MoneyStepper({
  label,
  value,
  max,
  onChange,
  step = 10,
  quick = [50, 100, 200],
  unit = '€',
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  /** Di quanto si muovono i tasti −/+. Per le carte uscita vale 1. */
  step?: number;
  /** Scorciatoie sotto il campo. Elenco vuoto = nessuna scorciatoia. */
  quick?: number[];
  /** Simbolo davanti alla cifra. Vuoto per contare cose che non sono soldi. */
  unit?: string;
}) {
  const limita = (n: number) => Math.max(0, Math.min(max, Math.floor(n) || 0));
  const passa = (delta: number) => onChange(limita(value + delta));

  return (
    <div style={styles.wrap}>
      <div style={styles.top}>
        <span style={styles.label}>{label}</span>
        <span className="mono" style={styles.max}>max {unit}{max}</span>
      </div>

      <div style={styles.row}>
        <button
          className="btn-ghost"
          style={styles.pm}
          disabled={value <= 0}
          onClick={() => passa(-step)}
          aria-label={`Togli ${step}`}
        >
          −
        </button>
        <input
          style={styles.field}
          inputMode="numeric"
          value={String(value)}
          onChange={(e) => onChange(limita(Number(e.target.value.replace(/\D/g, ''))))}
        />
        <button
          className="btn-ghost"
          style={styles.pm}
          disabled={value >= max}
          onClick={() => passa(step)}
          aria-label={`Aggiungi ${step}`}
        >
          +
        </button>
      </div>

      {/* Le scorciatoie hanno senso per il denaro, non per contare due carte. */}
      {quick.length > 0 && (
        <div style={styles.quick}>
          {quick.map((importo) => (
            <button
              key={importo}
              className="btn-ghost"
              style={styles.quickBtn}
              disabled={value + importo > max}
              onClick={() => passa(importo)}
            >
              +{importo}
            </button>
          ))}
          <button
            className="btn-ghost"
            style={styles.quickBtn}
            disabled={value === 0}
            onClick={() => onChange(0)}
          >
            azzera
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 7 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: '0.74rem', color: 'rgba(243,234,216,0.62)' },
  max: { fontSize: '0.7rem', color: 'rgba(243,234,216,0.4)' },
  row: { display: 'flex', gap: 7, alignItems: 'stretch' },
  // 46px: sopra il minimo raccomandato per un bersaglio da toccare.
  pm: { minWidth: 52, minHeight: 46, fontSize: '1.2rem', padding: 0 },
  field: {
    flex: 1,
    minHeight: 46,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(201,150,44,0.3)',
    background: 'rgba(0,0,0,0.25)',
    color: 'var(--paper)',
    fontFamily: 'var(--font-mono)',
    fontSize: '1rem',
    textAlign: 'center',
    width: '100%',
  },
  quick: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  quickBtn: { flex: 1, minWidth: 62, minHeight: 38, fontSize: '0.78rem', padding: '0 8px' },
};
