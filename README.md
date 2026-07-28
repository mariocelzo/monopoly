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

Anche il client ha le sue asserzioni, sulla sola logica pura. Girano sotto Node
senza framework né bundler, perché Node sa eseguire TypeScript togliendo i tipi:

```bash
cd client && npm test
```

Perché funzioni, i moduli che finiscono lì dentro non devono avere import che
solo Vite sa risolvere — alias, CSS, immagini — né toccare `window` al
caricamento. È il motivo per cui `propertyGroups.ts` importa soltanto tipi.

## Persistenza delle partite

Spenta di default: senza `PERSIST_FILE` impostata lo stato vive solo in
memoria, esattamente come prima di questa funzionalità, e nessun file viene
creato.

Impostando `PERSIST_FILE` (vedi `server/.env.example`) il server salva su quel
file lo stato di ogni stanza e lo ricarica all'avvio, così una partita
sopravvive a un riavvio del processo: crash, `npm start` rilanciato, un
riavvio manuale. Il salvataggio è differito e accorpato (non scrive a ogni
mossa, solo dopo un attimo di quiete) apposta per non rallentare il gioco; i
dettagli sono commentati in `server/src/persistence.js`, l'unico file che
saprebbe della sua esistenza — `gameEngine.js` resta puro e sincrono, non fa
I/O e non sa che la persistenza esiste. Un salvataggio corrotto o di uno
schema che il server non riconosce più non blocca l'avvio: si scarta quello e
si riparte come se non ci fosse nulla di salvato, loggando il motivo.

**Limite importante**: in produzione questo progetto gira su Render piano
gratuito, dove il filesystem è **effimero** e viene ricreato da zero a ogni
deploy e a ogni riavvio dell'istanza. Questa persistenza su file protegge da
un crash o un riavvio "sul posto" — in locale, o su un host con un disco vero
— ma **non** dal caso che càpita più spesso in produzione, cioè un nuovo
deploy: il file scritto prima del deploy non c'è più al riavvio successivo.
Risolverlo davvero richiede un archivio esterno al container (Redis, un
database, un bucket S3...) che sopravviva al deploy. L'interfaccia di
`persistence.js` (`load` / `save` / `remove`) è pensata apposta perché quel
giorno sostituirla sia riscrivere quel solo file, non i chiamanti.

## Variabili d'ambiente

| Variabile | Dove | A cosa serve |
| --- | --- | --- |
| `PORT` | server | Porta di ascolto. In cloud la imposta la piattaforma. |
| `CLIENT_ORIGIN` | server | Origini ammesse dal CORS, separate da virgola. Vuoto = tutte. |
| `PERSIST_FILE` | server | File su cui salvare lo stato delle partite. Vuoto (default) = persistenza spenta. Vedi "Persistenza delle partite" sopra per il limite su Render. |
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

Due avvertenze sul piano gratuito di Render: il servizio si addormenta dopo un
po' di inattività, quindi la prima partita della giornata parte con qualche
secondo di attesa; e a ogni **deploy** le partite in corso si perdono comunque,
perché il filesystem di Render free è effimero e viene ricreato da zero — vedi
"Persistenza delle partite" più sopra. Impostare `PERSIST_FILE` su Render non
risolve questo caso: serve per un riavvio "sul posto" (crash, riavvio
manuale), non per un deploy nuovo, che è invece l'evento più comune.

Il workflow `.github/workflows/keep-alive.yml` chiama `/health` ogni 14
minuti apposta per evitare l'addormentamento per inattività (GitHub Actions
non garantisce però la puntualità dei cron, quindi il rischio è ridotto ma
non azzerato). Resta comunque vero che un nuovo deploy azzera le partite in
corso: quello non è un problema che un ping o un file su disco possano
risolvere, serve un archivio esterno che sopravviva al container (vedi sopra).

## Struttura

```
server/
  smoke-test.js        Suite di asserzioni sul motore
  bot-calibration.js   Partite simulate bot-contro-bot, per tarare le soglie
  src/
    data/board.js      Le 40 caselle (edizione italiana), le carte
    gameEngine.js      Stato della partita e tutte le regole
    botStrategy.js     Quanto vale una proprietà, conviene questo scambio
    bot.js             Sceglie ed esegue una mossa del giocatore artificiale
    rooms.js           Stanze, aggancio dei socket, scadenza
    persistence.js     Salvataggio/ripristino delle stanze su file (opzionale)
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
tre doppi, riconnessione, assetto mobile, bot, persistenza su file opzionale
(sopravvive a un riavvio del processo, non a un deploy su Render free — vedi
"Persistenza delle partite").

Gli scambi hanno due schermate diverse di proposito: da telefono e da tablet
una procedura guidata in tre passi — cosa vuoi da lui, cosa gli dai, riepilogo
— perché le due colonne su 375px chiudevano seicento pixel di contenuto in una
finestrella da centocinquanta, e a due sensi non si riusciva a comporre nulla.
Da computer restano le due colonne, raggruppate per gruppo di colore col
«completo» e il «2 di 3», che è l'unica cosa che conta mentre si tratta.

Regole della casa: il Via paga 500.

Da fare: nulla in lista. Le idee successive sono da decidere; la piu' utile
resta un archivio esterno (Redis, un database) al posto del file su disco, per
far sopravvivere le partite anche a un deploy su Render — non solo a un
riavvio del processo, che la persistenza su file copre già.
