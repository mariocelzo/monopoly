# Scambi su telefono e computer — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere componibile uno scambio su telefono e tablet con una procedura guidata in tre passi, rifare le due colonne del computer raggruppandole per gruppo di colore, e correggere il difetto che può piantare la partita a chi riceve una proposta.

**Architettura:** Due composer separati che condividono il calcolo ma non il layout. `propertyGroups.ts` è una funzione pura che risponde a «a chi manca cosa»; `TradeWizard.tsx` e `TradeModal.tsx` la disegnano ciascuno a modo proprio. `App.tsx` sceglie fra i due con `useIsTouchLayout()`. Nessuna regola di gioco cambia: restano tutte sul server.

**Tech Stack:** React 18 + TypeScript, stili inline come nel resto del progetto, nessuna dipendenza nuova. I test della logica pura girano sotto Node 22 con `--experimental-strip-types`, senza framework, nello stile di `server/smoke-test.js`.

---

## Struttura dei file

| File | Responsabilità |
| --- | --- |
| `client/src/propertyGroups.ts` (nuovo) | Raggruppa le proprietà di un giocatore per gruppo di colore, con quante su quante. Puro, zero import a runtime. |
| `client/logic-test.ts` (nuovo) | Asserzioni sulla logica pura del client. Fuori da `src`, quindi `tsc` non lo tocca. |
| `client/src/components/MoneyStepper.tsx` (nuovo) | Campo denaro con −/+ e scorciatoie. |
| `client/src/components/TradeWizard.tsx` (nuovo) | La procedura a tre passi. Telefono e tablet. |
| `client/src/components/TradeModal.tsx` (rifatto) | Le due colonne raggruppate per colore. Solo computer. |
| `client/src/components/TradeBoard.tsx` (modifica) | Distingue offerto da richiesto. |
| `client/src/components/TradeOfferModal.tsx` (modifica) | Il difetto bloccante. |
| `client/src/components/MobileBar.tsx` (modifica) | Scambio al posto di Registro. |
| `client/src/useIsMobile.ts` (modifica) | Aggiunge `useIsTouchLayout()`. |
| `client/src/App.tsx` (modifica) | Sceglie fra procedura guidata e due colonne. |
| `client/package.json` (modifica) | Aggiunge lo script `test`. |

`propertyGroups.ts` non deve avere **nessun import a runtime**, solo `import type`: è la condizione perché giri sotto node senza risolutori di moduli. Il raggruppamento inline che sta oggi in `PropertiesPanel.tsx:108-114` **non si tocca**: fa una cosa diversa (nessun conteggio) e funziona; unificarlo sarebbe rimaneggiamento non richiesto.

---

## Task 1: `propertyGroups.ts` e l'impalcatura dei test

**Files:**
- Create: `client/logic-test.ts`
- Create: `client/src/propertyGroups.ts`
- Modify: `client/package.json`

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `client/logic-test.ts`:

```typescript
// Test della logica pura del client. Nessun framework, come per smoke-test.js
// del server: si lancia con `npm test` dalla cartella client.
//
// Gira sotto node grazie a --experimental-strip-types. È il motivo per cui i
// moduli qui testati non devono avere import a runtime oltre ai tipi: node non
// saprebbe risolverli.
import { board } from '../server/src/data/board.js';
import { propertyGroups } from './src/propertyGroups.ts';
import type { BoardSquare, GameState } from './src/socket.ts';

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${description}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${description}${extra ? ` — ${extra}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const tabellone = board as BoardSquare[];

/** Assegna a un giocatore tutte le caselle indicate. */
function owning(positions: number[], playerId = 'io'): GameState['ownership'] {
  const ownership: GameState['ownership'] = {};
  for (const position of positions) {
    ownership[position] = { ownerId: playerId, houses: 0, hotel: false, mortgaged: false };
  }
  return ownership;
}

const posizioniDi = (predicato: (s: BoardSquare) => boolean) =>
  tabellone.filter(predicato).map((s) => s.position);

const ARANCIONI = posizioniDi((s) => s.group === 'orange');
const MARRONI = posizioniDi((s) => s.group === 'brown');
const STAZIONI = posizioniDi((s) => s.type === 'station');
const SOCIETA = posizioniDi((s) => s.type === 'utility');

// ---------------------------------------------------------------------------
section('1. Raggruppamento delle proprietà per gruppo di colore');
{
  check('chi non possiede nulla non ha gruppi',
    propertyGroups(tabellone, {}, 'io').length === 0);

  // Due arancioni su tre: è l'informazione che serve per trattare.
  const parziale = propertyGroups(tabellone, owning([ARANCIONI[0], ARANCIONI[1]]), 'io');
  check('un solo gruppo con due arancioni', parziale.length === 1, `gruppi=${parziale.length}`);
  check('la chiave del gruppo è il colore', parziale[0].key === 'orange');
  check('ne possiede due', parziale[0].owned === 2);
  check('in tutto sono tre', parziale[0].total === 3);
  check('il gruppo non è completo', parziale[0].complete === false);
  check('elenca le due caselle possedute', parziale[0].squares.length === 2);

  // I marroni sono due soli: possederli entrambi è monopolio.
  const completo = propertyGroups(tabellone, owning(MARRONI), 'io');
  check('due marroni fanno monopolio', completo[0].complete === true);
  check('due su due', completo[0].owned === 2 && completo[0].total === 2);

  // Stazioni e società non hanno un colore: si raggruppano per tipo.
  const stazioni = propertyGroups(tabellone, owning([STAZIONI[0], STAZIONI[1]]), 'io');
  check('le stazioni stanno sotto la chiave station', stazioni[0].key === 'station');
  check('le stazioni sul tabellone sono quattro', stazioni[0].total === 4);

  const societa = propertyGroups(tabellone, owning([SOCIETA[0]]), 'io');
  check('le società stanno sotto la chiave utility', societa[0].key === 'utility');
  check('le società sul tabellone sono due', societa[0].total === 2);

  // Le caselle di qualcun altro non compaiono fra le mie.
  const altrui = propertyGroups(tabellone, owning(ARANCIONI, 'altro'), 'io');
  check('le proprietà altrui non compaiono', altrui.length === 0);

  // L'ordine segue il giro del tabellone, non l'ordine di acquisto: i marroni
  // (casella 1) vengono prima degli arancioni (casella 16).
  const misti = propertyGroups(tabellone, owning([...ARANCIONI, ...MARRONI]), 'io');
  check('i gruppi seguono l\'ordine del tabellone',
    misti[0].key === 'brown' && misti[1].key === 'orange',
    misti.map((g) => g.key).join(','));

  // Una casella ipotecata resta di chi la possiede.
  const ipotecata: GameState['ownership'] = {
    [ARANCIONI[0]]: { ownerId: 'io', houses: 0, hotel: false, mortgaged: true },
  };
  const conIpoteca = propertyGroups(tabellone, ipotecata, 'io');
  check('le ipotecate contano comunque', conIpoteca[0].owned === 1);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Aggiungere lo script `test` a `client/package.json`**

Sostituire il blocco `"scripts"` con:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "node --experimental-strip-types logic-test.ts"
  },
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `cd client && npm test 2>&1 | grep -v Warning | head -5`
Expected: FAIL, `Cannot find module` su `./src/propertyGroups.ts`

- [ ] **Step 4: Implementare `propertyGroups.ts`**

Creare `client/src/propertyGroups.ts`:

```typescript
import type { BoardSquare, GameState } from './socket';

/** Un gruppo del tabellone visto dal lato di un giocatore. */
export interface PropertyGroup {
  /** 'orange', 'blue'… oppure 'station' / 'utility'. Chiave per GROUP_COLORS e GROUP_LABELS. */
  key: string;
  /** Le caselle del gruppo che il giocatore possiede, in ordine di tabellone. */
  squares: BoardSquare[];
  /** Quante ne possiede. */
  owned: number;
  /** Quante ne esistono in tutto sul tabellone. */
  total: number;
  /** Vero se le possiede tutte: è il monopolio. */
  complete: boolean;
}

/**
 * Le proprietà di un giocatore raggruppate per gruppo di colore, con quante ne
 * possiede su quante ne esistono. È l'informazione che conta quando si tratta:
 * non "cosa ha", ma "a chi manca cosa".
 *
 * Puro e senza import a runtime di proposito: così gira sia nel browser sia
 * sotto node per i test (`npm test` dentro client/).
 */
export function propertyGroups(
  board: BoardSquare[],
  ownership: GameState['ownership'],
  playerId: string
): PropertyGroup[] {
  // Quante caselle esistono per gruppo, e da quale posizione parte ciascuno:
  // l'ordine dei gruppi segue il giro del tabellone, non l'ordine d'acquisto.
  const totali = new Map<string, number>();
  const primaPosizione = new Map<string, number>();
  for (const square of board) {
    const key = groupKey(square);
    if (!key) continue;
    totali.set(key, (totali.get(key) || 0) + 1);
    if (!primaPosizione.has(key)) primaPosizione.set(key, square.position);
  }

  const mie = new Map<string, BoardSquare[]>();
  for (const square of board) {
    const key = groupKey(square);
    if (!key) continue;
    if (ownership[square.position]?.ownerId !== playerId) continue;
    if (!mie.has(key)) mie.set(key, []);
    mie.get(key)!.push(square);
  }

  return [...mie.entries()]
    .map(([key, squares]) => {
      const total = totali.get(key) ?? squares.length;
      return { key, squares, owned: squares.length, total, complete: squares.length === total };
    })
    .sort((a, b) => (primaPosizione.get(a.key) ?? 0) - (primaPosizione.get(b.key) ?? 0));
}

/** Chiave di raggruppamento: il colore, o il tipo per stazioni e società. */
function groupKey(square: BoardSquare): string | null {
  if (square.group) return square.group;
  if (square.type === 'station' || square.type === 'utility') return square.type;
  return null;
}
```

- [ ] **Step 5: Eseguire il test e verificare che passi**

Run: `cd client && npm test 2>&1 | grep -v Warning | tail -3`
Expected: `16 test superati, 0 falliti`

- [ ] **Step 6: Verificare che `tsc` ignori il file di test**

Run: `cd client && npx tsc --noEmit && echo "tsc pulito"`
Expected: `tsc pulito` — `tsconfig.json` ha `"include": ["src"]`, quindi `logic-test.ts` resta fuori

- [ ] **Step 7: Commit**

```bash
git add client/src/propertyGroups.ts client/logic-test.ts client/package.json
git commit -m "feat(client): raggruppamento delle proprietà per gruppo di colore"
```

---

## Task 2: Il difetto che pianta la partita

**Files:**
- Modify: `client/src/components/TradeOfferModal.tsx`

È il difetto più grave e sta in piedi da solo: si fa per primo, così vale anche
se il resto slitta.

- [ ] **Step 1: Riprodurre il difetto**

Avviare server e client:

```bash
cd server && node src/server.js &
cd client && npm run dev
```

Aprire `http://localhost:5173` in una finestra da 375×812, creare un tavolo,
aggiungere un bot, iniziare, e da console del browser mandarsi una proposta con
molte proprietà. Il modo rapido è ridurre l'altezza della finestra a 500px con
una proposta da tre o quattro proprietà per lato.

Expected: i bottoni *Accetta* e *Rifiuta* sono fuori dallo schermo e non si
raggiungono scorrendo.

- [ ] **Step 2: Correggere gli stili**

In `TradeOfferModal.tsx`, sostituire le tre righe di stile `overlay`, `card` e
`columns` con:

```typescript
  // Su schermi bassi la finestra deve stare dentro il viewport e scorrere al
  // suo interno: `alignItems: flex-start` evita che il contenuto più alto dello
  // schermo esca da sopra, dove non lo raggiunge nessuno scorrimento.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 25, padding: 20, overflowY: 'auto' },
  card: { padding: 28, width: 480, maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  // minHeight: 0 è indispensabile: senza, un figlio flex non si restringe sotto
  // il proprio contenuto e deborda in silenzio, che è la causa del difetto.
  columns: { display: 'flex', gap: 16, flexWrap: 'wrap', overflowY: 'auto', minHeight: 0 },
```

Nella stessa mappa di stili, sostituire `actions` con:

```typescript
  // flexShrink: 0 tiene i bottoni fuori dall'area che scorre: qualunque cosa ci
  // sia nel baratto, Accetta e Rifiuta restano raggiungibili.
  actions: { display: 'flex', gap: 10, flexShrink: 0 },
```

E dare ai bottoni un bersaglio da dito, sempre nella mappa di stili, aggiungendo
in fondo:

```typescript
  actionBtn: { flex: 1, minHeight: 46, fontSize: '0.95rem' },
```

Poi applicarlo ai due bottoni, sostituendo il blocco `isRecipient ? (...)`:

```tsx
        {isRecipient ? (
          <div style={styles.actions}>
            <button
              className="btn-primary"
              style={styles.actionBtn}
              onClick={() => socket.emit('respond_trade', { accept: true })}
            >
              Accetta
            </button>
            <button
              className="btn-ghost"
              style={styles.actionBtn}
              onClick={() => socket.emit('respond_trade', { accept: false })}
            >
              Rifiuta
            </button>
          </div>
        ) : (
          <p style={styles.wait}>{to?.name} sta decidendo...</p>
        )}
```

- [ ] **Step 3: Verificare che il difetto sia sparito**

Ripetere la prova dello Step 1 con la finestra alta 500px.
Expected: la finestra sta dentro lo schermo, l'elenco delle proprietà scorre al
suo interno, *Accetta* e *Rifiuta* restano sempre visibili in fondo.

- [ ] **Step 4: Controllare che nulla si sia rotto**

Run: `cd client && npx tsc --noEmit && npm run build 2>&1 | tail -2`
Expected: build completata senza errori

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TradeOfferModal.tsx
git commit -m "fix(client): la proposta ricevuta non manda più i bottoni fuori schermo"
```

---

## Task 3: `useIsTouchLayout()`

**Files:**
- Modify: `client/src/useIsMobile.ts`
- Modify: `client/logic-test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

In `client/logic-test.ts`, aggiungere l'import in cima, sotto gli altri:

```typescript
import { TOUCH_LAYOUT_QUERY } from './src/useIsMobile.ts';
```

E aggiungere questa sezione subito prima della riga
`console.log(\`\n${passed} test superati...\`)`:

```typescript
// ---------------------------------------------------------------------------
section('2. Soglia di assetto touch');
{
  // Un tablet in orizzontale è largo 1024 ma si usa col dito: deve prendere la
  // procedura guidata. Una finestra da 1024 su un computer, no.
  check('la soglia guarda la mancanza del passaggio del mouse',
    TOUCH_LAYOUT_QUERY.includes('hover: none'), TOUCH_LAYOUT_QUERY);
  check('la soglia comprende anche gli schermi stretti',
    TOUCH_LAYOUT_QUERY.includes('max-width: 780px'), TOUCH_LAYOUT_QUERY);
}
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd client && npm test 2>&1 | grep -v Warning | head -5`
Expected: FAIL, `does not provide an export named 'TOUCH_LAYOUT_QUERY'`

- [ ] **Step 3: Implementare**

In `client/src/useIsMobile.ts`, aggiungere in fondo al file:

```typescript
// Assetto da dito. Non è la stessa domanda di `useIsMobile`: quella decide
// come si dispone la pagina, questa se un comando si usa col pollice. Un tablet
// in orizzontale è largo 1024px ma resta touch, mentre una finestra da 1024px
// su un computer si usa col mouse — `hover: none` è ciò che li distingue.
export const TOUCH_LAYOUT_QUERY = `(hover: none), (max-width: ${MOBILE_BREAKPOINT}px)`;

/** Vero su telefoni e tablet, in qualunque orientamento. */
export function useIsTouchLayout(): boolean {
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(TOUCH_LAYOUT_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(TOUCH_LAYOUT_QUERY);
    const update = () => setIsTouch(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isTouch;
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd client && npm test 2>&1 | grep -v Warning | tail -3`
Expected: `18 test superati, 0 falliti`

- [ ] **Step 5: Commit**

```bash
git add client/src/useIsMobile.ts client/logic-test.ts
git commit -m "feat(client): soglia di assetto touch che comprende i tablet"
```

---

## Task 4: `MoneyStepper`

**Files:**
- Create: `client/src/components/MoneyStepper.tsx`

- [ ] **Step 1: Scrivere il componente**

Creare `client/src/components/MoneyStepper.tsx`:

```tsx
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
```

- [ ] **Step 2: Verificare che compili**

Run: `cd client && npx tsc --noEmit && echo "tsc pulito"`
Expected: `tsc pulito`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MoneyStepper.tsx
git commit -m "feat(client): campo denaro con tasti e scorciatoie al posto del numerico"
```

---

## Task 5: La mappa distingue offerto da richiesto

**Files:**
- Modify: `client/src/components/TradeBoard.tsx`

- [ ] **Step 1: Cambiare le proprietà del componente**

In `TradeBoard.tsx`, sostituire la firma e il commento in cima con:

```tsx
/**
 * Mappa in miniatura del tabellone, per capire a colpo d'occhio com'è divisa la
 * proprietà prima di comporre uno scambio. Le caselle sono tinte del colore di
 * chi le possiede; quelle nello scambio portano un anello, di colore diverso a
 * seconda del verso — ottone per quello che esce, avorio per quello che entra.
 *
 * Serve a guardare, non a selezionare: a questa dimensione una casella è troppo
 * stretta per il pollice, quindi la scelta resta agli elenchi.
 */
export default function TradeBoard({
  board,
  state,
  myId,
  otherId,
  offered,
  requested,
}: {
  board: BoardSquare[];
  state: GameState;
  myId: string;
  otherId: string;
  /** Caselle tue che stai offrendo: escono da te. */
  offered: number[];
  /** Caselle sue che stai chiedendo: entrano da lui. */
  requested: number[];
}) {
```

- [ ] **Step 2: Usare i due elenchi nel disegno della casella**

Sostituire la riga `const isSelected = selected.includes(square.position);` con:

```tsx
        const inUscita = offered.includes(square.position);
        const inEntrata = requested.includes(square.position);
```

E sostituire la riga `outline: isSelected ? '2px solid var(--brass-2)' : undefined,` con:

```tsx
              // Due colori invece di due tratteggi: a venti pixel un bordo
              // tratteggiato non si distingue da uno pieno.
              outline: inUscita
                ? '2px solid var(--brass-2)'
                : inEntrata
                  ? '2px solid var(--paper)'
                  : undefined,
```

- [ ] **Step 3: Aggiornare la legenda**

Sostituire l'intero blocco `<div style={styles.legend}>…</div>` con:

```tsx
      <div style={styles.legend}>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: `${colorOf(myId)}55`, borderColor: colorOf(myId) }} />
          tue
        </div>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: `${colorOf(otherId)}55`, borderColor: colorOf(otherId) }} />
          sue
        </div>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: 'transparent', borderColor: 'var(--brass-2)' }} />
          offri
        </div>
        <div style={styles.legendRow}>
          <span style={{ ...styles.chip, background: 'transparent', borderColor: 'var(--paper)' }} />
          chiedi
        </div>
      </div>
```

- [ ] **Step 4: Aggiornare la chiamata in `TradeModal.tsx`**

In `TradeModal.tsx`, sostituire:

```tsx
        <TradeBoard
          board={board}
          state={state}
          myId={myId}
          otherId={other.id}
          selected={[...offerProperties, ...requestProperties]}
        />
```

con:

```tsx
        <TradeBoard
          board={board}
          state={state}
          myId={myId}
          otherId={other.id}
          offered={offerProperties}
          requested={requestProperties}
        />
```

- [ ] **Step 5: Verificare che compili**

Run: `cd client && npx tsc --noEmit && echo "tsc pulito"`
Expected: `tsc pulito`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TradeBoard.tsx client/src/components/TradeModal.tsx
git commit -m "feat(client): la mappa dello scambio distingue quello che esce da quello che entra"
```

---

## Task 6: La procedura guidata a tre passi

**Files:**
- Create: `client/src/components/TradeWizard.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Scrivere il componente**

Creare `client/src/components/TradeWizard.tsx`:

```tsx
import { useState } from 'react';
import { BoardSquare, GameState, socket } from '../socket';
import { GROUP_COLORS, GROUP_LABELS } from '../groupColors';
import { propertyGroups } from '../propertyGroups';
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
  destBtn: { minHeight: 42, fontSize: '0.82rem', padding: '0 13px' },
  // minHeight: 0 è indispensabile perché un figlio flex si restringa e scorra
  // invece di debordare in silenzio.
  corpo: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 },
  gruppo: { display: 'flex', flexDirection: 'column', gap: 5 },
  gruppoTesta: { display: 'flex', alignItems: 'center', gap: 8 },
  chip: { width: 14, height: 14, borderRadius: 3, border: '1px solid rgba(0,0,0,0.35)', flexShrink: 0 },
  gruppoNome: { fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  completo: { fontSize: '0.62rem', color: 'var(--brass-2)', border: '1px solid var(--brass)', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto' },
  parziale: { fontSize: '0.66rem', color: 'rgba(243,234,216,0.45)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' },
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
  btn: { flex: 1, minHeight: 48, fontSize: '0.95rem' },
};
```

- [ ] **Step 2: Agganciarlo in `App.tsx`**

In `App.tsx`, cambiare l'import di `useIsMobile` (riga con
`import { useIsMobile }`) in:

```tsx
import { useIsMobile, useIsTouchLayout } from './useIsMobile';
```

Aggiungere l'import del nuovo componente sotto quello di `TradeModal`:

```tsx
import TradeWizard from './components/TradeWizard';
```

Sotto la riga `const isMobile = useIsMobile();` aggiungere:

```tsx
  // Domanda diversa da isMobile: non "come si dispone la pagina" ma "questo
  // comando si usa col pollice". Un tablet in orizzontale è largo ma resta
  // touch, e per comporre uno scambio conta quello.
  const isTouch = useIsTouchLayout();
```

E sostituire il blocco `{composingTrade && !pending && (…)}` con:

```tsx
      {composingTrade && !pending && (
        isTouch ? (
          <TradeWizard
            board={board}
            state={state}
            myId={playerId}
            onClose={() => setComposingTrade(false)}
          />
        ) : (
          <TradeModal
            board={board}
            state={state}
            myId={playerId}
            onClose={() => setComposingTrade(false)}
          />
        )
      )}
```

- [ ] **Step 3: Verificare che compili**

Run: `cd client && npx tsc --noEmit && echo "tsc pulito"`
Expected: `tsc pulito`

- [ ] **Step 4: Provare nel browser a 375px**

Avviare server e client, aprire a 375×812, creare un tavolo con un bot,
iniziare, giocare qualche turno finché entrambi hanno proprietà, poi aprire
lo scambio dal foglio delle proprietà.

Expected:
- il passo 1 mostra le proprietà del bot raggruppate per colore, col «2 di 3»;
- scorre una cosa sola, e si arriva in fondo al campo del denaro;
- *Avanti* porta al passo 2 con le proprie proprietà;
- il passo 3 mostra il patto e *Manda la proposta* lo invia.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TradeWizard.tsx client/src/App.tsx
git commit -m "feat(client): procedura guidata a tre passi per gli scambi su telefono e tablet"
```

---

## Task 7: Le due colonne del computer, raggruppate per colore

**Files:**
- Modify: `client/src/components/TradeModal.tsx`

- [ ] **Step 1: Sostituire gli import e l'elenco delle proprietà**

In `TradeModal.tsx`, sostituire il blocco di import in cima con:

```tsx
import { useState } from 'react';
import { BoardSquare, GameState, socket } from '../socket';
import { GROUP_COLORS, GROUP_LABELS } from '../groupColors';
import { propertyGroups } from '../propertyGroups';
import MoneyStepper from './MoneyStepper';
import TradeBoard from './TradeBoard';
```

Sostituire i quattro stati del denaro e delle carte, cioè le righe da
`const [offerMoney, setOfferMoney] = useState('0');` a
`const [requestJailCards, setRequestJailCards] = useState('0');`, con:

```tsx
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerJailCards, setOfferJailCards] = useState(0);
  const [requestJailCards, setRequestJailCards] = useState(0);
```

Sostituire la funzione `ownedBy` e la funzione `propertyList` per intero con:

```tsx
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
```

Sostituire `cambiaDestinatario` con la versione che azzera i numeri, non le
stringhe:

```tsx
  const cambiaDestinatario = (id: string) => {
    setToId(id);
    // Le richieste erano rivolte a un altro giocatore: si azzerano.
    setRequestProperties([]);
    setRequestMoney(0);
    setRequestJailCards(0);
    setError(null);
  };
```

Sostituire il corpo di `send` con la versione senza conversioni:

```tsx
  const send = () => {
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
```

- [ ] **Step 2: Rifare la disposizione, con la mappa in mezzo e il patto in fondo**

Sostituire il blocco che va da `<TradeBoard` fino alla chiusura di
`<div style={styles.columns}>` (cioè `TradeBoard` più le due colonne) con:

```tsx
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
```

Aggiungere la funzione `descrivi` subito sopra il `return` del componente,
accanto alle altre funzioni interne:

```tsx
  /** Un lato del baratto in una riga sola, per il riepilogo del patto. */
  const descrivi = (positions: number[], money: number, jailCards: number) => {
    const pezzi = positions.map(
      (position) => board.find((s) => s.position === position)?.name || `Casella ${position}`
    );
    if (money > 0) pezzi.push(`€${money}`);
    if (jailCards > 0) pezzi.push(`${jailCards} carta uscita`);
    return pezzi.length > 0 ? pezzi.join(' + ') : 'niente';
  };
```

- [ ] **Step 3: Aggiornare gli stili**

Sostituire le righe di stile `card`, `columns`, `column`, `list` e `item` con:

```typescript
  card: { padding: 26, width: 900, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 12 },
  // minHeight: 0 è indispensabile: senza, un figlio flex non si restringe sotto
  // il proprio contenuto e deborda invece di scorrere.
  columns: { display: 'flex', gap: 16, alignItems: 'flex-start', overflowY: 'auto', minHeight: 0, flex: 1 },
  column: { flex: '1 1 250px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  mapColumn: { flex: '0 0 190px', position: 'sticky', top: 0 },
  columnTitle: { fontSize: '0.8rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.6)' },
  list: { display: 'flex', flexDirection: 'column', gap: 9 },
  item: { display: 'flex', alignItems: 'center', gap: 9, minHeight: 38, padding: '5px 9px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer' },
```

E aggiungere in fondo alla mappa di stili:

```typescript
  gruppo: { display: 'flex', flexDirection: 'column', gap: 4 },
  gruppoTesta: { display: 'flex', alignItems: 'center', gap: 7 },
  chip: { width: 13, height: 13, borderRadius: 3, border: '1px solid rgba(0,0,0,0.35)', flexShrink: 0 },
  gruppoNome: { fontSize: '0.68rem', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(243,234,216,0.58)' },
  completo: { fontSize: '0.6rem', color: 'var(--brass-2)', border: '1px solid var(--brass)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' },
  parziale: { fontSize: '0.64rem', color: 'rgba(243,234,216,0.42)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' },
  patto: { borderTop: '1px solid rgba(201,150,44,0.2)', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 },
  pattoLabel: { fontFamily: 'var(--font-mono)', fontSize: '0.64rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--brass-2)' },
  pattoRiga: { display: 'flex', alignItems: 'center', gap: 12 },
  pattoLato: { flex: 1, fontSize: '0.85rem', padding: '8px 11px', borderRadius: 8, background: 'rgba(0,0,0,0.24)' },
  pattoFreccia: { fontSize: '1.1rem', color: 'var(--brass)' },
```

Infine, rendere i bottoni finali immuni allo scorrimento sostituendo `actions`:

```typescript
  actions: { display: 'flex', gap: 10, borderTop: '1px solid rgba(201,150,44,0.2)', paddingTop: 14, flexShrink: 0 },
```

- [ ] **Step 4: Verificare che compili**

Run: `cd client && npx tsc --noEmit && npm run build 2>&1 | tail -2`
Expected: build completata senza errori

- [ ] **Step 5: Provare nel browser a 1400px**

Aprire una partita con proprietà distribuite e comporre uno scambio.
Expected: tre colonne (le tue, la mappa, le sue), proprietà raggruppate col
«completo» / «2 di 3», la mappa che segna in ottone quello che offri e in avorio
quello che chiedi, e la riga del patto che si aggiorna a ogni spunta.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TradeModal.tsx
git commit -m "feat(client): scambio da computer raggruppato per colore, con mappa in mezzo e riepilogo del patto"
```

---

## Task 8: Il tasto Scambio nella barra

**Files:**
- Modify: `client/src/components/MobileBar.tsx`

- [ ] **Step 1: Sostituire la scheda Registro con Scambio**

In `MobileBar.tsx`, sostituire il blocco `<div style={styles.tabs}>…</div>` con:

```tsx
        <div style={styles.tabs}>
          <button className="btn-ghost" style={styles.tab} onClick={() => setSheet('proprieta')}>
            🏠 Proprietà
          </button>
          {/* Lo scambio sale di livello: prima era sepolto dentro il foglio
              delle proprietà. Il registro non si perde, ha la sua scheda lì
              dentro. Prima del via resta visibile ma spento, così la barra non
              cambia forma quando la partita comincia. */}
          <button
            className="btn-ghost"
            style={styles.tab}
            disabled={!state.started || state.finished || blocked}
            onClick={onProposeTrade}
          >
            🤝 Scambio
          </button>
        </div>
```

- [ ] **Step 2: Togliere il tasto ormai doppio dentro il foglio**

Sostituire il ramo `sheet === 'proprieta'` con la sola tabella delle proprietà,
cioè sostituire:

```tsx
              {sheet === 'proprieta' ? (
                <>
                  <PropertiesPanel board={board} state={state} myId={myId} />
                  <button
                    className="btn-ghost"
                    style={styles.tradeBtn}
                    disabled={blocked || state.finished}
                    onClick={() => {
                      setSheet(null);
                      onProposeTrade();
                    }}
                  >
                    Proponi scambio
                  </button>
                </>
              ) : (
```

con:

```tsx
              {sheet === 'proprieta' ? (
                <PropertiesPanel board={board} state={state} myId={myId} />
              ) : (
```

- [ ] **Step 3: Togliere lo stile rimasto senza padrone**

Nella mappa di stili, togliere la riga:

```typescript
  tradeBtn: { minHeight: 44, fontSize: '0.9rem' },
```

- [ ] **Step 4: Verificare che compili senza avanzi**

Run: `cd client && npx tsc --noEmit && npm run build 2>&1 | tail -2`
Expected: build completata senza errori

- [ ] **Step 5: Provare nel browser a 375px**

Expected:
- in fondo ci sono due schede: 🏠 Proprietà e 🤝 Scambio;
- prima del via la scheda Scambio è visibile ma spenta;
- a partita iniziata apre la procedura guidata;
- il registro si raggiunge da Proprietà → scheda Registro;
- con un'azione in sospeso la scheda Scambio è spenta.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/MobileBar.tsx
git commit -m "feat(client): lo scambio prende il posto del registro fra le schede in basso"
```

---

## Task 9: Verifica alle quattro larghezze e documentazione

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Provare a 375px — telefono**

Comporre uno scambio completo a due sensi: proprietà da entrambi i lati più
denaro, e mandarlo.
Expected: procedura guidata, un solo scorrimento, proposta inviata.

- [ ] **Step 2: Provare a 768px — tablet verticale**

Comporre di nuovo uno scambio a due sensi con proprietà e denaro, e mandarlo.
Expected: si apre la procedura guidata (non le colonne), i tre passi entrano
nello schermo, la proposta parte.

- [ ] **Step 3: Provare a 1024px con `hover: none` — tablet orizzontale**

Nel browser, emulare un dispositivo touch (in Chrome: DevTools → Toggle device
toolbar → un tablet da 1024px), oppure verificare la media query da console:

```javascript
matchMedia('(hover: none), (max-width: 780px)').matches
```

Expected: `true` sul tablet emulato, e lo scambio apre la procedura guidata.

- [ ] **Step 4: Provare a 1400px — computer**

Expected: le tre colonne, e `matchMedia` della riga sopra vale `false`.

- [ ] **Step 5: Riprovare il difetto della proposta ricevuta**

Con la finestra alta 500px, farsi mandare una proposta con tre o quattro
proprietà per lato.
Expected: la finestra sta dentro lo schermo, l'elenco scorre, *Accetta* e
*Rifiuta* restano raggiungibili.

- [ ] **Step 6: Eseguire tutti i test**

Run: `cd client && npm test 2>&1 | grep -v Warning | tail -2 && npx tsc --noEmit && npm run build 2>&1 | tail -2 && cd ../server && node smoke-test.js | tail -1`
Expected: `18 test superati, 0 falliti`, build completata, `246 test superati, 0 falliti`

- [ ] **Step 7: Aggiornare il README**

Nella sezione `## Test`, sostituire il blocco di comandi e il paragrafo che
segue con:

```markdown
```bash
cd server && node smoke-test.js
```

Va eseguito prima e dopo ogni modifica sostanziale a `gameEngine.js`. La suite
include una partita simulata di 300 turni e i bot usano la casualità, quindi
conviene lanciarla più volte.

Il client ha le sue asserzioni sulla logica pura, senza framework, che girano
sotto Node grazie allo strip dei tipi:

```bash
cd client && npm test
```
```

Nella sezione `## Struttura`, sostituire le tre righe

```
client/
  src/
    socket.ts          Connessione e tipi condivisi
```

con

```
client/
  logic-test.ts        Asserzioni sulla logica pura del client
  src/
    socket.ts          Connessione e tipi condivisi
    propertyGroups.ts  Proprietà raggruppate per colore, con quante su quante
```

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: gli scambi rifatti e i test della logica del client"
```

---

## Note per chi esegue

- **Nessuna regola di gioco cambia.** Il server valida ogni scambio come prima;
  qui si tocca solo il modo di comporre l'intento. Se una prova nel browser dà
  un errore di validazione, è il server che fa il suo mestiere, non un difetto.
- **`propertyGroups.ts` non deve acquisire import a runtime.** Solo
  `import type`. Se qualcuno ci aggiunge un `import { GROUP_COLORS }`, `npm test`
  smette di funzionare perché node non risolve l'estensione mancante.
- **`minHeight: 0` compare tre volte** (Task 2, 6, 7) e non è una svista: in un
  contenitore flex un figlio non si restringe sotto il proprio contenuto se non
  glielo si dice, e deborda in silenzio. È la causa tecnica del problema che
  tutto questo lavoro corregge.
