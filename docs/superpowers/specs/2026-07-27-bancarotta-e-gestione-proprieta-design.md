# Bancarotta robusta e gestione proprietà

Data: 2026-07-27
Stato: approvato

Copre i punti 1 e 2 della lista di priorità del progetto: rendere la bancarotta
fedele alle regole del Monopoli, e dare al client una UI per costruire, vendere
e ipotecare. I due punti sono trattati insieme perché la modalità di
risoluzione del debito scelta (ibrida) richiede il pannello proprietà.

## Decisioni prese

| Scelta | Decisione |
| --- | --- |
| Risoluzione del debito | Ibrida: il giocatore sceglie cosa liquidare, con scorciatoia automatica |
| Scope | Punti 1 e 2 insieme, un solo `PropertiesPanel` riutilizzato nel modale debito |
| Edificazione uniforme | Sì, applicata sia in costruzione sia in vendita |
| Costruire fuori dal proprio turno | Consentito, come nel gioco reale |
| Debito di un giocatore non di turno | Blocca la partita per entrambi finché non è risolto |
| Ordine di liquidazione automatica | Edifici prima, poi ipoteche; i monopoli si sacrificano per ultimi |

Principio guida confermato dall'utente: in caso di dubbio si seguono le regole
ufficiali del Monopoli.

## 1. Motore: modello del debito

### Stato attuale e problemi

`checkBankruptcy(player, amount, creditor)` dichiara fallimento non appena il
saldo scende sotto zero, senza mai tentare di liquidare. Viene chiamata da
quattro punti (tasse, affitti, carte `pay`, carte `repairs`), mentre ogni
pagamento fa `player.balance -= x` per conto proprio. Tre difetti collaterali:

- `pay_each_player` e `collect_from_each_player` non controllano affatto la
  bancarotta: un giocatore può restare con saldo negativo e continuare a
  giocare.
- `endTurn()` azzera `pendingAction` senza guardare cosa contiene.
- Non esiste alcuna condizione di vittoria.

### `chargePlayer(player, amount, creditor = null)`

Unico punto attraverso cui un giocatore perde denaro. Tutti i pagamenti
esistenti vengono instradati qui. Sposta i fondi (al creditore se presente,
altrimenti alla banca), poi decide:

- saldo ≥ 0 → nessuna azione;
- saldo < 0 e `liquidationValue(player) >= 0` → apre il pending action
  `{ type: 'awaiting_debt', playerId, amount, creditorId }`;
- saldo < 0 e `liquidationValue(player) < 0` → `declareBankruptcy` immediata e
  forzata: il giocatore non è salvabile e non gli viene offerta alcuna scelta.

Il debito continua a essere modellato come **saldo negativo**: il creditore è
già stato pagato e il debitore è in rosso finché non rientra. È il modello già
in uso, non cambia.

### `liquidationValue(player)`

```
saldo
+ Σ (case + hotel × 5) × floor(houseCost / 2)      per ogni proprietà posseduta
+ Σ floor(price / 2)                                per ogni proprietà non ipotecata
```

L'hotel vale 5 unità perché costa una casa in più rispetto alle quattro già
presenti. Questo valore decide se il giocatore è salvabile ed è mostrato nel
modale debito.

### Blocco della partita

`awaiting_debt` blocca `rollDice` ed `endTurn` per entrambi i giocatori, a
prescindere da chi sia il debitore. Serve perché la carta "incassa da ogni
giocatore" può mandare in rosso l'avversario mentre non è il suo turno. Nel
Monopoli reale un debito si salda prima che il gioco prosegua, quindi il blocco
è anche la scelta fedele.

`endTurn()` va reso difensivo: se `pendingAction.type === 'awaiting_debt'`
rifiuta e non azzera nulla.

## 2. Risoluzione del debito

Tre strade, tutte disponibili al debitore finché il pending action è aperto.

**Manuale.** Il giocatore usa i normali `sellHouse` e `mortgageProperty`. In
coda a entrambi si chiama `checkDebtResolved()`: se esiste un `awaiting_debt`
per quel giocatore e il saldo è tornato ≥ 0, il pending action si chiude e il
flusso di turno riprende.

**`resolveDebtAuto(playerId)`.** Liquidazione deterministica che si ferma
appena il saldo torna ≥ 0:

1. Vende edifici partendo sempre dalla casella con più edifici del giocatore.
   Partire dal massimo rispetta automaticamente la regola dell'uniformità.
2. Esauriti gli edifici, ipoteca le proprietà non ipotecate: prima quelle che
   **non** fanno parte di un monopolio, in ordine di prezzo crescente; poi le
   restanti, sempre in ordine di prezzo crescente.

I colori completi sono l'ultima risorsa. Ogni passo produce una riga di log.

**`declareBankruptcy(playerId, creditor)`.** Resa volontaria, sempre
disponibile, e anche la strada forzata quando il patrimonio non basta.

- Gli edifici tornano alla banca senza rimborso.
- Le proprietà passano al creditore **mantenendo lo stato di ipoteca**; il
  creditore paga subito alla banca il 10% del valore d'ipoteca di ciascuna
  proprietà ipotecata ricevuta, come da regolamento.
- Se il creditore è la banca (tasse, carte), le caselle tornano libere.
- Il saldo del debitore va a zero e `bankrupt` diventa `true`.

### Condizione di vittoria

Dopo ogni bancarotta: se resta un solo giocatore non fallito, lo stato prende
`finished: true` e `winnerId`. Oggi manca del tutto.

## 3. Edificazione uniforme

`unitCount(o) = o.hotel ? 5 : o.houses`.

- `buildHouse` richiede che la casella sia al **minimo** del gruppo, che il
  giocatore possieda il gruppo completo e che **nessuna proprietà del gruppo
  sia ipotecata** (regola ufficiale, oggi assente).
- `sellHouse` richiede che la casella sia al **massimo** del gruppo.

Senza questa regola conviene sempre concentrare un hotel su una sola casella
cara, e con dei bottoni in UI l'exploit diventa evidente.

## 4. Client

Nessuna nuova dipendenza. Componenti funzionali con hook, oggetti `styles`
inline, palette feltro verde/ottone e font esistenti.

**`PropertiesPanel.tsx`** (nuovo). Le proprietà del giocatore raggruppate per
colore: pastiglia del colore, nome, stato (numero di case, hotel, ipotecata) e i
bottoni Costruisci / Vendi / Ipoteca / Riscatta. I bottoni si disabilitano
secondo le stesse condizioni del server, ciascuno con un `title` che spiega il
motivo ("serve il monopolio del colore", "prima le altre del gruppo", "vendi
prima le case"). La validazione vera resta esclusivamente sul server: gli
errori arrivano dall'ack socket e compaiono in una riga sotto il pannello.

**`DebtModal.tsx`** (nuovo). Compare quando `pendingAction.type ===
'awaiting_debt'`. Al debitore mostra l'importo dovuto, il valore di
liquidazione totale, il `PropertiesPanel` incorporato e i bottoni "Vendi
automaticamente" e "Dichiara bancarotta". All'avversario mostra solo un
messaggio di attesa.

**`socket.ts`.** `PendingAction` diventa una union discriminata su `type` con
`awaiting_buy` e `awaiting_debt`; `GameState` guadagna `finished` e `winnerId`.

**`server.js`.** Due nuovi eventi via il wrapper `withGame` esistente:
`resolve_debt_auto` e `declare_bankruptcy`.

## 5. Verifica

`server/smoke-test.js`, eseguibile con `node smoke-test.js`, senza framework di
test — coerente con le convenzioni del progetto. Da far girare prima e dopo le
modifiche al motore.

Casi coperti:

1. `buildHouse` rifiuta la seconda casa su una casella già al massimo del
   gruppo; la accetta dopo aver pareggiato le altre.
2. `sellHouse` rifiuta la vendita da una casella al minimo del gruppo.
3. `buildHouse` rifiuta se una proprietà del gruppo è ipotecata.
4. Debito coperto dal patrimonio → si apre `awaiting_debt`, `rollDice` ed
   `endTurn` sono bloccati, `resolveDebtAuto` riporta il saldo ≥ 0 e sblocca.
5. Debito superiore al patrimonio → bancarotta immediata senza pending action.
6. Bancarotta con creditore → le proprietà passano al creditore, le ipoteche
   restano, il creditore paga il 10%, gli edifici spariscono.
7. Bancarotta senza creditore → le caselle tornano libere.
8. Ultimo giocatore in piedi → `finished` e `winnerId` corretti.
9. Somma dei saldi coerente dopo una sequenza di pagamenti fra giocatori.

Oltre allo script, build del client (`npm run build`) per verificare i tipi.

## Fuori scope

Restano ai punti successivi della lista: scambi fra giocatori, tre doppi
consecutivi, riconnessione con `playerId` persistente, animazioni, deploy.
