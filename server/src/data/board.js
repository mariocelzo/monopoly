// Tabellone del Monopoli, edizione italiana, 40 caselle.
// rents = [base, 1house, 2houses, 3houses, 4houses, hotel] for properties
// stations use rentByOwned = [1,2,3,4 owned]
// utilities use diceMultiplier = [oneOwned, bothOwned]

// Quanto si incassa passando dal Via **di default**, per una partita nuova.
// È diventato una regola della casa scelta al tavolo (vedi `rules.goAmount`
// in gameEngine.js): questa costante resta solo come valore iniziale prima
// che l'host la cambi. I testi delle carte qui sotto che citano l'importo
// non lo leggono più da qui: sono funzioni di `goAmount`, risolte da
// GameEngine al momento di costruire il mazzo (vedi `buildDeck`), così
// citano sempre l'importo scelto per QUESTA partita, non questo default.
const GO_AMOUNT = 500;

const COLOR_GROUPS = {
  brown: '#8B4513',
  lightblue: '#87CEEB',
  pink: '#D63384',
  orange: '#FD7E14',
  red: '#DC3545',
  yellow: '#FFC107',
  green: '#198754',
  blue: '#0D2C8A',
};

const board = [
  { position: 0, type: 'go', name: 'Via' },
  { position: 1, type: 'property', name: 'Vicolo Corto', group: 'brown', price: 60, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  { position: 2, type: 'community', name: 'Probabilità' },
  { position: 3, type: 'property', name: 'Vicolo Stretto', group: 'brown', price: 60, houseCost: 50, rents: [4, 20, 60, 180, 320, 450] },
  { position: 4, type: 'tax', name: 'Tassa patrimoniale', amount: 200 },
  { position: 5, type: 'station', name: 'Stazione Sud', price: 200 },
  { position: 6, type: 'property', name: 'Bastioni Gran Sasso', group: 'lightblue', price: 100, houseCost: 50, rents: [6, 30, 90, 270, 400, 550] },
  { position: 7, type: 'chance', name: 'Imprevisti' },
  { position: 8, type: 'property', name: 'Viale Monterosa', group: 'lightblue', price: 100, houseCost: 50, rents: [6, 30, 90, 270, 400, 550] },
  { position: 9, type: 'property', name: 'Viale Vesuvio', group: 'lightblue', price: 120, houseCost: 50, rents: [8, 40, 100, 300, 450, 600] },
  { position: 10, type: 'jail', name: 'Prigione / Transito' },
  { position: 11, type: 'property', name: 'Via Accademia', group: 'pink', price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { position: 12, type: 'utility', name: 'Società Elettrica', price: 150 },
  { position: 13, type: 'property', name: 'Corso Ateneo', group: 'pink', price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { position: 14, type: 'property', name: 'Piazza Università', group: 'pink', price: 160, houseCost: 100, rents: [12, 60, 180, 500, 700, 900] },
  { position: 15, type: 'station', name: 'Stazione Ovest', price: 200 },
  { position: 16, type: 'property', name: 'Via Verdi', group: 'orange', price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { position: 17, type: 'community', name: 'Probabilità' },
  { position: 18, type: 'property', name: 'Corso Raffaello', group: 'orange', price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { position: 19, type: 'property', name: 'Piazza Dante', group: 'orange', price: 200, houseCost: 100, rents: [16, 80, 220, 600, 800, 1000] },
  { position: 20, type: 'free_parking', name: 'Parcheggio gratuito' },
  { position: 21, type: 'property', name: 'Via Marco Polo', group: 'red', price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { position: 22, type: 'chance', name: 'Imprevisti' },
  { position: 23, type: 'property', name: 'Corso Magellano', group: 'red', price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { position: 24, type: 'property', name: 'Largo Colombo', group: 'red', price: 240, houseCost: 150, rents: [20, 100, 300, 750, 925, 1100] },
  { position: 25, type: 'station', name: 'Stazione Nord', price: 200 },
  { position: 26, type: 'property', name: 'Viale Costantino', group: 'yellow', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { position: 27, type: 'property', name: 'Viale Traiano', group: 'yellow', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { position: 28, type: 'utility', name: 'Acquedotto', price: 150 },
  { position: 29, type: 'property', name: 'Piazza Giulio Cesare', group: 'yellow', price: 280, houseCost: 150, rents: [24, 120, 360, 850, 1025, 1200] },
  { position: 30, type: 'go_to_jail', name: 'Vai in prigione' },
  { position: 31, type: 'property', name: 'Via Roma', group: 'green', price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { position: 32, type: 'property', name: 'Corso Impero', group: 'green', price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { position: 33, type: 'community', name: 'Probabilità' },
  { position: 34, type: 'property', name: 'Largo Augusto', group: 'green', price: 320, houseCost: 200, rents: [28, 150, 450, 1000, 1200, 1400] },
  { position: 35, type: 'station', name: 'Stazione Est', price: 200 },
  { position: 36, type: 'chance', name: 'Imprevisti' },
  { position: 37, type: 'property', name: 'Viale dei Giardini', group: 'blue', price: 350, houseCost: 200, rents: [35, 175, 500, 1100, 1300, 1500] },
  { position: 38, type: 'tax', name: 'Tassa di lusso', amount: 100 },
  { position: 39, type: 'property', name: 'Parco della Vittoria', group: 'blue', price: 400, houseCost: 200, rents: [50, 200, 600, 1400, 1700, 2000] },
];

const STATION_RENT = [25, 50, 100, 200]; // rent when 1/2/3/4 stations owned
const UTILITY_MULTIPLIER = { one: 4, both: 10 };

const CHANCE_CARDS = [
  { text: (goAmount) => `Avanza fino al Via. Incassi ${goAmount}.`, action: 'advance_to', target: 0 },
  { text: 'Vai a Largo Colombo.', action: 'advance_to', target: 24 },
  { text: (goAmount) => `Vai in Via Accademia. Se passi dal Via, incassi ${goAmount}.`, action: 'advance_to', target: 11 },
  { text: 'Avanza fino alla Stazione Sud.', action: 'advance_to', target: 5 },
  { text: 'Vai alla stazione più vicina, paga il doppio dell\'affitto se posseduta.', action: 'advance_to_nearest_station', rentMultiplier: 2 },
  { text: 'La banca ti paga un dividendo di 50.', action: 'collect', amount: 50 },
  { text: 'Usa questa carta per uscire di prigione gratis.', action: 'get_out_of_jail' },
  { text: 'Vai in prigione, non passare dal Via.', action: 'go_to_jail' },
  { text: 'Effettua riparazioni generali: 25 a casa, 100 a hotel.', action: 'repairs', perHouse: 25, perHotel: 100 },
  { text: 'Paga una multa di 15.', action: 'pay', amount: 15 },
  { text: 'Vai al Parco della Vittoria.', action: 'advance_to', target: 39 },
  { text: 'Vai indietro di 3 caselle.', action: 'move_back', spaces: 3 },
  { text: 'Sei eletto presidente del consiglio: paga ogni giocatore 50.', action: 'pay_each_player', amount: 50 },
  { text: 'La tua build matura: incassi 150.', action: 'collect', amount: 150 },
  { text: 'Paga la tassa scolastica di 150.', action: 'pay', amount: 150 },
  { text: 'Vai alla stazione più vicina.', action: 'advance_to_nearest_station', rentMultiplier: 1 },
];

const COMMUNITY_CARDS = [
  { text: 'Errore della banca a tuo favore. Incassi 200.', action: 'collect', amount: 200 },
  { text: 'Spese mediche: paga 50.', action: 'pay', amount: 50 },
  { text: 'Vendi azioni: incassi 50.', action: 'collect', amount: 50 },
  { text: (goAmount) => `Avanza fino al Via. Incassi ${goAmount}.`, action: 'advance_to', target: 0 },
  { text: 'Vinci il concorso di bellezza: incassi 10.', action: 'collect', amount: 10 },
  { text: 'Eredità: incassi 100.', action: 'collect', amount: 100 },
  { text: 'Rimborso assicurazione: incassi 100.', action: 'collect', amount: 100 },
  { text: 'Paga la retta scolastica: 50.', action: 'pay', amount: 50 },
  { text: 'È il tuo compleanno: ogni giocatore ti dà 10.', action: 'collect_from_each_player', amount: 10 },
  { text: 'Usa questa carta per uscire di prigione gratis.', action: 'get_out_of_jail' },
  { text: 'Vai in prigione, non passare dal Via.', action: 'go_to_jail' },
  { text: 'Paga le tasse per ogni casa (40) e hotel (115).', action: 'repairs', perHouse: 40, perHotel: 115 },
  { text: 'Ricevi un\'eredità: incassi 100.', action: 'collect', amount: 100 },
  { text: 'Multa per eccesso di velocità: paga 15.', action: 'pay', amount: 15 },
  { text: 'Fondo per il consorzio: incassi 25.', action: 'collect', amount: 25 },
  { text: 'Paga l\'assicurazione sulla vita: 100.', action: 'pay', amount: 100 },
];

module.exports = { board, GO_AMOUNT, COLOR_GROUPS, STATION_RENT, UTILITY_MULTIPLIER, CHANCE_CARDS, COMMUNITY_CARDS };
