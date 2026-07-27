# Bot: giocatori artificiali

Data: 2026-07-27
Stato: approvato

Aggiunge la possibilità di riempire il tavolo con giocatori artificiali,
gestiti dal server, per giocare anche quando non ci sono abbastanza umani.

## Decisioni prese

| Scelta | Decisione |
| --- | --- |
| Motore decisionale | Euristica scritta a mano, gratuita, nessuna chiave API |
| Come si aggiungono | Bottone in lobby, solo per chi ha creato il tavolo, prima dell'inizio |
| Personalità | Una sola strategia curata, non più profili diversi |
| Ritmo di gioco | ~1 secondo di pausa prima di ogni azione visibile |
| Scambi | Il bot risponde alle offerte ricevute e ogni tanto ne propone lui |
| "Addestramento" | Nessun training ML: calibrazione tramite simulazioni bot-contro-bot |

Principio guida, dato esplicitamente dall'utente: il bot deve sembrare il più
umano possibile, ma **non deve essere imbattibile**. Ogni soglia della sezione
4 include un margine di casualità o di tolleranza apposta per questo.

## 1. Perché non un'IA vera

Discusso e concordato con l'utente: un bot addestrato su partite vere (video,
reinforcement learning) richiederebbe un sistema di visione artificiale per
estrarre dati da video, un ciclo di training con milioni di partite simulate,
e un servizio di inferenza da ospitare — tre pezzi di infrastruttura che il
progetto, nato per girare gratis su Render free-tier e Vercel, non ha motivo
di sostenere. Per un gioco con questa quantità di fortuna pura (dadi, carte)
il guadagno di un'IA allenata rispetto a un'euristica ben calibrata è comunque
piccolo.

Al posto del training vero, due cose fattibili e già nello spirito del
progetto:

- **Sapienza statistica nota su Monopoli**, incorporata nei pesi
  dell'euristica (sezione 4): quali gruppi rendono di più per posizione, non
  solo per prezzo.
- **Calibrazione tramite simulazione**: centinaia di partite bot-contro-bot
  giocate in locale (sezione 6) per tarare le soglie sui dati, non a occhio.

## 2. Architettura

Il motore di gioco (`gameEngine.js`) resta **puro e sincrono**: nessun timer,
nessuna I/O. È il motivo per cui i suoi test girano in un istante, e non deve
smettere di essere così.

Il bot vive in un modulo nuovo, `server/src/bot.js`, che **non fa nulla che un
client umano non potrebbe fare**: chiama gli stessi metodi pubblici del
`GameEngine` (`rollDice`, `buyProperty`, `payRent`, `payTax`,
`resolveDebtAuto`, `respondTrade`, `proposeTrade`, `buildHouse`, `endTurn`,
`acknowledgeCard`, `requestRematch`...). Nessun percorso privilegiato, nessuna
regola diversa da quella di un giocatore vero.

Il collegamento sta in `server.js`, dentro `broadcastState`: dopo ogni
cambiamento di stato, si controlla se un bot deve muovere — è il suo turno, o
un `pendingAction` lo riguarda (un affitto da pagare, un debito da saldare,
uno scambio da valutare) — e in quel caso si schedula la sua mossa con
`setTimeout` (il ritmo della sezione 3), poi si ribroadcasta.

Un timer per stanza (`room.botTimer`) evita di schedulare due mosse dello
stesso bot in sovrapposizione se lo stato cambia più volte di fila: prima di
schedulare si annulla quello eventualmente già in coda.

Un'avvertenza per l'implementazione: alcuni controlli che i client umani danno
per scontati **non stanno nel motore ma nel gestore socket**. Per esempio
`end_turn` verifica in `server.js` che sia il turno di chi lo chiede, mentre
`GameEngine.endTurn()` non lo fa. Il bot chiama i metodi del motore
direttamente, quindi deve verificare da sé queste condizioni prima di agire,
altrimenti potrebbe chiudere il turno di qualcun altro.

Scartate in fase di discussione: far decidere al motore stesso quando muove un
bot (comprometterebbe la sua natura sincrona e testabile), un servizio esterno
che polla lo stato (complessità sproporzionata per queste dimensioni).

## 3. Modello dati

Ogni giocatore guadagna un campo `isBot: boolean` (default `false`). I bot si
aggiungono con un nuovo metodo `GameEngine.addBot(name, token)`, che genera un
id interno (`bot-` + un contatore incrementale nella stanza) e riusa
`addPlayer` per il resto — stessa validazione su pedone occupato e tetto di
sei giocatori già esistente.

Un bot ha `connected: true` fisso: non ha un socket da perdere, quindi non
serve gestirgli riconnessioni o l'etichetta "disconnesso" che vale per gli
umani.

`hostId` non è mai un bot: il creatore del tavolo è sempre il primo umano che
si siede, e solo lui vede il bottone per aggiungerli o rimuoverli.

## 4. Lobby: aggiungere e rimuovere bot

Nella schermata di attesa, sotto la lista dei giocatori, chi ha creato il
tavolo vede **"+ Aggiungi bot"**. Ogni clic emette un nuovo evento socket
`add_bot` che chiama `addBot` con un nome dalla lista `BOT_NAMES` (es. "Bot
Aurelio", "Bot Cleopatra"...) e il primo pedone libero. Il bottone si
disabilita al tetto di sei giocatori, come già succede per l'ingresso umano.

Ogni bot in lista ha una "✕", visibile solo all'host, che chiama `remove_bot`
per toglierlo prima dell'inizio. Rimuovere un bot a partita già iniziata non è
previsto (vedi Fuori scope).

Durante la partita i bot compaiono nei pannelli come chiunque altro, con
un'etichetta **"BOT"** accanto al nome, per non confonderli con un umano che
si è solo disconnesso.

## 5. L'euristica

Ogni azione visibile del bot è preceduta da ~1 secondo di pausa, per restare
leggibile nel registro.

**Pesi dei gruppi.** Non si valuta una proprietà solo dal prezzo di listino:

- **Arancioni** (posizioni 16-18-19): il gruppo più redditizio in assoluto, a
  6-8-9 caselle dalla prigione, la casella più visitata del tabellone (multe,
  tris di doppi, carte "vai in prigione"). Peso più alto.
- **Stazioni**: rendimento sicuro, nessun rischio di liquidità perché non
  richiedono mai di costruire. Peso medio-alto, stabile.
- **Blu** (Viale dei Giardini, Parco della Vittoria): il rendimento più alto
  per casella, ma un cattivo investimento nei primi turni per il prezzo
  elevato. Peso che cresce con la cassa disponibile del bot, basso a inizio
  partita.
- Gli altri gruppi hanno un peso intermedio proporzionale alla loro posizione
  reale sul tabellone.

**Le decisioni:**

| Situazione | Comportamento |
| --- | --- |
| Suo turno, nessun `pendingAction` | Tira i dadi |
| In prigione con carta "esci gratis" | La usa sempre |
| In prigione, può pagare la multa | Paga se il saldo residuo resta sopra soglia; nel 20% dei casi tenta comunque i dadi anche potendo pagare |
| Proprietà libera (`awaiting_buy`) | Compra se il punteggio (valore atteso ÷ prezzo, bonus se completa un monopolio) supera una soglia con ±10% di margine casuale, e se resta un fondo cassa minimo dopo |
| Ha un monopolio e cassa sufficiente | Costruisce a inizio turno, prima di tirare, al massimo una casa per turno e solo se il saldo residuo resta sopra soglia |
| Affitto o tassa da pagare | Paga sempre, senza esitazione |
| Carta pescata | Conferma sempre (`acknowledgeCard`) |
| Debito aperto (`awaiting_debt`) | Chiama sempre `resolveDebtAuto`; se il patrimonio non basta il motore dichiara bancarotta da solo |
| Nessun'altra azione possibile | Chiude il turno (`endTurn`) |

## 6. Scambi

**Valutare un'offerta ricevuta.** Stima il valore di ciò che darebbe contro
ciò che riceverebbe (prezzi di listino, denaro, carte uscita), con un forte
bonus se la proprietà ricevuta completa un suo monopolio e un forte malus se
cedere una proprietà romperebbe un monopolio che possiede già. Accetta anche
scambi leggermente sfavorevoli entro un piccolo margine di tolleranza —
un giocatore vero non calcola al centesimo — e rifiuta quelli chiaramente in
perdita.

**Proporre uno scambio.** Il motore consente di proporre in qualsiasi momento,
purché non ci sia un `pendingAction` aperto: non serve che sia il proprio
turno. Il bot sfrutta l'inizio del proprio turno, subito **prima** di tirare i
dadi — dopo un tiro non-doppio il motore chiude il turno da solo, quindi una
finestra "ho già mosso, ora tratto" non esisterebbe, ed è comunque l'ordine
più naturale da guardare: sistemo le mie cose, poi muovo. Con probabilità
del 30% cerca una proprietà altrui che gli completerebbe un monopolio e
compone un'offerta onesta — denaro e/o una
propria proprietà "di scarto" (fuori da gruppi che possiede già per intero) di
valore comparabile o leggermente superiore a quanto chiede. Se non trova nulla
di sensato da offrire, non propone nulla quel turno — niente proposte a vuoto
o palesemente inique.

## 7. Casi limite

- **Rivincita**: la partita richiede il voto di tutti i giocatori rimasti. Un
  bot vota sempre sì, subito: altrimenti bloccherebbe per sempre il voto degli
  umani in attesa di un consenso che non arriverebbe mai.
- **Abbandono e chiusura del tavolo**: azioni riservate all'interfaccia
  umana. Il bot non le chiama mai; se va in rosso senza scampo, il motore lo
  dichiara fallito da solo, come per chiunque.
- **Connessione**: sempre `true`, un bot non si disconnette.
- **Host**: mai un bot.

## 8. Calibrazione

Uno script nuovo, `server/bot-calibration.js`, nello spirito di
`smoke-test.js` ma con un obiettivo diverso: non asserzioni pass/fail, ma
statistiche su centinaia di partite bot-contro-bot giocate in sequenza.

Misura: le vittorie sono vicine al 50/50 fra bot con parametri identici (se
non lo sono, c'è un bias di turno o di ordine da correggere)? Le partite
durano un tempo ragionevole, né troppo brevi né interminabili? Nessun bot si
rovina comprando alla cieca nei primi turni? Le soglie della sezione 5 si
aggiustano sulla base di questi numeri, non a occhio.

Oltre alla calibrazione, `smoke-test.js` guadagna una sezione di test mirati
in stile classico: dato uno stato di gioco precostruito, verificare che il bot
prenda la decisione attesa (con un monopolio completo e cassa abbondante
costruisce; davanti a uno scambio nettamente sfavorevole rifiuta; in debito
copribile lo salda da solo).

## Fuori scope

- **Aggiungere o rimuovere bot a partita già iniziata.** Solo in lobby, prima
  di "Inizia partita". Estenderlo in seguito è un cambiamento piccolo (stesso
  `addBot`/`remove_bot`, solo senza il vincolo "prima dell'inizio"), ma non
  è stato richiesto ora.
- **Personalità multiple.** Un solo profilo di gioco per tutti i bot, come
  deciso in fase di brainstorming.
- **Qualunque forma di training o IA generativa** per le decisioni: discusso
  ed escluso nella sezione 1.
