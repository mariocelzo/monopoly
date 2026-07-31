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
import { readFileSync } from 'node:fs';
import { board } from '../server/src/data/board.js';
import { propertyGroups } from './src/propertyGroups.ts';
import type { BoardSquare, GameState } from './src/socket.ts';
import { MOBILE_BREAKPOINT, TOUCH_LAYOUT_QUERY } from './src/useIsMobile.ts';
import { latestLogAt, missedSince } from './src/awayRecap.ts';
import { formatDuration, mostVisitedSquare, statFor } from './src/gameSummary.ts';
import { isGameWaitingFor } from './src/turnAlert.ts';
import { netWorthShares } from './src/netWorthBar.ts';
import { skipTurnPrompt } from './src/skipTurn.ts';
import {
  addResult,
  buildResultFromState,
  emptyScoreboard,
  mostLandedSquare,
  normalizeName,
  parseScoreboard,
  rankedPlayers,
  type FinishedGameState,
} from './src/scoreboard.ts';
import {
  azzeraRifiuto,
  iscrivitiAiRifiuti,
  messaggioDiRifiuto,
  rifiutoCorrente,
  segnalaEsito,
} from './src/azioni.ts';
import { readdirSync } from 'node:fs';

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
    ownership[position] = { ownerId: playerId, houses: 0, hotels: 0, mortgaged: false };
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
    [ARANCIONI[0]]: { ownerId: 'io', houses: 0, hotels: 0, mortgaged: true },
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
section('4. Riepilogo di fine partita');
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
section('5. Avviso di turno: quando il gioco aspetta proprio questo giocatore');
{
  // Stato minimo per i test: solo i campi che isGameWaitingFor guarda
  // davvero contano, il resto è riempito con valori innocui.
  const statoBase = (overrides: Partial<GameState>): GameState => ({
    roomCode: 'ABCDE',
    players: [
      { id: 'io', name: 'Io', token: 'auto', balance: 1500, position: 0, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false, doublesInARow: 0, connected: true, isBot: false, netWorth: 1500 },
      { id: 'bot', name: 'Bot', token: 'cane', balance: 1500, position: 0, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false, doublesInARow: 0, connected: true, isBot: true, netWorth: 1500 },
    ],
    ownership: {},
    turnIndex: 0,
    started: true,
    log: [],
    pendingAction: null,
    finished: false,
    winnerId: null,
    endedReason: null,
    hostId: 'io',
    rematchVotes: [],
    lastRoll: null,
    stats: { startedAt: null, finishedAt: null, rentPaid: {}, rentCollected: {}, bankPaid: {}, purchases: {}, housesBuilt: {}, landings: {}, laps: {}, tradesCompleted: 0 },
    ...overrides,
  });

  // Nessun pendingAction: si aspetta solo chi ha il turno.
  check('è il mio turno, nessuna azione in sospeso: mi aspetta',
    isGameWaitingFor(statoBase({ turnIndex: 0 }), 'io') === true);
  check('è il turno del bot: non mi aspetta',
    isGameWaitingFor(statoBase({ turnIndex: 1 }), 'io') === false);

  // pendingAction che mi nomina: mi aspetta anche se non sono io ad avere
  // in mano i dadi (es. un'asta che gira, o un affitto innescato dal bot
  // che è atterrato su una mia proprietà... qui basta il caso base).
  check('pendingAction con playerId uguale al mio: mi aspetta',
    isGameWaitingFor(statoBase({
      turnIndex: 1,
      pendingAction: { type: 'awaiting_rent', playerId: 'io', position: 5, amount: 20, ownerId: 'bot', doubled: false },
    }), 'io') === true);

  // pendingAction che nomina qualcun altro: non mi aspetta, anche se il
  // turno di tirare i dadi sarebbe il mio.
  check('pendingAction con playerId altrui: non mi aspetta',
    isGameWaitingFor(statoBase({
      turnIndex: 0,
      pendingAction: { type: 'awaiting_auction', playerId: 'bot', position: 5, price: 100, currentBid: 100, currentBidderId: null, queue: ['bot', 'io'], passedIds: [] },
    }), 'io') === false);

  // Scambio proposto a me: sono il playerId (destinatario) e devo rispondere.
  check('scambio da valutare, sono il destinatario: mi aspetta',
    isGameWaitingFor(statoBase({
      pendingAction: { type: 'awaiting_trade', playerId: 'io', fromId: 'bot', toId: 'io', offerProperties: [], offerMoney: 0, offerJailCards: 0, requestProperties: [], requestMoney: 0, requestJailCards: 0 },
    }), 'io') === true);

  // Partita non ancora iniziata, o già finita: non aspetta nessuno.
  check('partita non iniziata: non aspetta nessuno',
    isGameWaitingFor(statoBase({ started: false, turnIndex: 0 }), 'io') === false);
  check('partita finita: non aspetta nessuno anche se sarebbe il mio turno',
    isGameWaitingFor(statoBase({ finished: true, turnIndex: 0 }), 'io') === false);

  // Senza un mio id (non ancora assegnato) non può aspettare me.
  check('nessun myId: non mi aspetta',
    isGameWaitingFor(statoBase({ turnIndex: 0 }), null) === false);
}

// ---------------------------------------------------------------------------
section('6. Barra proporzionale del patrimonio');
{
  // Il più ricco riempie sempre la barra intera: è il metro di paragone,
  // non un partecipante come gli altri.
  const quote = netWorthShares([
    { id: 'a', netWorth: 4000 },
    { id: 'b', netWorth: 2000 },
    { id: 'c', netWorth: 1000 },
  ]);
  check('il leader è al 100%', quote[0].percent === 100, JSON.stringify(quote));
  check('metà del leader fa 50%', quote[1].percent === 50, JSON.stringify(quote));
  check('un quarto del leader fa 25%', quote[2].percent === 25, JSON.stringify(quote));

  // Parità: entrambi in testa, entrambi pieni.
  const pari = netWorthShares([{ id: 'a', netWorth: 1500 }, { id: 'b', netWorth: 1500 }]);
  check('a pari patrimonio le barre sono entrambe piene',
    pari[0].percent === 100 && pari[1].percent === 100, JSON.stringify(pari));

  // Nessuna divisione per zero a inizio partita fantoccio (tutti a zero):
  // le barre restano a zero invece di diventare NaN.
  const azzerati = netWorthShares([{ id: 'a', netWorth: 0 }, { id: 'b', netWorth: 0 }]);
  check('tutti a zero: barre vuote, non NaN',
    azzerati.every((q) => q.percent === 0), JSON.stringify(azzerati));

  // Un saldo transitoriamente negativo (debito in sospeso) non deve produrre
  // una percentuale negativa, che romperebbe la larghezza della barra.
  const conNegativo = netWorthShares([{ id: 'a', netWorth: 1000 }, { id: 'b', netWorth: -50 }]);
  check('un patrimonio negativo si clampa a barra vuota, non negativa',
    conNegativo[1].percent === 0, JSON.stringify(conNegativo));

  // Un solo giocatore (partita appena iniziata, ancora in attesa): resta
  // pieno rispetto a se stesso.
  const solo = netWorthShares([{ id: 'a', netWorth: 1500 }]);
  check('un giocatore da solo riempie comunque la propria barra',
    solo[0].percent === 100, JSON.stringify(solo));
}

// ---------------------------------------------------------------------------
section('7. Tabellino fra una partita e l\'altra');
{
  // Giocatore minimo per i fixture qui sotto: solo i campi che la logica del
  // tabellino guarda davvero (id, name, isBot, netWorth), il resto riempito
  // con valori innocui — stesso criterio di statoBase più sopra.
  const giocatore = (overrides: Partial<FinishedGameState['players'][number]>) => ({
    id: 'x', name: 'X', token: '🐕', balance: 1500, position: 0, inJail: false,
    jailTurns: 0, jailCards: 0, bankrupt: false, doublesInARow: 0, connected: true,
    isBot: false, netWorth: 1500,
    ...overrides,
  });

  // Una partita finita "normale": due umani, un vincitore, durata e
  // patrimoni noti. Le singole asserzioni la modificano con `overrides`.
  const partitaFinita = (overrides: Partial<FinishedGameState> = {}): FinishedGameState => ({
    roomCode: 'ABCDE',
    finished: true,
    winnerId: 'mario',
    endedReason: 'bankruptcy',
    players: [
      giocatore({ id: 'mario', name: 'Mario', netWorth: 3200 }),
      giocatore({ id: 'luigi', name: 'Luigi', netWorth: 400 }),
    ],
    stats: {
      startedAt: 1000, finishedAt: 1000 + 40 * 60000, // 40 minuti
      rentPaid: {}, rentCollected: {}, bankPaid: {}, purchases: {}, housesBuilt: {},
      landings: { 5: 3, 24: 7 }, laps: {}, tradesCompleted: 0,
    },
    ...overrides,
  });

  // --- buildResultFromState: chi va segnato e chi no -----------------------

  check('tavolo chiuso: non è un risultato, buildResultFromState rifiuta',
    buildResultFromState(partitaFinita({ endedReason: 'closed' })) === null);

  check('partita non finita: niente da segnare',
    buildResultFromState(partitaFinita({ finished: false })) === null);

  check('nessun vincitore (difesa): niente da segnare',
    buildResultFromState(partitaFinita({ winnerId: null })) === null);

  // Un bot al tavolo: il tabellino è per la sfida fra le due persone vere,
  // una vittoria (propria o del bot) in una partita con un bot non conta.
  check('un bot al tavolo: la partita non entra nel tabellino',
    buildResultFromState(partitaFinita({
      players: [
        giocatore({ id: 'mario', name: 'Mario' }),
        giocatore({ id: 'bot', name: 'Bot Aurelio', isBot: true }),
      ],
    })) === null);

  // Bancarotta e abbandono restano un esito vero (c'è un vincitore), solo
  // la chiusura del tavolo è esclusa.
  const abbandono = buildResultFromState(partitaFinita({ endedReason: 'abandoned' }));
  check('abbandono: è comunque un risultato da segnare', abbandono !== null);

  const risultato = buildResultFromState(partitaFinita());
  check('partita valida: produce un risultato', risultato !== null);
  check('il vincitore è quello giusto', risultato?.winnerName === 'Mario');
  check('la durata viene da finishedAt - startedAt',
    risultato?.durationMs === 40 * 60000, String(risultato?.durationMs));
  check('gameId combina tavolo e inizio partita',
    risultato?.gameId === 'ABCDE:1000', risultato?.gameId);

  // --- addResult su un tabellino vuoto -------------------------------------

  const vuoto = emptyScoreboard();
  const dopoUnaPartita = addResult(vuoto, risultato!);
  check('il tabellino vuoto non viene mutato', vuoto.recordedGameIds.length === 0);
  check('chi vince ha una vittoria e una partita giocata',
    dopoUnaPartita.players['mario'].wins === 1 && dopoUnaPartita.players['mario'].gamesPlayed === 1);
  check('chi perde ha zero vittorie ma una partita giocata',
    dopoUnaPartita.players['luigi'].wins === 0 && dopoUnaPartita.players['luigi'].gamesPlayed === 1);
  check('il nome mostrato è quello scritto in partita',
    dopoUnaPartita.players['mario'].displayName === 'Mario');
  check('il record di patrimonio prende il più alto dei due',
    dopoUnaPartita.records.highestNetWorth?.amount === 3200 &&
    dopoUnaPartita.records.highestNetWorth?.name === 'Mario');
  check('la partita più lunga è questa, non essendocene altre',
    dopoUnaPartita.records.longestGame?.ms === 40 * 60000);

  // --- lo stesso giocatore vince due volte ---------------------------------

  const secondaVittoriaMario = buildResultFromState(partitaFinita({
    winnerId: 'mario',
    stats: { ...partitaFinita().stats, startedAt: 5000, finishedAt: 5000 + 10 * 60000 },
  }));
  const dopoDuePartite = addResult(dopoUnaPartita, secondaVittoriaMario!);
  check('due vittorie dello stesso giocatore si sommano',
    dopoDuePartite.players['mario'].wins === 2 && dopoDuePartite.players['mario'].gamesPlayed === 2);
  check('il record di durata resta la prima partita, più lunga della seconda',
    dopoDuePartite.records.longestGame?.ms === 40 * 60000);

  // --- idempotenza: la stessa partita non si conta due volte ---------------

  const riregistrata = addResult(dopoDuePartite, risultato!); // stesso gameId di prima
  check('registrare due volte la stessa partita non cambia il tabellino',
    riregistrata.players['mario'].wins === 2 && riregistrata.players['mario'].gamesPlayed === 2);
  check('addResult con un gameId già visto restituisce lo stesso oggetto',
    riregistrata === dopoDuePartite);

  // --- normalizzazione dei nomi ---------------------------------------------

  check('spazi e maiuscole non creano un giocatore diverso',
    normalizeName('Mario') === normalizeName('  mario ') &&
    normalizeName('Mario') === normalizeName('MARIO'));
  check('spazi ripetuti in mezzo al nome si accorpano',
    normalizeName('Mario  Rossi') === normalizeName('Mario Rossi'));

  const conNomeVariato = buildResultFromState(partitaFinita({
    winnerId: 'mario',
    players: [
      giocatore({ id: 'mario', name: ' mario ', netWorth: 1000 }), // stesso Mario, scritto diverso
      giocatore({ id: 'luigi', name: 'Luigi', netWorth: 200 }),
    ],
    stats: { ...partitaFinita().stats, startedAt: 9000, finishedAt: 9000 + 5 * 60000 },
  }));
  const dopoNomeVariato = addResult(dopoDuePartite, conNomeVariato!);
  check('"mario" scritto diverso finisce sulla stessa voce del tabellino',
    dopoNomeVariato.players['mario'].wins === 3 && dopoNomeVariato.players['mario'].gamesPlayed === 3);
  check('la grafia mostrata resta quella vista la prima volta, non l\'ultima',
    dopoNomeVariato.players['mario'].displayName === 'Mario');

  // --- record che si aggiornano solo se davvero migliori --------------------

  const partitaModesta = buildResultFromState(partitaFinita({
    winnerId: 'luigi',
    players: [
      giocatore({ id: 'mario', name: 'Mario', netWorth: 500 }),
      giocatore({ id: 'luigi', name: 'Luigi', netWorth: 800 }), // meno del record già segnato (3200)
    ],
    stats: { ...partitaFinita().stats, startedAt: 20000, finishedAt: 20000 + 5 * 60000 }, // più corta
  }));
  const dopoPartitaModesta = addResult(dopoNomeVariato, partitaModesta!);
  check('un patrimonio più basso non scalza il record esistente',
    dopoPartitaModesta.records.highestNetWorth?.amount === 3200);
  check('una partita più corta non scalza il record di durata esistente',
    dopoPartitaModesta.records.longestGame?.ms === 40 * 60000);

  // --- ordinamento del tabellino ---------------------------------------------

  const classifica = rankedPlayers(dopoPartitaModesta);
  check('chi ha più vittorie sta in cima', classifica[0].displayName === 'Mario');
  check('tutti i giocatori compaiono in classifica', classifica.length === 2);

  // --- casella più gettonata di sempre, sommata su più partite --------------

  const gettonata = mostLandedSquare(dopoPartitaModesta.landingsTotals);
  // landings di ogni partita sopra: {5: 3, 24: 7}, sommati sulle quattro
  // partite registrate finora (game1, game2, conNomeVariato, partitaModesta)
  // -> 24 resta la più gettonata (28 atterraggi) rispetto a 5 (12 atterraggi).
  check('la casella più gettonata somma i conteggi di tutte le partite',
    gettonata?.position === 24 && gettonata?.count === 28, JSON.stringify(gettonata));

  // --- un tabellino corrotto o di una vecchia versione non esplode ----------

  check('nessun dato salvato: tabellino vuoto', parseScoreboard(null).players &&
    Object.keys(parseScoreboard(null).players).length === 0);
  check('JSON illeggibile: tabellino vuoto, nessun errore lanciato',
    (() => { try { return Object.keys(parseScoreboard('{questo non è json').players).length === 0; }
             catch { return false; } })());
  check('un array al posto di un oggetto: tabellino vuoto',
    Object.keys(parseScoreboard('[1,2,3]').players).length === 0);
  check('versione sconosciuta (formato futuro o precedente): tabellino vuoto',
    Object.keys(parseScoreboard(JSON.stringify({ version: 2, players: { mario: { displayName: 'Mario', wins: 9, gamesPlayed: 9 } } })).players).length === 0);
  check('campo players mancante: non esplode, resta vuoto',
    Object.keys(parseScoreboard(JSON.stringify({ version: 1 })).players).length === 0);
  // Una voce con un campo scritto male (wins come stringa) non deve
  // propagare NaN: si scarta il valore e si usa 0.
  const conVoceSporca = parseScoreboard(JSON.stringify({
    version: 1,
    players: { mario: { displayName: 'Mario', wins: 'tante', gamesPlayed: 4 } },
    recordedGameIds: [],
    landingsTotals: {},
    records: { longestGame: null, highestNetWorth: null },
  }));
  check('un contatore corrotto (stringa invece di numero) diventa 0, non NaN',
    conVoceSporca.players['mario']?.wins === 0 && !Number.isNaN(conVoceSporca.players['mario']?.wins));

  // Un tabellino valido va e torna identico attraverso stringify/parse.
  const originale = dopoPartitaModesta;
  const andataERitorno = parseScoreboard(JSON.stringify(originale));
  check('un tabellino valido sopravvive al giro completo salva/carica',
    andataERitorno.players['mario'].wins === originale.players['mario'].wins &&
    andataERitorno.records.highestNetWorth?.amount === originale.records.highestNetWorth?.amount);
}

// ---------------------------------------------------------------------------
// La finestra dell'asta non deve ricalcolarsi il rilancio minimo
// ---------------------------------------------------------------------------
// Guardia insolita — legge il sorgente invece di eseguirlo — ma mirata a un
// difetto che in questo progetto è già tornato DUE volte: prima nei bot, che si
// bloccavano offrendo sempre 10, poi in AuctionModal, dove il bottone
// "Rilancia" mandava un'offerta sotto il minimo su 24 caselle su 28 e il motore
// la rifiutava in silenzio, facendo sembrare che rilanciassero solo i bot.
//
// La causa è sempre la stessa: il minimo non è fisso, cresce col listino della
// casella, e qualunque formula riscritta fuori dal motore prima o poi si stacca
// da quella vera. Il motore lo pubblica già in pendingAction.minBid: qui si
// verifica soltanto che la finestra lo usi e non se lo rifaccia. Un test sul
// comportamento non ci arriverebbe senza montare React, e il test lato server
// non basta: là il calcolo è sempre stato giusto, il difetto stava solo qui.
{
  const sorgente = readFileSync(new URL('./src/components/AuctionModal.tsx', import.meta.url), 'utf8');
  // I commenti si tolgono prima di guardare: quel file SPIEGA la formula
  // sbagliata di prima, e senza questo passaggio il controllo si accenderebbe
  // sulla propria stessa spiegazione.
  const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check("la finestra dell'asta legge il minimo dal motore (pending.minBid)",
    codice.includes('pending.minBid'));
  check("e non se lo ricalcola con uno scatto fisso",
    !/currentBid\s*[+]\s*\d/.test(codice),
    'trovata un\'espressione tipo "currentBid + 10" nel codice');
}

// ---------------------------------------------------------------------------
section('9. Quando mostrare il comando che salta il turno di un disconnesso');
{
  // Anna ha il turno ed è caduta; io e Carla stiamo guardando. È la situazione
  // che prima lasciava il tabellone fermo senza spiegazioni né rimedi.
  const giocatore = (id: string, nome: string, extra: Partial<GameState['players'][number]> = {}) => ({
    id, name: nome, token: 'auto', balance: 1500, position: 0, inJail: false, jailTurns: 0,
    jailCards: 0, bankrupt: false, doublesInARow: 0, connected: true, isBot: false,
    netWorth: 1500, ...extra,
  });

  const tavolo = (overrides: Partial<GameState> = {}): GameState => ({
    roomCode: 'ABCDE',
    players: [
      giocatore('anna', 'Anna', { connected: false }),
      giocatore('io', 'Io'),
      giocatore('carla', 'Carla'),
    ],
    ownership: {},
    turnIndex: 0,
    started: true,
    log: [],
    pendingAction: null,
    finished: false,
    winnerId: null,
    endedReason: null,
    hostId: 'anna',
    rematchVotes: [],
    lastRoll: null,
    stats: { startedAt: null, finishedAt: null, rentPaid: {}, rentCollected: {}, bankPaid: {}, purchases: {}, housesBuilt: {}, landings: {}, laps: {}, tradesCompleted: 0 },
    rules: { goAmount: 500, freeParkingEnabled: true, auctionEnabled: true, startingBalance: 1500, skyscraperEnabled: false },
    turnoBloccato: { playerId: 'anna', attesaRimanenteMs: 60000 },
    ...overrides,
  });

  // Il caso per cui esiste: si mostra, ma prima come attesa e solo dopo come
  // comando premibile.
  const durante = skipTurnPrompt(tavolo(), 'io', 12_000);
  check('mentre l\'attesa scorre si mostra l\'avviso, non il bottone',
    durante !== null && durante.ready === false);
  check('e dice quanti secondi mancano, arrotondati per eccesso',
    skipTurnPrompt(tavolo(), 'io', 11_200)?.secondsLeft === 12);
  const scaduta = skipTurnPrompt(tavolo(), 'io', 0);
  check('scaduta l\'attesa il comando è utilizzabile',
    scaduta !== null && scaduta.ready === true && scaduta.secondsLeft === 0);
  check('un\'attesa già negativa (timer in ritardo) resta utilizzabile, non torna indietro',
    skipTurnPrompt(tavolo(), 'io', -5000)?.ready === true);
  check('nomina il giocatore fermo, per poterlo scrivere nella conferma',
    scaduta?.player.name === 'Anna');

  // Le direzioni opposte: tutti i casi in cui NON si deve vedere niente.
  check('non si mostra se chi ha il turno è collegato',
    skipTurnPrompt(tavolo({ players: [giocatore('anna', 'Anna'), giocatore('io', 'Io'), giocatore('carla', 'Carla')] }), 'io', 0) === null);
  check('non si mostra senza segnalazione dal server',
    skipTurnPrompt(tavolo({ turnoBloccato: null }), 'io', 0) === null);
  check('non si mostra se il campo manca del tutto (server più vecchio del client)',
    skipTurnPrompt(tavolo({ turnoBloccato: undefined }), 'io', 0) === null);
  check('non si mostra prima del via',
    skipTurnPrompt(tavolo({ started: false }), 'io', 0) === null);
  check('non si mostra a partita finita',
    skipTurnPrompt(tavolo({ finished: true }), 'io', 0) === null);
  check('non si mostra a chi il turno ce l\'ha (a sé stessi non ci si salta)',
    skipTurnPrompt(tavolo(), 'anna', 0) === null);
  check('non si mostra a chi non è a questo tavolo',
    skipTurnPrompt(tavolo(), 'estraneo', 0) === null);
  check('non si mostra a chi è fallito: guarda e basta',
    skipTurnPrompt(tavolo({
      players: [giocatore('anna', 'Anna', { connected: false }), giocatore('io', 'Io', { bankrupt: true }), giocatore('carla', 'Carla')],
    }), 'io', 0) === null);
  check('non si mostra se il disconnesso è già fuori dalla partita',
    skipTurnPrompt(tavolo({
      players: [giocatore('anna', 'Anna', { connected: false, bankrupt: true }), giocatore('io', 'Io'), giocatore('carla', 'Carla')],
    }), 'io', 0) === null);
  // La segnalazione del server può riferirsi al turno di prima: lo stato è
  // sempre più fresco, e comanda lui.
  check('non si mostra se il turno è già passato ad altri',
    skipTurnPrompt(tavolo({ turnIndex: 1 }), 'io', 0) === null);
  // Il tavolo aspetta Carla, che è collegata: non è colpa del disconnesso, e il
  // server rifiuterebbe comunque il salto.
  check('non si mostra se la partita aspetta la risposta di un altro',
    skipTurnPrompt(tavolo({
      pendingAction: { type: 'awaiting_rent', playerId: 'carla', position: 5, amount: 20, ownerId: 'io', doubled: false },
    }), 'io', 0) === null);
  // Le finestre del disconnesso invece sono esattamente il caso da sbloccare.
  check('si mostra se la finestra aperta è proprio del disconnesso',
    skipTurnPrompt(tavolo({
      pendingAction: { type: 'awaiting_buy', playerId: 'anna', position: 5, price: 100 },
    }), 'io', 0)?.ready === true);
}

// ---------------------------------------------------------------------------
// I rifiuti del server devono arrivare a chi ha premuto
// ---------------------------------------------------------------------------
// Il difetto di partenza: quasi ogni `socket.emit` del client ignorava l'ack, e
// un'azione rifiutata era indistinguibile da un bottone rotto. Qui si verifica
// la parte che decide COSA vale la pena mostrare, più il canale che lo porta a
// schermo (vedi src/azioni.ts).
section('Avvisi delle azioni rifiutate');
{
  // Le istruzioni del motore devono passare intere: sono esattamente quelle che
  // fino a ieri nessuno vedeva.
  check('un rifiuto con un motivo si mostra così com\'è',
    messaggioDiRifiuto('build_house', 'Serve il monopolio del colore per costruire')
      === 'Serve il monopolio del colore per costruire');
  check('anche quello del riscatto delle ipoteche',
    messaggioDiRifiuto('build_house', 'Riscatta prima le ipoteche del colore') !== null);
  // Il messaggio che il difetto dell'asta produceva a ogni clic: è IL caso da
  // non tacere mai, e contiene un numero, quindi nessuna lista può contenerlo.
  check('il rilancio sotto il minimo si mostra (numero compreso)',
    messaggioDiRifiuto('auction_bid', 'Rilancio minimo 40') === 'Rilancio minimo 40');
  check('e il saldo insufficiente in asta pure',
    messaggioDiRifiuto('auction_bid', 'Saldo insufficiente') === 'Saldo insufficiente');

  // Le corse innocue non devono generare avvisi: un falso allarme insegna a
  // ignorare anche quelli veri.
  check('il doppio clic su Fine turno non diventa un avviso',
    messaggioDiRifiuto('end_turn', 'Non è il tuo turno') === null);
  check('né il doppio clic sui dadi',
    messaggioDiRifiuto('roll_dice', 'Non è il tuo turno') === null);
  check('né una finestra che si è già chiusa da sé',
    messaggioDiRifiuto('buy_property', 'Nessun acquisto in sospeso') === null &&
    messaggioDiRifiuto('pay_rent', 'Nessun affitto da pagare') === null &&
    messaggioDiRifiuto('acknowledge_card', 'Nessuna carta da leggere') === null &&
    messaggioDiRifiuto('auction_pass', 'Nessuna asta in corso') === null);
  check('né la rivincita chiesta due volte',
    messaggioDiRifiuto('request_rematch', 'Hai già chiesto la rivincita') === null);
  check('un\'azione riuscita non dice niente',
    messaggioDiRifiuto('roll_dice', undefined) === null);

  // Tacere è una scelta PER AZIONE: la stessa frase può essere innocua per un
  // comando e importante per un altro, e questa è la garanzia che le liste non
  // si trasformino in un calderone unico.
  check('"nessun acquisto in sospeso" si tace solo per chi compra',
    messaggioDiRifiuto('buy_property', 'Nessun acquisto in sospeso') === null &&
    messaggioDiRifiuto('build_house', 'Nessun acquisto in sospeso') !== null);
  // "Prima paga l'affitto" NON è una corsa: è un'istruzione, dice cosa fare.
  check('le istruzioni "prima fai X" restano visibili',
    messaggioDiRifiuto('end_turn', 'Prima paga l\'affitto') === 'Prima paga l\'affitto');

  // Il canale: pubblica, avvisa chi ascolta, e si azzera alla prossima riuscita.
  azzeraRifiuto();
  let avvisi = 0;
  const stop = iscrivitiAiRifiuti(() => { avvisi += 1; });

  check('un rifiuto taciuto lascia lo schermo pulito',
    segnalaEsito('end_turn', 'Non è il tuo turno') === true && rifiutoCorrente() === null,
    'taciuto, ma va comunque riportato come rifiuto a chi ha inviato');

  segnalaEsito('build_house', 'Saldo insufficiente');
  check('un rifiuto da mostrare diventa l\'avviso corrente',
    rifiutoCorrente()?.testo === 'Saldo insufficiente' && avvisi === 1);

  const primo = rifiutoCorrente()!.seq;
  segnalaEsito('build_house', 'Saldo insufficiente');
  check('ripremere lo stesso bottone produce un avviso NUOVO (seq diverso)',
    rifiutoCorrente()!.seq !== primo,
    'senza, il secondo tentativo sembrerebbe di nuovo non fare niente');

  check('l\'azione riuscita successiva porta via l\'avviso',
    segnalaEsito('build_house', undefined) === false && rifiutoCorrente() === null);

  stop();
  segnalaEsito('build_house', 'Saldo insufficiente');
  // Tre notifiche in tutto: i due avvisi mostrati e la loro cancellazione. Il
  // rifiuto taciuto non ne produce nessuna, e nemmeno l'ultimo, dopo `stop()`.
  check('dopo l\'annullamento dell\'iscrizione non arrivano più notifiche',
    avvisi === 3, `ricevute ${avvisi}`);
  azzeraRifiuto();
}

// ---------------------------------------------------------------------------
// Nessuna azione di gioco può tornare a ignorare la risposta del server
// ---------------------------------------------------------------------------
// Stessa forma della guardia sull'asta qui sotto: si legge il sorgente, perché
// è una regola sul CODICE, non sul comportamento. `socket.emit` diretto vuol
// dire "mando e non guardo cosa risponde", che è precisamente il difetto: 19
// azioni su 23 erano così. Tutte le mosse passano da `inviaAzione` (socket.ts);
// restano fuori solo le quattro che hanno una logica propria sulla risposta e
// non sono mosse di gioco.
{
  const consentiti = new Set([
    'socket.ts', // è qui che vive inviaAzione: l'unico emit legittimo
    'Lobby.tsx', // create_room/join_room: leggono anche i pedoni già presi
    'App.tsx', // rejoin_room: sulla risposta decide se tornare alla lobby
    'HomeButton.tsx', // leave_table: aspetta la conferma prima di uscire
  ]);

  const cartelle = ['./src/', './src/components/'];
  const colpevoli: string[] = [];
  for (const cartella of cartelle) {
    const dir = new URL(cartella, import.meta.url);
    for (const nome of readdirSync(dir)) {
      if (!nome.endsWith('.ts') && !nome.endsWith('.tsx')) continue;
      if (consentiti.has(nome)) continue;
      const sorgente = readFileSync(new URL(nome, dir), 'utf8');
      // I commenti si tolgono prima di guardare: parecchi file SPIEGANO il
      // difetto citando `socket.emit`, e senza questo passaggio il controllo si
      // accenderebbe sulle proprie stesse spiegazioni.
      const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (codice.includes('socket.emit(')) colpevoli.push(nome);
    }
  }
  check('nessun componente manda un\'azione senza guardare la risposta',
    colpevoli.length === 0,
    `socket.emit diretto in: ${colpevoli.join(', ')} — usa inviaAzione`);
}

// ---------------------------------------------------------------------------
// Le frasi da silenziare esistono davvero nel motore
// ---------------------------------------------------------------------------
// azioni.ts decide cosa tacere confrontando il TESTO ESATTO del messaggio
// d'errore ("Non è il tuo turno", "Nessun acquisto in sospeso"). I test qui
// sopra però passano a messaggioDiRifiuto le stesse stringhe scritte in
// azioni.ts: si controllano a vicenda e sarebbero d'accordo anche se il motore
// nel frattempo avesse cambiato parole. Il giorno in cui succede, il rifiuto
// smette di essere riconosciuto e ricompare come avviso rosso durante una
// partita che funziona — un falso allarme, che è peggio del silenzio perché
// insegna a ignorare gli avvisi veri.
//
// Questo controllo chiude il cerchio ancorando quelle frasi alla sorgente vera:
// se qualcuno riscrive un messaggio in gameEngine.js, qui diventa rosso e la
// lista va aggiornata. Stessa idea della guardia su AuctionModal qui sotto.
{
  const motore = readFileSync(new URL('../server/src/gameEngine.js', import.meta.url), 'utf8');
  const righe = readFileSync(new URL('./src/azioni.ts', import.meta.url), 'utf8').split('\n');
  const inizio = righe.findIndex((r) => r.includes('const CORSE_INNOCUE'));
  const fine = righe.findIndex((r) => r.includes('export function messaggioDiRifiuto'));
  const frasi = new Set<string>();
  for (const riga of righe.slice(inizio, fine)) {
    const pulita = riga.trim();
    if (pulita.startsWith('//') || pulita.startsWith('*')) continue; // i commenti citano esempi
    for (const m of riga.matchAll(/'([^']+)'/g)) {
      if (m[1].includes(' ')) frasi.add(m[1]); // le frasi, non le chiavi tipo buy_property
    }
  }
  check('ci sono frasi da silenziare da controllare', frasi.size > 0, `trovate ${frasi.size}`);
  const orfane = [...frasi].filter((f) => !motore.includes(f));
  check(
    `tutte le ${frasi.size} frasi silenziate esistono verbatim in gameEngine.js`,
    orfane.length === 0,
    `non trovate nel motore: ${orfane.map((f) => JSON.stringify(f)).join(', ')}`
  );
}

// ---------------------------------------------------------------------------
// Nessuna formula del motore riscritta nel client
// ---------------------------------------------------------------------------
// Gli importi che il client mostra accanto ai bottoni — costo di costruzione,
// rimborso di vendita, valore d'ipoteca, costo di riscatto, affitto per livello
// di hotel — arrivano dal server insieme al tabellone (boardWithAmounts in
// gameEngine.js). Prima erano ricalcolati qui copiando le formule, ed è la
// famiglia di guai che in questo progetto è già costata due volte: i bot
// bloccati all'asta e il tasto "Rilancia" che offriva sotto il minimo su 24
// caselle su 28. Due copie della stessa regola non divergono il giorno in cui
// le scrivi: divergono il giorno in cui qualcuno ne cambia una sola.
//
// Questa guardia non verifica un risultato, verifica che la scorciatoia non
// rientri dalla finestra: se quei numeri ricompaiono nel client, qui è rosso.
{
  const sorgenti = ['src/components/PropertiesPanel.tsx', 'src/components/SquareDetail.tsx']
    .map((f) => ({ f, testo: readFileSync(new URL(f, import.meta.url), 'utf8') }));

  const impronte: [string, RegExp][] = [
    ['i moltiplicatori di costo degli hotel (15, 22, 30)', /2:\s*15\s*,\s*3:\s*22\s*,\s*4:\s*30/],
    ["i moltiplicatori d'affitto degli hotel (1.7, 2.5, 3.5)", /2:\s*1\.7\s*,\s*3:\s*2\.5\s*,\s*4:\s*3\.5/],
    ["l'arrotondamento dell'affitto ai 25", /\/\s*25\s*\)\s*\*\s*25/],
    ["la metà del prezzo come valore d'ipoteca", /Math\.floor\(\s*\(?\s*square\.price/],
  ];
  for (const [cosa, impronta] of impronte) {
    const dove = sorgenti.filter((s) => impronta.test(s.testo)).map((s) => s.f);
    check(
      `${cosa}: non riscritti nel client`,
      dove.length === 0,
      `ricomparsi in ${dove.join(', ')} — quell'importo lo pubblica il motore, vedi boardWithAmounts`
    );
  }

  // E il contrario: gli importi pubblicati devono essere davvero letti, se no
  // la guardia qui sopra resterebbe verde anche cancellando le cifre dallo
  // schermo.
  const pannello = sorgenti[0].testo;
  const letti = ['buildCosts', 'buildRefunds', 'mortgageValue', 'unmortgageCost', 'hotelRents'];
  const mancanti = letti.filter((c) => !pannello.includes(c));
  check(
    'il pannello proprietà legge gli importi pubblicati dal motore',
    mancanti.length === 0,
    `non li legge più: ${mancanti.join(', ')}`
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} test superati, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
