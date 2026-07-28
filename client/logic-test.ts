// Test della logica pura del client. Nessun framework, come per smoke-test.js
// del server: si lancia con `npm test` dalla cartella client.
//
// Gira sotto node grazie a --experimental-strip-types. È il motivo per cui i
// moduli qui testati non devono avere import a runtime oltre ai tipi: node non
// saprebbe risolverli.
import { board } from '../server/src/data/board.js';
import { propertyGroups } from './src/propertyGroups.ts';
import type { BoardSquare, GameState } from './src/socket.ts';
import { TOUCH_LAYOUT_QUERY } from './src/useIsMobile.ts';

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
    TOUCH_LAYOUT_QUERY.includes('max-width: 780px'), TOUCH_LAYOUT_QUERY);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
