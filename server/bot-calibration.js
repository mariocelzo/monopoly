// Calibrazione dei bot: fa giocare centinaia di partite bot-contro-bot e
// riporta le statistiche che servono a tarare le soglie di botStrategy.js.
//
// Non è un test pass/fail come smoke-test.js: è uno strumento di misura. Si
// lancia con `node bot-calibration.js [numero-partite] [numero-bot]` dalla
// cartella server.
const { GameEngine } = require('./src/gameEngine');
const { botMove, botHasMove } = require('./src/bot');

const PARTITE = Number(process.argv[2]) || 200;
const BOT_PER_PARTITA = Number(process.argv[3]) || 2;
// Quarto argomento facoltativo: "skyscraper" (o "1") accende la modalità
// grattacieli per l'intera simulazione, per confrontare le due tarature.
// Di default resta spenta, come una partita creata senza toccare le regole.
const SKYSCRAPER = process.argv[4] === 'skyscraper' || process.argv[4] === '1';
// Oltre questo numero di mosse la partita si considera senza fine: succede
// quando nessuno riesce a mettere insieme un monopolio.
const MOSSE_MAX = 4000;

function giocaUnaPartita(numeroBot) {
  const game = new GameEngine('CAL');
  const pedoni = ['🎩', '🐕', '🚗', '🚢', '🐈', '🎸'];
  for (let i = 0; i < numeroBot; i++) game.addBot(`Bot ${i + 1}`, pedoni[i]);
  // Le regole si scelgono solo prima del via, e solo l'host può farlo: il
  // primo bot aggiunto è sempre l'host (vedi addPlayer in gameEngine.js).
  if (SKYSCRAPER) game.setRules(game.hostId, { skyscraperEnabled: true });
  game.start();

  let mosse = 0;
  while (!game.finished && mosse < MOSSE_MAX) {
    if (!botHasMove(game)) break; // situazione bloccata: si esce
    botMove(game);
    mosse += 1;
  }

  // I bot sono creati nell'ordine, quindi l'indice del vincitore è anche la
  // sua posizione al tavolo: è quello che serve per vedere se il primo di
  // turno è avvantaggiato.
  const posizioneVincitore = game.players.findIndex((p) => p.id === game.winnerId);

  return {
    finita: game.finished,
    posizioneVincitore,
    mosse,
    falliti: game.players.filter((p) => p.bankrupt).length,
    proprietaAssegnate: Object.keys(game.ownership).length,
  };
}

console.log(`Simulazione di ${PARTITE} partite a ${BOT_PER_PARTITA} bot (modalità grattacieli: ${SKYSCRAPER ? 'accesa' : 'spenta'})...\n`);

const vittorie = new Array(BOT_PER_PARTITA).fill(0);
let finite = 0;
let mosseTotali = 0;
let mosseFinite = 0;
let proprietaTotali = 0;

for (let i = 0; i < PARTITE; i++) {
  const r = giocaUnaPartita(BOT_PER_PARTITA);
  if (r.finita && r.posizioneVincitore >= 0) {
    finite += 1;
    mosseFinite += r.mosse;
    vittorie[r.posizioneVincitore] += 1;
  }
  mosseTotali += r.mosse;
  proprietaTotali += r.proprietaAssegnate;
}

const pct = (n, su) => (su === 0 ? '—' : `${Math.round((n / su) * 100)}%`);

console.log(`Partite concluse:        ${finite}/${PARTITE} (${pct(finite, PARTITE)})`);
console.log(`Mosse medie (tutte):     ${Math.round(mosseTotali / PARTITE)}`);
console.log(`Mosse medie (concluse):  ${finite ? Math.round(mosseFinite / finite) : '—'}`);
console.log(`Proprietà assegnate:     ${(proprietaTotali / PARTITE).toFixed(1)} su 28`);
console.log('\nVittorie per posizione al tavolo:');
vittorie.forEach((n, i) => {
  console.log(`  posizione ${i + 1}   ${String(n).padStart(4)}  (${pct(n, finite)})`);
});

console.log('\nCosa guardare:');
console.log('- le vittorie fra bot identici dovrebbero stare vicino a 1/N;');
console.log('  uno sbilanciamento forte segnala un vantaggio del primo di turno');
console.log('- se le proprietà assegnate sono poche, i bot comprano troppo poco');
console.log('- se poche partite si concludono, non riescono mai a fare monopoli');
