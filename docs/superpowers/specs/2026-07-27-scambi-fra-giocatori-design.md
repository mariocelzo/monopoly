# Scambi fra giocatori

Data: 2026-07-27
Stato: implementato

Punto 3 della lista di priorità. Segue lo stesso schema dei punti 1 e 2: tutta
la logica nel motore, il client raccoglie solo l'intento. Vale il principio già
concordato — in caso di dubbio si seguono le regole ufficiali del Monopoli.

## Modello

Un terzo tipo di `pendingAction`, `awaiting_trade`, accanto a `awaiting_buy` e
`awaiting_debt`. Come gli altri congela la partita per entrambi finché non è
risolto, e `playerId` indica chi deve agire — qui il destinatario dell'offerta.

```
{ type: 'awaiting_trade', playerId: toId, fromId, toId,
  offerProperties: [], offerMoney, requestProperties: [], requestMoney }
```

## Regole applicate

- Si può proporre in qualsiasi momento, anche fuori dal proprio turno, purché
  non ci sia già un'azione in sospeso.
- **Niente proprietà con edifici sul colore.** Il regolamento vieta di cedere
  una proprietà finché sul suo gruppo c'è anche un solo edificio: vanno venduti
  prima. Il controllo è su tutto il gruppo, non sulla singola casella.
- Le proprietà ipotecate si possono scambiare e restano ipotecate; **chi le
  riceve paga subito il 10% alla banca**, come nella bancarotta. L'addebito
  passa da `chargePlayer`, quindi può aprire un debito: viene fatto dopo aver
  chiuso il `pendingAction` dello scambio, altrimenti lo sovrascriverebbe.
- Non si offre denaro che non si ha, né si chiede denaro che l'altro non ha.
- Uno scambio vuoto è rifiutato.
- Solo il destinatario può rispondere.
- **Lo scambio non consuma il turno**, né se accettato né se rifiutato.

Le condizioni vengono ricontrollate al momento dell'accettazione, non solo
della proposta: fra i due istanti i giocatori possono aver costruito o
ipotecato.

Mentre una proposta è aperta le proprietà sono congelate: costruzione, vendita,
ipoteca e riscatto rifiutano tutti. Non sarebbe insicuro (si ricontrolla in
accettazione) ma renderebbe l'offerta poco onesta.

Solo il saldo netto cambia di mano, così se entrambi mettono denaro sul piatto
non si creano saldi negativi intermedi.

## Client

- `TradeModal`: composizione dell'offerta. Due colonne con le proprietà
  spuntabili di ciascuno e un campo denaro per parte. Gli errori del server
  compaiono nel modale, che resta aperto per correggere.
- `TradeOfferModal`: al destinatario mostra i due lati del baratto con Accetta
  e Rifiuta, al proponente solo l'attesa.
- Bottone "Proponi scambio" nel pannello di gioco, disabilitato quando c'è
  un'azione in sospeso.

## Carte "esci di prigione"

Aggiunte dopo la prima versione: `offerJailCards` e `requestJailCards` nella
proposta, validate contro le carte effettivamente possedute e ricontrollate in
accettazione come tutto il resto. Nel compositore i due campi compaiono solo se
quel giocatore ha almeno una carta.

## Fuori scope

Resta ai punti successivi: riconnessione con `playerId` persistente e deploy.
