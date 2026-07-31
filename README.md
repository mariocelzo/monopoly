# Noi Due Monopoly

Monopoli da 2 a 6 giocatori via browser, con motore di regole automatico.
Niente webcam, niente app da installare: si crea un tavolo, si passa un codice
di cinque caratteri e si gioca.

## Come funziona

Tutta la logica e la validazione stanno sul server (`server/src/gameEngine.js`).
Il client mostra lo stato e manda intenti: non duplica nessuna regola, e ogni
azione viene comunque ricontrollata dal motore.

L'unica decisione davvero manuale è l'acquisto di una proprietà. Affitti,
monopoli, carte, prigione, interessi e bancarotta si applicano da soli.

## Bot

Chi crea il tavolo può riempire i posti vuoti con giocatori artificiali, dal
bottone **"+ Aggiungi bot"** nella schermata d'attesa. Si aggiungono e si
tolgono solo prima del via; a partita iniziata i posti sono quelli.

I bot decidono con un'euristica scritta a mano (`server/src/botStrategy.js`),
senza chiavi API e senza costi. I pesi non seguono il prezzo di listino ma la
resa reale: gli arancioni valgono più di tutti perché stanno a 6-8-9 caselle
dalla prigione, la casella più visitata del tabellone.

Non sono imbattibili, apposta: la soglia d'acquisto ha un margine casuale del
±10%, nel 20% dei casi tentano i dadi in prigione anche potendo pagare la
multa, e propongono scambi solo in un turno su tre.

```bash
cd server && node bot-calibration.js 200      # due bot
cd server && node bot-calibration.js 150 4    # quattro bot
```

Lo script fa giocare N partite di soli bot e riporta quante si concludono, in
quante mosse, quante proprietà finiscono assegnate e come si distribuiscono le
vittorie. Serve a tarare le soglie sui numeri invece che a occhio: fra bot
identici le vittorie devono stare vicino a 1/N, altrimenti c'è uno squilibrio
da correggere.

## Avvio in locale

Servono Node 20 o superiore e due terminali.

```bash
cd server && npm install && npm start
```

```bash
cd client && npm install && npm run dev
```

Il server ascolta sulla 3001, il client sulla 5173. Aprendo due schede si può
giocare da soli contro sé stessi — ma essendo l'identità legata al browser,
servono due profili diversi o due dispositivi per avere due giocatori distinti.

## Test

Nessun framework: uno script che esercita il motore e stampa le asserzioni.

```bash
cd server && node smoke-test.js
```

Va eseguito prima e dopo ogni modifica sostanziale a `gameEngine.js`. La suite
include una partita simulata di 300 turni e i bot usano la casualità, quindi
conviene lanciarla più volte.

### Test a invarianti

`smoke-test.js` verifica i casi a cui abbiamo pensato. Questo verifica quelli a
cui non abbiamo pensato: gioca migliaia di partite a mosse casuali — comprese
quelle illegali, che il motore deve rifiutare senza sporcare lo stato — e dopo
**ogni singola mossa** ricontrolla venti affermazioni che non devono mai poter
essere false (un hotel non convive con delle case, un saldo negativo esiste solo
come debito aperto, il patrimonio ricalcolato da fuori coincide con quello del
motore, la partita non si blocca mai in uno stato da cui nessuno può muovere…).

```bash
cd server && node invariant-test.js            # 2000 partite
cd server && node invariant-test.js 1500 777   # 1500 partite, seme 777
```

Il seme conta: partite diverse esplorano strade diverse, quindi vale la pena
lanciarlo con qualche seme diverso e non solo col predefinito. Quando trova una
violazione stampa lo stato, le ultime righe di registro e il comando esatto per
rigiocare identica quella partita.

Ha già trovato tre modi di congelare una partita che i test tradizionali non
vedevano, tutti attorno a chi lascia il tavolo; i casi corrispondenti sono ora
fissati anche in `smoke-test.js`, perché un fuzzer con un altro seme potrebbe
non ripassare da quelle strade.

### Test della persistenza

```bash
cd server && node persistence-test.js
```

Salvataggio, ripristino e comportamento quando l'archivio esterno fa i capricci.
Usa un client Redis finto in memoria: non serve nessun Redis acceso. I dettagli
sono nella sezione "Persistenza delle partite".

Anche il client ha le sue asserzioni, sulla sola logica pura. Girano sotto Node
senza framework né bundler, perché Node sa eseguire TypeScript togliendo i tipi:

```bash
cd client && npm test
```

Perché funzioni, i moduli che finiscono lì dentro non devono avere import che
solo Vite sa risolvere — alias, CSS, immagini — né toccare `window` al
caricamento. È il motivo per cui `propertyGroups.ts` importa soltanto tipi.

## Persistenza delle partite

**Spenta di default.** Senza né `REDIS_URL` né `PERSIST_FILE` lo stato vive
solo in memoria, esattamente come prima di questa funzionalità: nessun file
creato, nessuna connessione aperta. In locale non c'è niente da installare né
da far girare, e i test si lanciano come sempre.

Accendendola, il server salva lo stato di ogni stanza e lo ricarica all'avvio,
così una partita in corso sopravvive al riavvio del server. Ci sono due
archivi, e non fanno la stessa cosa:

| Variabile | Sopravvive a un crash / riavvio | Sopravvive a un **deploy** su Render |
| --- | --- | --- |
| `PERSIST_FILE` | sì | **no** — il filesystem di Render free è effimero |
| `REDIS_URL` | sì | **sì** — l'archivio sta fuori dal container |

Il file è il ripiego (va benissimo in locale o su un host con un disco vero);
in produzione serve `REDIS_URL`, perché il caso che càpita più spesso non è il
crash, è la pubblicazione di una versione nuova. **Se sono impostate entrambe
vince `REDIS_URL`** e il file viene ignorato: il server lo scrive nel registro
all'avvio, insieme all'archivio che sta usando davvero.

`REDIS_URL` funziona con un Redis qualunque raggiungibile via URL — `redis://`
o `rediss://` per il TLS. Il codice usa solo comandi standard (SCAN, MGET, SET,
DEL) e non sa chi lo ospita: Upstash, un Redis gestito, un container in locale.
Una stanza per chiave (`monopoly:room:CODICE`), con una scadenza di sei ore che
serve solo contro le chiavi orfane — chi decide quando una partita muore resta
`rooms.js`, dopo tre ore di tavolo vuoto.

### Come accenderlo su Render (da fare a mano, una volta)

1. Crea un'istanza Redis gratuita. Su [Upstash](https://upstash.com) è
   *Create Database*; va bene qualunque altro fornitore, o un Redis proprio.
   Conviene sceglierla nella regione più vicina a quella del servizio Render.
2. Copia l'URL di connessione completo. Su Upstash sta sotto **Redis Connect >
   `redis-cli`/Node**, ed è nella forma
   `rediss://default:LA-PASSWORD@nome-istanza.upstash.io:6379`. Contiene la
   password: è un segreto, non va committato.
3. Su Render, nel servizio del backend: **Environment > Add Environment
   Variable**, chiave `REDIS_URL`, valore l'URL copiato. Salva: Render fa un
   deploy da solo.
4. Nel log d'avvio deve comparire `[persistence] archivio: Redis (...)`. Da
   quel momento le partite in corso sopravvivono anche ai deploy successivi.

Per provarlo prima in locale bastano due righe:

```bash
docker run --rm -p 6379:6379 redis
cd server && REDIS_URL=redis://127.0.0.1:6379 npm start
```

Riavviando il server la partita si ritrova; chi ha la partita in `localStorage`
rientra da solo alla riconnessione.

### Come è fatto, e cosa succede quando l'archivio fa i capricci

Tutto sta in `server/src/persistence.js`, l'unico file che sa dell'esistenza di
un archivio: `rooms.js` e `server.js` chiamano sempre e solo `load / save /
remove / flushNow`, e `gameEngine.js` resta puro e sincrono — non fa I/O e non
sa nemmeno che la persistenza esista.

- **Il salvataggio non rallenta il gioco.** `save()` è sincrona e si limita a
  segnare la stanza; la scrittura vera parte dopo un paio di secondi di quiete
  e accorpa tutte le mosse di quella finestra (un turno intero, un'asta con più
  rilanci = una sola scrittura), e nessuno la aspetta.
- **Un archivio lento o irraggiungibile non ferma la partita.** Ogni errore
  viene catturato, loggato con parsimonia e mai propagato: si continua a
  giocare in memoria e si riprova più tardi da soli, senza perdere le mosse
  fatte nel frattempo. Anche la lettura all'avvio ha un tetto di tempo: oltre
  quello si parte vuoti invece di lasciare il server giù.
- **Uno stato corrotto o di uno schema non più riconosciuto non blocca
  l'avvio.** Si scarta quella stanza (e la si toglie dall'archivio, per non
  ritrovarsela a ogni avvio), si logga il motivo e si riparte.

### Test

```bash
cd server && node persistence-test.js
```

Gira con un client Redis finto in memoria, quindi non serve avere un Redis
acceso: è anzi l'unico modo di provare i casi che contano davvero — connessione
rifiutata, connessione che non risponde mai, comandi che falliscono e poi
tornano a funzionare, scritture lente e sovrapposte.

## Variabili d'ambiente

| Variabile | Dove | A cosa serve |
| --- | --- | --- |
| `PORT` | server | Porta di ascolto. In cloud la imposta la piattaforma. |
| `CLIENT_ORIGIN` | server | Origini ammesse dal CORS, separate da virgola. Vuoto = tutte. |
| `REDIS_URL` | server | Archivio esterno delle partite (`redis://` o `rediss://`). Vuoto (default) = niente Redis. È l'unico che fa sopravvivere le partite a un deploy su Render. Se impostato ha la precedenza su `PERSIST_FILE`. Vedi "Persistenza delle partite". |
| `PERSIST_FILE` | server | File su cui salvare lo stato delle partite. Vuoto (default) = niente file. Copre crash e riavvii, **non** un deploy su Render. Ignorato se c'è `REDIS_URL`. |
| `VITE_SERVER_URL` | client | URL del server. Vuoto = `http://localhost:3001`. |

I file `.env.example` nelle due cartelle riportano gli stessi valori con degli
esempi.

## Deploy

Backend e frontend vanno su due servizi diversi.

**Backend su Render.** Da *New > Blueprint* puntando a questa repo: il file
`render.yaml` nella radice configura tutto (cartella `server`, comandi, health
check su `/health`). Deve stare nella radice perché Render lo cerca solo lì.
L'unica cosa da compilare a mano è `CLIENT_ORIGIN`, che si conosce solo dopo il
primo deploy del client.

**Frontend su Vercel.** Importa la repo e imposta **Root Directory** su
`client`; il resto lo prende da `client/vercel.json`. Va aggiunta la variabile
`VITE_SERVER_URL` con l'URL del backend Render.

L'ordine giusto è: prima il backend, poi il client con `VITE_SERVER_URL`, poi si
torna su Render a riempire `CLIENT_ORIGIN` col dominio Vercel. Se si saltano
le origini, il browser blocca le chiamate e il tabellone resta vuoto.

Due avvertenze sul piano gratuito di Render. La prima: il servizio si addormenta
dopo un po' di inattività, quindi la prima partita della giornata parte con
qualche secondo di attesa. Il workflow `.github/workflows/keep-alive.yml` chiama
`/health` ogni 14 minuti apposta per evitarlo (GitHub Actions non garantisce
però la puntualità dei cron, quindi il rischio è ridotto ma non azzerato).

La seconda: il filesystem è effimero e viene ricreato da zero a ogni deploy,
quindi `PERSIST_FILE` su Render non salva le partite in corso quando si
pubblica — copre solo un riavvio "sul posto". Per quello va impostata
`REDIS_URL`, che tiene lo stato fuori dal container: le istruzioni passo passo
sono in "Persistenza delle partite" più sopra. Senza, un deploy azzera le
partite aperte, e con un progetto che cambia spesso è l'evento più frequente
di tutti.

## Struttura

```
server/
  smoke-test.js        Suite di asserzioni sul motore
  invariant-test.js    Partite casuali con venti invarianti ricontrollate a ogni mossa
  persistence-test.js  Salvataggio e ripristino, con un client Redis finto
  bot-calibration.js   Partite simulate bot-contro-bot, per tarare le soglie
  src/
    data/board.js      Le 40 caselle (edizione italiana), le carte
    gameEngine.js      Stato della partita e tutte le regole
    botStrategy.js     Quanto vale una proprietà, conviene questo scambio
    bot.js             Sceglie ed esegue una mossa del giocatore artificiale
    rooms.js           Stanze, aggancio dei socket, scadenza
    persistence.js     Salvataggio/ripristino delle stanze, su Redis o su file (opzionale)
    server.js          Eventi Socket.io
client/
  logic-test.ts        Asserzioni sulla logica pura del client
  src/
    socket.ts          Connessione e tipi condivisi
    identity.ts        Identità del giocatore, stabile fra le riconnessioni
    propertyGroups.ts  Proprietà per gruppo di colore, con quante su quante
    touchTarget.ts     Altezza minima dei comandi che si toccano col dito
    App.tsx            Radice: lobby, assetto desktop o mobile, riconnessione
    components/        Tabellone, pannelli, modali
    styles/            Design tokens e stili base
docs/superpowers/specs/  Documenti di design delle funzionalità
```

## Stato

Fatto: motore completo, bancarotta con liquidazione, costruzioni e ipoteche,
tre doppi, riconnessione, assetto mobile, bot, persistenza opzionale delle
partite — su file oppure su un archivio esterno Redis, che è quello che le fa
sopravvivere anche a un deploy su Render (vedi "Persistenza delle partite").

Gli scambi hanno due schermate diverse di proposito: da telefono e da tablet
una procedura guidata in tre passi — cosa vuoi da lui, cosa gli dai, riepilogo
— perché le due colonne su 375px chiudevano seicento pixel di contenuto in una
finestrella da centocinquanta, e a due sensi non si riusciva a comporre nulla.
Da computer restano le due colonne, raggruppate per gruppo di colore col
«completo» e il «2 di 3», che è l'unica cosa che conta mentre si tratta.

Regole della casa: il Via paga 500.

Da fare: nulla in lista. L'archivio esterno che era la voce piu' utile qui
sopra adesso c'e' (`REDIS_URL`); resta da accenderlo su Render, che e' un
passaggio manuale di due minuti descritto in "Persistenza delle partite".
