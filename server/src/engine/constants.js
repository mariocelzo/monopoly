// Costanti di regolamento, estratte qui perché servono a più moduli del
// motore (pricing, turno, aste, costruzioni, prigione, disconnessione) senza
// che debbano importarsi a vicenda. Nessun valore o commento è cambiato: sono
// le stesse costanti che stavano in cima a gameEngine.js, spostate senza
// toccarle.
const STARTING_BALANCE = 1500;
const JAIL_POSITION = 10;
const GO_TO_JAIL_POSITION = 30;
const JAIL_FINE = 50;
const MAX_JAIL_TURNS = 3;
// Oltre sei il tabellone diventa illeggibile e i colori finiscono.
const MAX_PLAYERS = 6;

// Regole della casa: valori ammessi per le opzioni a scelta multipla (vedi
// setRules). Un solo elenco, letto sia dalla validazione sia da chi genera i
// default: così un valore "inventato" da un client malevolo o da un bug non
// può mai finire dentro this.rules, a differenza degli interruttori on/off
// (freeParkingEnabled, auctionEnabled) che sono booleani e non hanno bisogno
// di un elenco. 200 è l'importo da regolamento, 500 è quello con cui il
// tavolo ha sempre giocato finora (vedi GO_AMOUNT in board.js, che resta il
// default). Il saldo iniziale ufficiale è 1500; 1000 accorcia la partita
// (si fallisce prima), 2000 la allunga (più margine prima della bancarotta).
const GO_AMOUNT_OPTIONS = [200, 500];
const STARTING_BALANCE_OPTIONS = [1000, 1500, 2000];

// Al terzo doppio consecutivo si va in prigione senza muoversi.
const MAX_DOUBLES = 3;

// Da quanto deve essere fermo il turno di un giocatore DISCONNESSO prima che
// gli altri possano saltarlo (vedi skipDisconnectedTurn). Il tempo lo misura
// la stanza, non il motore — qui c'è solo la soglia, che è una regola del
// gioco come le altre e quindi vive con loro.
//
// Un minuto è il compromesso fra i due modi di sbagliare:
//  - troppo corto e il comando comparirebbe a ogni singhiozzo di rete. Un
//    telefono che passa dal wifi ai dati, un tunnel, un'app tornata in primo
//    piano: socket.io si riconnette da solo con qualche tentativo ravvicinato,
//    questione di pochi secondi, e in quella finestra nessuno deve poter
//    saltare il turno di chi in realtà sta tornando;
//  - troppo lungo e il rimedio non serve a niente. La serata è il metro: chi
//    resta a guardare un tabellone fermo si stufa in fretta, e a quel punto
//    tanto varrebbe chiudere il tavolo — cioè esattamente il male che questa
//    funzionalità esiste per evitare.
// Il minuto va contato dal più recente fra "è iniziato il suo turno" e "è
// caduta la sua connessione" (vedi stalledTurnMs in rooms.js): chi cade a metà
// di un turno lungo non deve poter essere saltato all'istante solo perché il
// turno era cominciato da un pezzo. E il conto vero è comunque più lungo di
// così: socket.io ci mette fino a una ventina di secondi ad accorgersi che il
// telefono non risponde più, e il comando chiede comunque una conferma.
const SKIP_TURN_DELAY_MS = 60 * 1000;

// Interesse del 10% che la banca trattiene sulle ipoteche: si paga per
// riscattare una proprietà e per riceverne una già ipotecata, sia in uno
// scambio sia in una bancarotta. È espresso come frazione intera perché con i
// decimali `100 * 1.1` vale 110.00000000000001 e Math.ceil arrotonda a 111.
const MORTGAGE_INTEREST_NUM = 1;
const MORTGAGE_INTEREST_DEN = 10;


// Modalità grattacieli (regola della casa, spenta di default, vedi
// rules.skyscraperEnabled): fino a quattro hotel per proprietà invece di uno
// solo, a prezzi e affitti crescenti. A regola spenta il tetto resta 1,
// esattamente come da regolamento classico e come si è sempre giocato finora
// (vedi buildHouse, l'unico punto che legge questi due tetti).
const MAX_HOTELS_SKYSCRAPER = 4;
const MAX_HOTELS_CLASSIC = 1;
// Moltiplicatore di costo per ciascun livello di hotel, applicato a
// houseCost della casella (vedi buildingCost). Il 1° hotel sostituisce le
// quattro case e costa come una singola casa (moltiplicatore 1: è il
// comportamento di sempre, invariato). Il 2°, 3° e 4° costano rispettivamente
// 15, 22 e 30 volte una casa: numeri concordati al tavolo, non ricavati da
// una formula, per tenere ogni livello un salto deciso rispetto al
// precedente senza dover ricorrere all'asta per finanziarlo.
const HOTEL_COST_MULTIPLIER = { 1: 1, 2: 15, 3: 22, 4: 30 };

// Moltiplicatore d'affitto per ciascun livello di hotel, applicato
// all'affitto dell'hotel singolo (square.rents[5]) e arrotondato ai 25 più
// vicini (vedi hotelRent). Con un solo hotel il moltiplicatore è 1: dato che
// in board.js ogni rents[5] è già multiplo di 25, l'arrotondamento non cambia
// nulla e l'affitto resta letteralmente quello di sempre.
const HOTEL_RENT_MULTIPLIER = { 1: 1, 2: 1.7, 3: 2.5, 4: 3.5 };

module.exports = {
  STARTING_BALANCE, JAIL_POSITION, GO_TO_JAIL_POSITION, JAIL_FINE,
  MAX_JAIL_TURNS, MAX_PLAYERS, GO_AMOUNT_OPTIONS, STARTING_BALANCE_OPTIONS,
  MAX_DOUBLES, SKIP_TURN_DELAY_MS, MORTGAGE_INTEREST_NUM, MORTGAGE_INTEREST_DEN,
  MAX_HOTELS_SKYSCRAPER, MAX_HOTELS_CLASSIC, HOTEL_COST_MULTIPLIER, HOTEL_RENT_MULTIPLIER,
};
