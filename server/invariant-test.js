// Test a invarianti del motore di gioco: gioca migliaia di partite a mosse
// CASUALI e dopo ogni singola mossa verifica che certe affermazioni non possano
// mai essere false. Si lancia con `node invariant-test.js [partite] [seed]`
// dalla cartella server.
//
// PERCHÉ ESISTE, oltre a smoke-test.js
//
// smoke-test.js verifica i casi a cui abbiamo pensato: prepara una situazione,
// fa una mossa, controlla il risultato. È indispensabile, ma per costruzione
// non può trovare un bug in una situazione che non ci è venuta in mente. Tre
// dei guai peggiori di questo progetto sono passati sotto il suo naso proprio
// così:
//
//   - il blocco d'asta dei bot: tutti i test verdi, perché l'unica casella
//     coperta costava 60 e il bug scattava solo sopra i 120;
//   - i quattro modali che potevano non comparire, congelando la partita;
//   - i tre errori sul costo degli hotel, trovati andandoli a cercare a mano.
//
// Questo file rovescia l'approccio: non sa cosa dovrebbe succedere, ma sa cosa
// non deve MAI succedere. Le mosse le pesca a caso — comprese quelle illegali,
// che il motore deve rifiutare senza sporcare lo stato — e dopo ognuna
// ricontrolla tutte le invarianti. Funziona perché il motore è puro e
// sincrono: nessun timer, nessuna rete, migliaia di partite in pochi secondi.
//
// RIPRODUCIBILITÀ. Math.random è sostituito da un generatore con seme, così
// una violazione si può rigiocare identica: il messaggio d'errore stampa il
// comando esatto da rilanciare. Un fuzzer che trova un bug non riproducibile
// vale la metà.
const { GameEngine } = require('./src/gameEngine');
const { board } = require('./src/data/board');
const { botMove, botHasMove } = require('./src/bot');

// ---------------------------------------------------------------------------
// Generatore pseudocasuale con seme (mulberry32)
// ---------------------------------------------------------------------------
// Sostituisce Math.random per tutta la durata del test: il motore lo usa
// dentro (mescolata dei mazzi, dadi) e senza questo una partita che viola
// un'invariante non si potrebbe più ricostruire.
function creaRandom(seme) {
  let a = seme >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rnd = creaRandom(1);
Math.random = () => rnd();

const intero = (max) => Math.floor(rnd() * max); // 0..max-1
const scegli = (arr) => arr[intero(arr.length)];

// ---------------------------------------------------------------------------
// Oracolo indipendente per i valori economici
// ---------------------------------------------------------------------------
// Queste tabelle sono DELIBERATAMENTE duplicate da gameEngine.js invece di
// importarle. Se il test riusasse le funzioni del motore per verificare il
// motore, il controllo sarebbe circolare: un errore nella formula passerebbe
// inosservato perché entrambi i lati lo condividerebbero. È esattamente il bug
// che avevamo su liquidationValue (contava "numero di edifici × rimborso
// unico"), e un controllo circolare non lo avrebbe mai visto. Se qualcuno
// cambia i costi nel motore, questo test deve fallire e va aggiornato a mano:
// è il suo lavoro, non un fastidio.
const COSTO_HOTEL = { 1: 1, 2: 15, 3: 22, 4: 30 };

/** Costo dell'unità numero n (1-4 case, 5-8 livelli di hotel). */
function costoUnita(square, n) {
  return n <= 4 ? square.houseCost : square.houseCost * COSTO_HOTEL[n - 4];
}

/** Le unità davvero costruite su una casella, ricalcolate qui. */
function unitaCostruite(owned) {
  const u = [];
  if (owned.hotels > 0) for (let l = 1; l <= owned.hotels; l++) u.push(4 + l);
  else for (let c = 1; c <= owned.houses; c++) u.push(c);
  return u;
}

const unita = (owned) => (owned.hotels > 0 ? 4 + owned.hotels : owned.houses);
const valoreIpoteca = (square) => Math.floor(square.price / 2);
const costoRiscatto = (square) => valoreIpoteca(square) + Math.ceil(valoreIpoteca(square) / 10);

/** Patrimonio pieno, ricalcolato senza toccare il motore. */
function patrimonioAtteso(game, p) {
  let tot = p.balance;
  for (const [pos, owned] of Object.entries(game.ownership)) {
    if (owned.ownerId !== p.id) continue;
    const sq = board[Number(pos)];
    for (const n of unitaCostruite(owned)) tot += costoUnita(sq, n);
    tot += owned.mortgaged ? sq.price - costoRiscatto(sq) : sq.price;
  }
  return tot;
}

/** Valore di liquidazione, ricalcolato senza toccare il motore. */
function liquidazioneAttesa(game, p) {
  let tot = p.balance;
  for (const [pos, owned] of Object.entries(game.ownership)) {
    if (owned.ownerId !== p.id) continue;
    const sq = board[Number(pos)];
    for (const n of unitaCostruite(owned)) tot += Math.floor(costoUnita(sq, n) / 2);
    if (!owned.mortgaged) tot += valoreIpoteca(sq);
  }
  return tot;
}

// ---------------------------------------------------------------------------
// Le invarianti
// ---------------------------------------------------------------------------
// Ognuna torna null se va tutto bene, oppure una stringa che spiega cosa è
// andato storto. Il nome serve a sapere subito quale famiglia di bug è
// scattata quando il test fallisce.
// Chi è finito in rosso per gli interessi ereditati da una bancarotta altrui:
// unico caso in cui il motore ammette, per scelta dichiarata, un saldo
// negativo senza debito aperto. Si popola nel ciclo (dove si può osservare la
// causa del rosso, cosa che guardando solo lo stato non si potrebbe fare) e si
// svuota appena il giocatore torna in pari.
const esentatiDalDebito = new Set();

const INVARIANTI = [
  ['case-e-hotel-esclusivi', (g) => {
    // L'invariante introdotta con la modalità grattacieli: un hotel occupa il
    // posto delle quattro case, quindi non possono coesistere. Se si rompe,
    // significa che sono comparse "case fantasma" sotto un hotel — il bug
    // preciso di cui avevamo paura vendendo il secondo hotel.
    for (const [pos, o] of Object.entries(g.ownership)) {
      if (o.hotels > 0 && o.houses !== 0) return `casella ${pos}: ${o.hotels} hotel E ${o.houses} case`;
    }
    return null;
  }],

  ['edifici-nei-limiti', (g) => {
    const tetto = g.rules.skyscraperEnabled ? 4 : 1;
    for (const [pos, o] of Object.entries(g.ownership)) {
      if (o.houses < 0 || o.houses > 4) return `casella ${pos}: ${o.houses} case`;
      if (o.hotels < 0 || o.hotels > tetto) return `casella ${pos}: ${o.hotels} hotel (tetto ${tetto})`;
    }
    return null;
  }],

  ['edifici-solo-su-proprieta', (g) => {
    // Stazioni e società non si edificano: se ci finisce sopra un edificio,
    // l'affitto verrebbe calcolato con formule che non lo prevedono.
    for (const [pos, o] of Object.entries(g.ownership)) {
      if (unita(o) > 0 && board[Number(pos)].type !== 'property') {
        return `casella ${pos} (${board[Number(pos)].type}) ha ${unita(o)} unità`;
      }
    }
    return null;
  }],

  ['ipoteca-senza-edifici', (g) => {
    for (const [pos, o] of Object.entries(g.ownership)) {
      if (o.mortgaged && unita(o) > 0) return `casella ${pos} ipotecata con ${unita(o)} unità sopra`;
    }
    return null;
  }],

  ['uniformita-nel-gruppo', (g) => {
    // Si costruisce solo dove ce n'è di meno e si smonta da dove ce n'è di
    // più: dentro un colore due caselle non possono differire di più di una
    // unità. E siccome per costruire serve il monopolio (e uno scambio non
    // può muovere una proprietà con edifici sul colore), un colore che ha
    // edifici deve avere un unico proprietario.
    const gruppi = [...new Set(board.filter((s) => s.group).map((s) => s.group))];
    for (const gr of gruppi) {
      const caselle = board.filter((s) => s.group === gr);
      const conteggi = caselle.map((s) => (g.ownership[s.position] ? unita(g.ownership[s.position]) : 0));
      if (Math.max(...conteggi) === 0) continue; // nessun edificio: niente da dire
      const proprietari = new Set(caselle.map((s) => g.ownership[s.position]?.ownerId));
      if (proprietari.size !== 1 || proprietari.has(undefined)) {
        return `colore ${gr} ha edifici ma ${proprietari.size} proprietari`;
      }
      if (Math.max(...conteggi) - Math.min(...conteggi) > 1) {
        return `colore ${gr} non uniforme: ${conteggi.join('/')}`;
      }
    }
    return null;
  }],

  ['proprietario-esiste', (g) => {
    for (const [pos, o] of Object.entries(g.ownership)) {
      const p = g.players.find((x) => x.id === o.ownerId);
      if (!p) return `casella ${pos} appartiene a un giocatore inesistente (${o.ownerId})`;
      if (p.bankrupt) return `casella ${pos} appartiene a ${p.name}, che è in bancarotta`;
    }
    return null;
  }],

  ['azione-pendente-su-giocatore-valido', (g) => {
    // La famiglia del bug dei modali invisibili: se l'azione pendente aspetta
    // qualcuno che non può rispondere (inesistente o fallito), la partita si
    // congela per tutti e nessuno può farci niente.
    const pa = g.pendingAction;
    if (!pa) return null;
    const p = g.players.find((x) => x.id === pa.playerId);
    if (!p) return `${pa.type} aspetta un giocatore inesistente (${pa.playerId})`;
    if (p.bankrupt) return `${pa.type} aspetta ${p.name}, che è in bancarotta`;
    if (!p.connected && !p.isBot) return null; // offline è lecito: rientrerà
    return null;
  }],

  ['turno-su-giocatore-in-gioco', (g) => {
    // Il turno non può essere intestato a chi è fallito: nessuno giocherebbe
    // più quella mano e il tavolo resterebbe fermo per sempre. Aggiunta col
    // salto del turno di chi è disconnesso, che è il secondo punto del motore
    // (dopo abandonGame) a spostare la mano scavalcando endTurn: se un domani
    // uno di quei due la spostasse su un fallito, il fuzzer se ne accorge qui
    // invece che in partita.
    if (!g.started || g.finished) return null;
    // Tavolo degenere: senza nessuno in piedi advanceTurn si ferma apposta e
    // non c'è un giocatore valido su cui posare il turno.
    if (g.players.every((p) => p.bankrupt)) return null;
    const inTurno = g.currentPlayer;
    if (!inTurno) return `turnIndex ${g.turnIndex} non corrisponde a nessun giocatore`;
    // Con una finestra aperta il turno PUÒ momentaneamente restare su chi è
    // appena uscito di scena, e non è un blocco: chi abbandona nel mezzo di
    // un'asta iniziata da lui la lascia proseguire fra i rimanenti, e a
    // spostare la mano ci pensa closeAuction (che chiama finishRoll per conto
    // di chi aveva iniziato il giro). Questo test l'ha segnalato subito, ed è
    // stato verificato che sia una situazione di passaggio: il rilevatore di
    // stalli, che guarda proprio se lo stato smette di cambiare, non scatta
    // mai su queste partite. Quello che invece non deve mai succedere è
    // trovarsi col turno su un fallito e NESSUNA finestra aperta: lì non c'è
    // più niente e nessuno che possa far ripartire il giro.
    if (g.pendingAction) return null;
    if (inTurno.bankrupt) return `il turno è di ${inTurno.name}, che è in bancarotta, senza nulla in sospeso`;
    return null;
  }],

  ['saldo-negativo-solo-in-debito', (g) => {
    // Un saldo negativo è ammesso solo come debito aperto e dichiarato: se
    // qualcuno resta in rosso senza che il motore glielo stia chiedendo, il
    // gioco continua con un giocatore che non può pagare nulla.
    //
    // A partita finita non vale più: se l'host chiude il tavolo mentre
    // qualcuno stava coprendo un debito, quel rosso resta congelato lì e non
    // c'è più modo (né motivo) di saldarlo.
    if (g.finished) return null;
    for (const p of g.players) {
      if (p.bankrupt || p.balance >= 0) continue;
      // Il caso lecito e normale: il motore gli sta chiedendo di coprire.
      if (g.pendingAction?.type === 'awaiting_debt' && g.pendingAction.playerId === p.id) continue;
      // Eccezione nota e volontaria del motore, non un bug: quando erediti le
      // proprietà di chi è fallito verso di te, paghi subito il 10% di
      // interesse su quelle ipotecate, e quell'addebito è diretto — non apre
      // un secondo debito, per non incastrare due debiti uno dentro l'altro
      // nel mezzo di una bancarotta (vedi il commento in bankruptPlayer). Chi
      // eredita può quindi restare in rosso senza che nessuno glielo chieda,
      // finché non incassa. Il test lo tollera solo per chi è entrato in rosso
      // esattamente così, e solo finché non torna in pari: per ogni altra
      // strada l'invariante resta severa.
      if (esentatiDalDebito.has(p.id)) continue;
      return `${p.name} ha saldo ${p.balance} senza debito aperto (pendente: ${g.pendingAction?.type || 'nessuna'})`;
    }
    return null;
  }],

  ['fallito-e-a-zero', (g) => {
    for (const p of g.players) {
      if (!p.bankrupt) continue;
      if (p.balance !== 0) return `${p.name} è fallito ma ha saldo ${p.balance}`;
      const suoi = Object.values(g.ownership).filter((o) => o.ownerId === p.id).length;
      if (suoi > 0) return `${p.name} è fallito ma possiede ancora ${suoi} caselle`;
    }
    return null;
  }],

  ['turno-su-giocatore-vivo', (g) => {
    if (!g.started || g.finished) return null;
    const p = g.players[g.turnIndex];
    if (!p) return `turnIndex ${g.turnIndex} fuori dai giocatori`;
    // Il controllo vale solo a finestre chiuse, e la sfumatura è importante.
    // Mentre una finestra è aperta il turno è congelato per tutti comunque: se
    // chi lo teneva esce dal tavolo nel mezzo di un'asta (o di un debito altrui,
    // o di uno scambio fra altri due), il turno resta formalmente suo fino alla
    // chiusura. È uno stato di passaggio, brutto da vedere ma non bloccante.
    //
    // Che non sia bloccante, però, non è gratis: vale perché OGNI strada che
    // chiude una finestra sposta poi il turno se chi lo teneva non c'è più.
    //   - Asta: la chiude closeAuction, che richiama finishRoll. Qui il turno
    //     avanza sempre, e per una ragione precisa: con un'asta aperta
    //     `turnResolved` è per forza false. L'asta si apre solo da declineBuy,
    //     cioè con una finestra d'acquisto aperta, e quella esiste solo dentro
    //     la risoluzione di un tiro (rollDice azzera `turnResolved` come prima
    //     cosa; endTurn, l'unico che lo rialza, quando ci riesce chiude anche la
    //     finestra, e senza finestra non si può rinunciare). Misurato anche a
    //     campione: su decine di migliaia di aste giocate da questo fuzzer,
    //     `turnResolved` non è mai risultato alzato durante un'asta.
    //   - Debito e scambio: sono le uniche due finestre che possono riguardare
    //     giocatori DIVERSI da chi ha il turno, e lì la chiusura non spostava
    //     niente — respondTrade non tocca il turno per scelta, e il debito
    //     arriva sì a endTurn ma si fermava sulla guardia `turnResolved`,
    //     alzata dal giro precedente se chi ha abbandonato non aveva ancora
    //     tirato. Erano due partite bloccate per sempre; adesso ci pensa
    //     resumeTurnIfHolderLeft (vedi gameEngine.js).
    //
    // Il caso fatale è questo qui sotto: nessuna finestra aperta e il turno
    // intestato a chi non c'è più. Lì nessuno può muovere e la partita è finita
    // per sempre, senza che il gioco lo dica. Attenzione però a non fidarsi solo
    // di questo controllo (né di "nessuno-stallo", che pure se ne accorgerebbe):
    // quelle due partite bloccate non sono mai uscite da qui in milioni di mosse
    // casuali, perché serve una combinazione che il sorteggio delle mosse
    // pratica pochissimo (chi ha il turno abbandona mentre è aperta la finestra
    // di ALTRI due). Sono riprodotte a mano in smoke-test.js, nella sezione
    // sugli abbandoni che congelavano la partita.
    if (g.pendingAction) return null;
    if (p.bankrupt) return `tocca a ${p.name}, che è in bancarotta, e non c'è nessuna finestra aperta`;
    return null;
  }],

  ['montepremi-coerente', (g) => {
    if (g.freeParkingPot < 0) return `montepremi negativo: ${g.freeParkingPot}`;
    // Se la regola è spenta il montepremi non deve crescere mai: altrimenti
    // chi gioca senza la regola si vedrebbe pagare un premio inesistente.
    if (!g.rules.freeParkingEnabled && g.freeParkingPot !== 0) {
      return `montepremi ${g.freeParkingPot} con la regola spenta`;
    }
    return null;
  }],

  ['posizioni-valide', (g) => {
    for (const p of g.players) {
      if (!Number.isInteger(p.position) || p.position < 0 || p.position > 39) {
        return `${p.name} è in posizione ${p.position}`;
      }
    }
    return null;
  }],

  ['prigione-coerente', (g) => {
    for (const p of g.players) {
      if (!p.inJail && p.jailTurns !== 0) return `${p.name} non è in prigione ma jailTurns=${p.jailTurns}`;
      if (p.jailCards < 0) return `${p.name} ha ${p.jailCards} carte uscita`;
      if (p.inJail && p.position !== 10) return `${p.name} è in prigione ma in posizione ${p.position}`;
    }
    return null;
  }],

  ['patrimonio-ricalcolato', (g) => {
    // Il controllo che avrebbe beccato subito il terzo bug degli hotel: il
    // motore diceva 800 dove il valore vero era 7.200.
    for (const p of g.players) {
      const atteso = patrimonioAtteso(g, p);
      const dato = g.netWorth(p);
      if (dato !== atteso) return `patrimonio di ${p.name}: motore ${dato}, ricalcolato ${atteso}`;
    }
    return null;
  }],

  ['liquidazione-ricalcolata', (g) => {
    for (const p of g.players) {
      const atteso = liquidazioneAttesa(g, p);
      const dato = g.liquidationValue(p);
      if (dato !== atteso) return `liquidazione di ${p.name}: motore ${dato}, ricalcolato ${atteso}`;
    }
    return null;
  }],

  ['asta-coerente', (g) => {
    const pa = g.pendingAction;
    if (pa?.type !== 'awaiting_auction') return null;
    if (pa.currentBid < 0) return `offerta corrente negativa: ${pa.currentBid}`;
    // Chi ha passato non può essere ancora in gara, e chi deve rispondere
    // deve essere fra quelli in gara: è la forma del blocco d'asta che ci è
    // già costato una partita congelata.
    const doppi = pa.queue.filter((id) => pa.passedIds.includes(id));
    if (doppi.length) return `${doppi.length} giocatori sia in gara sia fra i passati`;
    if (pa.queue.length && !pa.queue.includes(pa.playerId)) {
      return `tocca a ${pa.playerId} che non è fra quelli in gara`;
    }
    for (const id of pa.queue) {
      const p = g.players.find((x) => x.id === id);
      if (!p || p.bankrupt) return `in gara c'è un giocatore fallito o inesistente (${id})`;
    }
    if (g.ownership[pa.position]) return `si sta battendo all'asta la casella ${pa.position}, che è già di qualcuno`;
    return null;
  }],

  ['fine-partita-coerente', (g) => {
    if (!g.finished) return null;
    if (g.winnerId) {
      const v = g.players.find((p) => p.id === g.winnerId);
      if (!v) return `vincitore inesistente (${g.winnerId})`;
      if (v.bankrupt) return `il vincitore ${v.name} è in bancarotta`;
    }
    if (g.pendingAction) return `partita finita ma resta un'azione pendente (${g.pendingAction.type})`;
    return null;
  }],

  ['mazzi-non-negativi', (g) => {
    if (g.chanceDeck.length < 0 || g.communityDeck.length < 0) return 'mazzo di lunghezza negativa';
    return null;
  }],
];

// ---------------------------------------------------------------------------
// Le mosse casuali
// ---------------------------------------------------------------------------
// Ogni voce torna una descrizione della mossa tentata (per il messaggio
// d'errore) ed esegue la chiamata. Gli argomenti sono spesso volutamente
// assurdi: il motore deve rispondere {error} senza toccare lo stato, e le
// invarianti lo verificano subito dopo.
function posizioneCasuale(g, playerId) {
  // Metà delle volte una casella davvero posseduta, metà una a caso: la prima
  // esplora le mosse legali, la seconda i rifiuti.
  const mie = Object.keys(g.ownership).filter((pos) => g.ownership[pos].ownerId === playerId).map(Number);
  if (mie.length && rnd() < 0.5) return scegli(mie);
  return intero(40);
}

const MOSSE = [
  (g, id) => ['rollDice', g.rollDice(id)],
  (g, id) => ['buyProperty', g.buyProperty(id)],
  (g, id) => ['declineBuy', g.declineBuy(id)],
  (g, id) => ['acknowledgeCard', g.acknowledgeCard(id)],
  (g, id) => ['payRent', g.payRent(id)],
  (g, id) => ['payTax', g.payTax(id)],
  (g, id) => ['payJailFine', g.payJailFine(id)],
  (g, id) => ['useJailCard', g.useJailCard(id)],
  (g, id) => { const p = posizioneCasuale(g, id); return [`buildHouse(${p})`, g.buildHouse(id, p)]; },
  (g, id) => { const p = posizioneCasuale(g, id); return [`sellHouse(${p})`, g.sellHouse(id, p)]; },
  (g, id) => { const p = posizioneCasuale(g, id); return [`mortgageProperty(${p})`, g.mortgageProperty(id, p)]; },
  (g, id) => { const p = posizioneCasuale(g, id); return [`unmortgageProperty(${p})`, g.unmortgageProperty(id, p)]; },
  (g, id) => ['resolveDebtAuto', g.resolveDebtAuto(id)],
  (g, id) => {
    // Offerte d'asta anche fuori scala: sotto il minimo, oltre il saldo,
    // negative, non interi. È il punto dove il motore si era già bloccato.
    const imp = scegli([-10, 0, 1, intero(300), intero(3000), 12.5, Number.NaN]);
    return [`bidAuction(${imp})`, g.bidAuction(id, imp)];
  },
  (g, id) => ['passAuction', g.passAuction(id)],
  (g, id) => ['respondTrade(sì)', g.respondTrade(id, true)],
  (g, id) => ['respondTrade(no)', g.respondTrade(id, false)],
  (g, id) => {
    // Proposte di scambio casuali: proprietà che non si possiedono, denaro che
    // non si ha, carte inesistenti, se stessi come destinatario.
    const altri = g.players.filter((p) => p.id !== id);
    const to = altri.length ? scegli(altri).id : id;
    const props = () => (rnd() < 0.5 ? [] : [intero(40)].concat(rnd() < 0.3 ? [intero(40)] : []));
    const soldi = () => scegli([0, 0, 1, intero(500), intero(5000), -50]);
    return ['proposeTrade', g.proposeTrade(id, {
      toId: to,
      offerProperties: props(),
      offerMoney: soldi(),
      offerJailCards: intero(3),
      requestProperties: props(),
      requestMoney: soldi(),
      requestJailCards: intero(3),
    })];
  },
  (g, id) => {
    // endTurn è l'unico metodo senza controllo di proprietà dentro il motore:
    // la guardia "è il tuo turno" sta nel server (vedi socket.on('end_turn')).
    // Qui si rispecchia quella guardia, altrimenti si testerebbe una chiamata
    // che nessun client può fare e i fallimenti sarebbero finti.
    if (g.currentPlayer?.id !== id) return ['endTurn(non è il suo turno, salta)', {}];
    return ['endTurn', g.endTurn()];
  },
  (g, id) => ['declareBankruptcy', g.declareBankruptcy(id)],
  (g) => {
    // Cadute e rientri di rete. Da soli non provano niente, ma senza qualcuno
    // che risulti offline il salto del turno qui sotto verrebbe sempre
    // rifiutato al primo controllo e quel codice non lo visiterebbe mai
    // nessuno. `connected` non entra nell'impronta dello stato (vedi impronta),
    // quindi questa mossa non maschera uno stallo facendolo sembrare
    // movimento.
    const p = scegli(g.players);
    const connesso = rnd() < 0.5;
    g.setConnected(p.id, connesso);
    return [`setConnected(${p.name}, ${connesso})`, {}];
  },
  (g, id) => {
    // Il tempo che il motore non misura da sé (vedi skipDisconnectedTurn):
    // valori sotto e sopra la soglia, così il fuzzer prova sia i rifiuti sia i
    // salti veri. Il salto è la seconda strada, dopo l'abbandono, che sposta il
    // turno scavalcando endTurn e che chiude finestre altrui: esattamente il
    // genere di mossa da cui sono già nati tre modi di congelare la partita.
    const fermoDaMs = scegli([0, 1, 30_000, 59_999, 60_000, 3_600_000]);
    // Chi chiede il salto: metà delle volte proprio l'attore di questa mossa
    // (che quasi sempre è chi ha il turno, e chiederlo per sé viene giustamente
    // rifiutato), metà delle volte un altro giocatore — altrimenti il fuzzer
    // proverebbe quasi soltanto quel rifiuto e i salti veri, quelli da cui
    // potrebbe nascere un blocco, resterebbero praticamente non visitati.
    const altri = g.players.filter((p) => p.id !== g.currentPlayer?.id && !p.bankrupt);
    const richiedente = rnd() < 0.5 && altri.length ? scegli(altri).id : id;
    return [`skipDisconnectedTurn(fermo da ${fermoDaMs}ms)`, g.skipDisconnectedTurn(richiedente, { fermoDaMs })];
  },
];

// Mosse che chiudono la partita: pescate raramente, altrimenti quasi ogni
// run finirebbe dopo poche mosse e le situazioni interessanti (monopoli,
// hotel, debiti) non si formerebbero mai.
const MOSSE_TERMINALI = [
  (g, id) => ['abandonGame', g.abandonGame(id)],
  (g, id) => ['endGame', g.endGame(id)],
];

// ---------------------------------------------------------------------------
// Il ciclo
// ---------------------------------------------------------------------------
const PARTITE = Number(process.argv[2]) || 2000;
const SEME_BASE = Number(process.argv[3]) || 20260730;
const MOSSE_PER_PARTITA = 400;

let violazioni = 0;
let mosseTotali = 0;
let mosseValide = 0;
const copertura = { hotelOltreIlPrimo: 0, debiti: 0, aste: 0, scambiAccettati: 0, bancarotte: 0, finite: 0, interessiEreditati: 0, turniSaltati: 0 };

// ---------------------------------------------------------------------------
// Rilevatore di stalli
// ---------------------------------------------------------------------------
// Le invarianti sopra guardano lo stato in un istante, e uno stallo non si vede
// così: ogni singola fotografia è perfettamente legale, il problema è che non
// cambia mai più. È esattamente la forma del blocco d'asta che ci è già
// costato una partita congelata — il motore rifiutava ogni offerta possibile,
// il rifiuto non cambiava nulla, e allo stesso giocatore veniva richiesto in
// eterno. Qui si tiene un'impronta dello stato: se non cambia per un numero di
// mosse pari a mezza partita, mentre la partita non è finita e i giocatori
// continuano a provare, allora non si sbloccherà mai da sé.
const MOSSE_PER_DICHIARARE_STALLO = 200;

function impronta(g) {
  return JSON.stringify([
    g.turnIndex,
    g.finished,
    g.freeParkingPot,
    g.players.map((p) => [p.balance, p.position, p.bankrupt, p.inJail, p.jailCards]),
    Object.entries(g.ownership).map(([pos, o]) => [pos, o.ownerId, o.houses, o.hotels, o.mortgaged]),
    g.pendingAction,
  ]);
}

function dump(g) {
  const righe = g.players.map((p) => `    ${p.name}: saldo ${p.balance}, pos ${p.position}${p.bankrupt ? ', FALLITO' : ''}`);
  const props = Object.entries(g.ownership)
    .map(([pos, o]) => `${pos}:${o.ownerId.slice(-2)}${o.hotels ? `/H${o.hotels}` : o.houses ? `/c${o.houses}` : ''}${o.mortgaged ? '/ip' : ''}`)
    .join(' ');
  return [
    `    regole: ${JSON.stringify(g.rules)}`,
    ...righe,
    `    pendente: ${JSON.stringify(g.pendingAction)}`,
    `    proprietà: ${props || '(nessuna)'}`,
    `    ultime righe di registro:`,
    ...g.log.slice(-4).map((l) => `      ${l.message}`),
  ].join('\n');
}

function segnala(seme, partita, mossa, nomeMossa, invariante, dettaglio, g) {
  violazioni += 1;
  console.log(`\n  VIOLAZIONE  ${invariante}`);
  console.log(`    ${dettaglio}`);
  console.log(`    partita ${partita}, mossa ${mossa}: ${nomeMossa}`);
  console.log(dump(g));
  console.log(`    per rigiocarla identica:  node invariant-test.js 1 ${seme}`);
}

console.log(`Test a invarianti: ${PARTITE} partite casuali, ${INVARIANTI.length + 2} invarianti, seme base ${SEME_BASE}\n`);

for (let partita = 0; partita < PARTITE && violazioni < 5; partita++) {
  const seme = SEME_BASE + partita;
  rnd = creaRandom(seme);
  esentatiDalDebito.clear(); // le esenzioni non passano da una partita all'altra

  const game = new GameEngine('INV');
  const pedoni = ['🎩', '🐕', '🚗', '🚢', '🐈', '🎸'];
  const quanti = 2 + intero(5); // da 2 a 6 giocatori
  // Giocatori artificiali, non perché interessi provare i bot, ma perché
  // botMove è un generatore di mosse SENSATE: le mosse a caso da sole non
  // arrivano quasi mai a un monopolio, e senza monopoli non si costruisce, non
  // si pagano affitti grossi e non nascono debiti. Con sole mosse casuali la
  // copertura misurata era zero debiti, zero secondi hotel e due scambi su
  // diecimila mosse: un test che passa su partite banali non prova nulla. Il
  // motore non distingue un bot da un umano (isBot serve solo al server per le
  // pause), quindi le mosse restano quelle che farebbe una persona.
  for (let i = 0; i < quanti; i++) game.addBot(`G${i}`, pedoni[i]);
  // Regole casuali a ogni partita: così le invarianti vengono provate sia con
  // la modalità grattacieli accesa sia spenta, e con ogni combinazione delle
  // altre — è lì che vivono le interazioni che nessuno prova a mano.
  game.setRules(game.hostId, {
    goAmount: scegli([200, 500]),
    startingBalance: scegli([1000, 1500, 2000]),
    freeParkingEnabled: rnd() < 0.5,
    auctionEnabled: rnd() < 0.5,
    skyscraperEnabled: rnd() < 0.5,
  });
  game.start();

  let improntaPrecedente = impronta(game);
  let mosseSenzaCambiamenti = 0;

  for (let mossa = 0; mossa < MOSSE_PER_PARTITA; mossa++) {
    if (game.finished) { copertura.finite += 1; break; }

    // Chi muove: di solito chi deve rispondere a un'azione pendente o chi ha
    // il turno, ma un quinto delle volte un giocatore a caso — le mosse fuori
    // turno devono essere rifiutate, non eseguite di straforo.
    const vivi = game.players.filter((p) => !p.bankrupt);
    if (!vivi.length) break;
    let attore;
    if (rnd() < 0.2) attore = scegli(vivi);
    else if (game.pendingAction) attore = game.pendingAction.playerId;
    else attore = game.currentPlayer?.id || scegli(vivi).id;
    if (typeof attore === 'object') attore = attore.id;

    // Due terzi delle mosse le decide la strategia dei bot, che fa avanzare la
    // partita verso le situazioni che ci interessano (monopoli, hotel, affitti
    // salati, debiti, bancarotte); il terzo restante è pescato a caso, spesso
    // illegale, ed è quello che sonda i confini. Senza la prima metà il test
    // non arriverebbe mai nei posti interessanti; senza la seconda non
    // proverebbe altro che ciò che i bot già fanno.
    const mossaDelBot = rnd() < 0.66 && botHasMove(game);

    // Stato di riferimento per i controlli che confrontano prima e dopo.
    const cassaPrima = game.players.reduce((s, p) => s + p.balance, 0);
    const fallitiPrima = game.players.filter((p) => p.bankrupt).length;
    const saldiPrima = new Map(game.players.map((p) => [p.id, p.balance]));
    const eraAsta = game.pendingAction?.type === 'awaiting_auction';
    const eraScambio = game.pendingAction?.type === 'awaiting_trade';
    // Uno scambio che fa cambiare mano a una proprietà IPOTECATA non è un
    // trasferimento puro: chi la riceve paga alla banca il 10% di interesse
    // (vedi chargeMortgageInterest), quindi del denaro esce davvero dalle
    // tasche dei giocatori. La prima versione di questo test non lo sapeva e
    // segnalava il motore come colpevole: l'errore era qui, non lì.
    const scambioConIpoteche = eraScambio && [
      ...(game.pendingAction.offerProperties || []),
      ...(game.pendingAction.requestProperties || []),
    ].some((pos) => game.ownership[pos]?.mortgaged);
    const eraDebito = game.pendingAction?.type === 'awaiting_debt';
    const eraAffitto = game.pendingAction?.type === 'awaiting_rent';
    // Il contatore del motore, non il mio: gli scambi accettati dai bot
    // avvengono dentro botMove e da fuori non si vedrebbero.
    const scambiPrima = game.stats.tradesCompleted;

    let nomeMossa;
    let esito;
    try {
      if (mossaDelBot) {
        botMove(game);
        nomeMossa = 'botMove';
        esito = {};
      } else {
        const azione = scegli(rnd() < 0.01 ? MOSSE_TERMINALI : MOSSE);
        [nomeMossa, esito] = azione(game, attore);
      }
    } catch (e) {
      // Un'eccezione è già di per sé una violazione: il motore deve rifiutare
      // le mosse impossibili con {error}, non esplodere. Con lo stack, perché
      // qui il punto esatto conta più del nome della mossa.
      segnala(seme, partita, mossa, mossaDelBot ? 'botMove' : 'mossa casuale', 'nessuna-eccezione',
        `il motore ha lanciato: ${e.message}\n    ${(e.stack || '').split('\n')[1]?.trim() || ''}`, game);
      break;
    }
    mosseTotali += 1;
    if (!esito?.error) mosseValide += 1;

    // Copertura: serve a sapere se il fuzzer sta davvero visitando le
    // situazioni interessanti. Un test che gira su partite banali non prova
    // nulla, anche se passa.
    if (eraAsta) copertura.aste += 1;
    if (eraDebito) copertura.debiti += 1;
    if (nomeMossa.startsWith('skipDisconnectedTurn') && !esito?.error) copertura.turniSaltati += 1;
    if (game.stats.tradesCompleted > scambiPrima) copertura.scambiAccettati += 1;
    if (Object.values(game.ownership).some((o) => o.hotels > 1)) copertura.hotelOltreIlPrimo += 1;
    const fallitiOra = game.players.filter((p) => p.bankrupt).length;
    if (fallitiOra > fallitiPrima) copertura.bancarotte += 1;

    // Aggiornamento delle esenzioni (vedi esentatiDalDebito): chi va in rosso
    // NELLA STESSA mossa in cui qualcuno è fallito è chi ha ereditato le
    // ipoteche e ne ha pagato l'interesse. È l'unico modo di distinguere quel
    // rosso lecito da tutti gli altri: la causa si vede solo guardando cosa è
    // appena successo, non lo stato finale.
    for (const p of game.players) {
      if (p.balance >= 0) esentatiDalDebito.delete(p.id);
      else if (fallitiOra > fallitiPrima && (saldiPrima.get(p.id) ?? 0) >= 0 && !p.bankrupt) {
        esentatiDalDebito.add(p.id);
        copertura.interessiEreditati += 1;
      }
    }

    // Conservazione del denaro sui puri trasferimenti: affitto e scambio
    // accettato spostano denaro fra giocatori senza coinvolgere la banca,
    // quindi il totale in mano ai giocatori non può cambiare. Vale solo se
    // nessuno è fallito nel frattempo: la bancarotta azzera il saldo del
    // fallito e riaggiusta quello del creditore, e lì il totale cambia per
    // costruzione.
    const trasferimentoPuro =
      !esito?.error && fallitiOra === fallitiPrima &&
      ((eraAffitto && nomeMossa === 'payRent') ||
       (eraScambio && !scambioConIpoteche && nomeMossa === 'respondTrade(sì)'));
    if (trasferimentoPuro) {
      const cassaDopo = game.players.reduce((s, p) => s + p.balance, 0);
      if (cassaDopo !== cassaPrima) {
        segnala(seme, partita, mossa, nomeMossa, 'denaro-conservato-nei-trasferimenti',
          `la cassa complessiva è passata da ${cassaPrima} a ${cassaDopo} (differenza ${cassaDopo - cassaPrima})`, game);
        break;
      }
    }

    // Stallo: lo stato non si muove più di una virgola, mossa dopo mossa.
    const improntaOra = impronta(game);
    if (improntaOra === improntaPrecedente) {
      mosseSenzaCambiamenti += 1;
      if (mosseSenzaCambiamenti >= MOSSE_PER_DICHIARARE_STALLO) {
        segnala(seme, partita, mossa, nomeMossa, 'nessuno-stallo',
          `lo stato non cambia da ${mosseSenzaCambiamenti} mosse: la partita non si sbloccherà più`, game);
        break;
      }
    } else {
      mosseSenzaCambiamenti = 0;
      improntaPrecedente = improntaOra;
    }

    let rotta = false;
    for (const [nome, controlla] of INVARIANTI) {
      let dettaglio;
      try {
        dettaglio = controlla(game);
      } catch (e) {
        dettaglio = `il controllo stesso è andato in errore: ${e.message}`;
      }
      if (dettaglio) {
        segnala(seme, partita, mossa, nomeMossa, nome, dettaglio, game);
        rotta = true;
        break;
      }
    }
    if (rotta) break;
  }
}

console.log(`Mosse tentate:            ${mosseTotali}`);
console.log(`  di cui accettate:       ${mosseValide} (${Math.round((mosseValide / mosseTotali) * 100)}%)`);
console.log(`  di cui rifiutate:       ${mosseTotali - mosseValide} — il motore le ha respinte senza rompersi`);
console.log(`\nCopertura (mosse viste in ciascuna situazione):`);
console.log(`  aste in corso:          ${copertura.aste}`);
console.log(`  debiti aperti:          ${copertura.debiti}`);
console.log(`  scambi accettati:       ${copertura.scambiAccettati}`);
console.log(`  con più di un hotel:    ${copertura.hotelOltreIlPrimo}`);
console.log(`  bancarotte:             ${copertura.bancarotte}`);
console.log(`  turni saltati:          ${copertura.turniSaltati} (di giocatori disconnessi, vedi skipDisconnectedTurn)`);
console.log(`  partite concluse:       ${copertura.finite}`);
console.log(`  rossi da interesse:     ${copertura.interessiEreditati} (eccezione nota, vedi saldo-negativo-solo-in-debito)`);

if (violazioni === 0) {
  console.log(`\n${INVARIANTI.length + 2} invarianti verificate dopo ognuna delle ${mosseTotali} mosse: nessuna violazione.`);
  process.exit(0);
}
console.log(`\n${violazioni} violazioni (il test si ferma alla quinta).`);
process.exit(1);
