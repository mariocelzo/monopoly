// Test della logica pura del client. Nessun framework, come per smoke-test.js
// del server: si lancia con `npm test` dalla cartella client.
//
// Gira sotto node grazie a --experimental-strip-types, senza il bundler di
// Vite. Perciò ogni modulo importato qui deve rispettare due condizioni: node
// deve saperlo risolvere con la risoluzione standard (niente alias, CSS o
// altri asset che solo Vite capisce), e deve essere innocuo al caricamento —
// niente `window`/`document` toccati a livello di modulo. `react` va bene: è
// un pacchetto vero in node_modules e non fa nulla all'import; è l'uso di
// `window` dentro `useIsMobile.ts` a essere circondato da un controllo lazy.
import { board } from '../server/src/data/board.js';
import { propertyGroups } from './src/propertyGroups.ts';
import type { BoardSquare, GameState } from './src/socket.ts';
import { MOBILE_BREAKPOINT, TOUCH_LAYOUT_QUERY } from './src/useIsMobile.ts';
import { latestLogAt, missedSince } from './src/awayRecap.ts';
import { capTickerQueue, TICKER_ENTRY_LIFETIME_MS, TICKER_MAX_VISIBLE, visibleTickerEntries } from './src/eventTicker.ts';
import type { TickerItem } from './src/eventTicker.ts';
import { formatDuration, mostVisitedSquare, statFor } from './src/gameSummary.ts';

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
section('2. Soglia di assetto touch');
{
  // Un tablet in orizzontale è largo 1024 ma si usa col dito: deve prendere la
  // procedura guidata. Una finestra da 1024 su un computer, no.
  check('la soglia guarda la mancanza del passaggio del mouse',
    TOUCH_LAYOUT_QUERY.includes('hover: none'), TOUCH_LAYOUT_QUERY);
  check('la soglia comprende anche gli schermi stretti',
    TOUCH_LAYOUT_QUERY.includes(`max-width: ${MOBILE_BREAKPOINT}px`), TOUCH_LAYOUT_QUERY);
}

// ---------------------------------------------------------------------------
section('3. Riepilogo del registro durante una disconnessione');
{
  const registro: GameState['log'] = [
    { message: 'Mario tira 3 e 4', at: 100 },
    { message: 'Mario paga affitto a Luigi', at: 200 },
    { message: 'Luigi tira 5 e 1', at: 300 },
  ];

  // Senza un segnalibro precedente (primo ingresso al tavolo) non c'è nulla
  // da riepilogare, anche se il registro non è vuoto.
  check('nessun segnalibro precedente: niente da riepilogare',
    missedSince(registro, null).length === 0);

  // Il segnalibro coincide con l'ultima riga vista: non è successo nulla di
  // nuovo, quindi il riquadro non deve comparire.
  check('nulla di nuovo dopo l\'ultima riga vista',
    missedSince(registro, 300).length === 0);

  // Solo le righe più recenti del segnalibro sono "successe mentre non c'ero".
  const perse = missedSince(registro, 100);
  check('solo le righe successive al segnalibro',
    perse.length === 2 && perse[0].at === 200 && perse[1].at === 300,
    JSON.stringify(perse));

  // Un segnalibro più avanzato dell'intero registro (caso limite) non deve
  // far esplodere nulla: semplicemente non c'è niente da mostrare.
  check('segnalibro oltre l\'ultima riga: nessun errore, lista vuota',
    missedSince(registro, 9999).length === 0);

  // Le righe di sola connessione (le logga il motore a ogni caduta di rete e
  // a ogni rientro) sono rumore per il riepilogo: da sole non devono farlo
  // comparire, altrimenti scatterebbe a ogni riconnessione anche quando in
  // partita non cambia nulla.
  const soloConnessione: GameState['log'] = [
    { message: 'Mario si è disconnesso.', at: 150 },
    { message: 'Mario è tornato.', at: 250 },
  ];
  check('le sole notifiche di connessione non contano come "successo qualcosa"',
    missedSince(soloConnessione, 100).length === 0);

  // Ma se nel frattempo è successo anche altro, quello resta nel riepilogo:
  // si scartano solo le righe di connessione, non l'intera finestra.
  const misto: GameState['log'] = [
    { message: 'Mario si è disconnesso.', at: 150 },
    { message: 'Bot Aurelio compra Corso Magellano per 220.', at: 180 },
    { message: 'Mario è tornato.', at: 250 },
  ];
  const soloReale = missedSince(misto, 100);
  check('tra rumore e contenuto reale, resta solo il contenuto reale',
    soloReale.length === 1 && soloReale[0].message.includes('Corso Magellano'),
    JSON.stringify(soloReale));

  // latestLogAt tiene il punto più avanzato tra quanto già noto e il nuovo
  // registro: non deve mai regredire.
  check('latestLogAt prende il massimo del registro',
    latestLogAt(registro, null) === 300);
  check('latestLogAt non regredisce rispetto al segnalibro esistente',
    latestLogAt([], 500) === 500);
  check('latestLogAt avanza se il registro porta un punto più recente',
    latestLogAt(registro, 150) === 300);
}

// ---------------------------------------------------------------------------
section('4. Striscia degli eventi: quali voci restano in coda e per quanto');
{
  const voce = (id: number, shownAt: number): TickerItem => ({ id, message: `voce ${id}`, shownAt });

  // Appena mostrata, resta visibile.
  check('una voce appena mostrata è ancora visibile',
    visibleTickerEntries([voce(1, 1000)], 1000).length === 1);

  // Poco prima della scadenza, ancora visibile.
  const pocoPrima = visibleTickerEntries([voce(1, 1000)], 1000 + TICKER_ENTRY_LIFETIME_MS - 1);
  check('un istante prima della scadenza è ancora visibile', pocoPrima.length === 1);

  // Esattamente alla scadenza (confine incluso: `now - shownAt` uguale alla
  // durata) non è più visibile: la finestra è aperta a destra.
  const allaScadenza = visibleTickerEntries([voce(1, 1000)], 1000 + TICKER_ENTRY_LIFETIME_MS);
  check('esattamente alla scadenza non è più visibile', allaScadenza.length === 0);

  // Ben oltre la scadenza, sparita.
  const oltre = visibleTickerEntries([voce(1, 1000)], 1000 + TICKER_ENTRY_LIFETIME_MS + 5000);
  check('molto dopo la scadenza è sparita', oltre.length === 0);

  // Una coda mista: solo le voci ancora entro la loro finestra sopravvivono,
  // le altre si tolgono senza toccare quelle rimaste.
  const coda = [voce(1, 0), voce(2, 3000), voce(3, 6000)];
  const now = 6500;
  const rimaste = visibleTickerEntries(coda, now);
  check('in una coda mista restano solo le voci non scadute',
    rimaste.length === 2 && rimaste[0].id === 2 && rimaste[1].id === 3,
    JSON.stringify(rimaste));

  // Coda vuota: nessun errore, nessuna voce.
  check('una coda vuota resta vuota', visibleTickerEntries([], Date.now()).length === 0);

  // Un turno rumoroso (atterra, paga, passa il turno) non deve far crescere
  // la striscia senza limite: solo le voci più recenti restano.
  const raffica = [voce(1, 0), voce(2, 0), voce(3, 0), voce(4, 0), voce(5, 0)];
  const tenute = capTickerQueue(raffica);
  check(`non restano più di ${TICKER_MAX_VISIBLE} voci insieme`,
    tenute.length === TICKER_MAX_VISIBLE, `restate=${tenute.length}`);
  check('a parità di scadenza, si scartano le più vecchie e restano le ultime',
    tenute[0].id === 3 && tenute[1].id === 4 && tenute[2].id === 5,
    JSON.stringify(tenute.map((t) => t.id)));

  // Sotto il tetto, nessun taglio: la coda passa invariata.
  const poche = [voce(1, 0), voce(2, 0)];
  check('una coda già corta non viene toccata', capTickerQueue(poche) === poche);
}

// ---------------------------------------------------------------------------
section('5. Riepilogo di fine partita');
{
  // formatDuration: sotto l'ora si mostrano solo i minuti, arrotondati.
  check('meno di un minuto arrotonda a 0 min', formatDuration(20_000) === '0 min');
  check('42 minuti esatti', formatDuration(42 * 60_000) === '42 min');
  // 41 min 58s arrotonda a 42 min: i secondi non contano nel riepilogo.
  check('arrotonda al minuto più vicino', formatDuration(41 * 60_000 + 58_000) === '42 min');
  check('un\'ora esatta', formatDuration(60 * 60_000) === '1h 00min');
  check('un\'ora e mezza', formatDuration(90 * 60_000) === '1h 30min');
  check('minuti a due cifre col padding dopo l\'ora', formatDuration(65 * 60_000) === '1h 05min');
  check('una durata negativa (orologi disallineati) non va sotto zero', formatDuration(-5000) === '0 min');

  // mostVisitedSquare: cerca il massimo tra gli atterraggi registrati.
  check('nessun atterraggio registrato: nessuna casella', mostVisitedSquare({}, tabellone) === null);
  const atterraggi = { 1: 3, 5: 7, 10: 2 };
  const piuVisitata = mostVisitedSquare(atterraggi, tabellone);
  check('trova la casella col conteggio più alto',
    piuVisitata?.square.position === 5 && piuVisitata.count === 7,
    JSON.stringify(piuVisitata));
  // Una posizione fuori dal tabellone noto (client disallineato dal server)
  // non deve far esplodere il riepilogo: si ignora e basta.
  check('posizione sconosciuta al tabellone non esplode',
    mostVisitedSquare({ 999: 5 }, tabellone) === null);

  // statFor: 0 per chi non compare ancora nella mappa, non undefined/NaN.
  check('giocatore assente dalla mappa vale 0', statFor({}, 'chiunque') === 0);
  check('giocatore presente restituisce il suo valore', statFor({ io: 250 }, 'io') === 250);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
