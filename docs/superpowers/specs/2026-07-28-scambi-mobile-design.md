# Scambi: procedura guidata su telefono, due colonne su computer

Data: 2026-07-28
Stato: approvato

Rifà la composizione di uno scambio, che su telefono oggi non si riesce a
portare a termine, e corregge un difetto che può piantare la partita.

## Decisioni prese

| Scelta | Decisione |
| --- | --- |
| Telefono e tablet | Procedura guidata in tre passi |
| Computer | Le due colonne di oggi, raggruppate per gruppo di colore |
| Dove passa il confine | `(hover: none)` oppure larghezza ≤ 780px |
| Tasto nella barra | Scambio prende il posto di Registro |
| Denaro | Tasti −/+ e scorciatoie, non il campo numerico |
| Mappa | Resta, e distingue offerto da richiesto |

Le due schermate restano **flussi separati e deliberatamente diversi**: nascono
da esigenze diverse. Il telefono ha poco spazio e un dito grosso; il computer
ha spazio e un puntatore preciso. Condividono il calcolo, non il layout.

## 1. Il problema, misurato

Sul viewport di un telefono (375×812), in una partita reale con sei proprietà
a testa, il contenitore delle due colonne di `TradeModal` è alto **148px** e ne
contiene **682**. Dentro quei 148px vivono altri due contenitori che scorrono,
gli elenchi delle proprietà, alti 240px l'uno.

Tre scorrimenti annidati. Il pollice becca quasi sempre quello sbagliato, e
l'unico che porta alla colonna "Chiedi a…" e ai campi del denaro è il più
difficile da agganciare perché è il più basso e i suoi figli lo coprono.

**Conseguenza: su telefono non si compone uno scambio a due sensi.** La colonna
delle richieste e i campi del denaro esistono nel DOM ma sono irraggiungibili
in pratica. Non è una sensazione, è una misura.

La mappa in miniatura occupa da sola circa 300px, il 37% dello schermo, e per
ammissione del suo stesso commento «serve a guardare, non a selezionare».

## 2. Il difetto che pianta la partita

`TradeOfferModal`, la finestra di chi **riceve** la proposta, non ha né altezza
massima né scorrimento: `card` è un flex in colonna dentro un overlay centrato,
e basta. Con abbastanza proprietà nel baratto il contenuto supera l'altezza
dello schermo, deborda sopra e sotto, e non c'è modo di scorrere per
raggiungerlo.

I bottoni **Accetta** e **Rifiuta** stanno in fondo. Se finiscono fuori
schermo, la proposta non si può né accettare né rifiutare — e siccome un
`pendingAction` di tipo `awaiting_trade` congela il turno di tutti, la partita
si pianta e non si sblocca più se non chiudendo il tavolo.

È il difetto più grave dei due e va corretto a prescindere dal resto.

**La correzione:** `card` prende `maxHeight: 90vh`; l'area delle due colonne
diventa l'unico contenitore che scorre, con `overflowY: auto` e `minHeight: 0`;
i bottoni restano fuori da quello scorrimento, come fratelli, così sono
raggiungibili con qualunque quantità di proprietà nel baratto.

## 3. Struttura dei file

| File | Responsabilità |
| --- | --- |
| `client/src/components/TradeWizard.tsx` (nuovo) | La procedura a tre passi. Telefono e tablet. |
| `client/src/components/TradeModal.tsx` (rifatto) | Le due colonne raggruppate per colore. Solo computer. |
| `client/src/propertyGroups.ts` (nuovo) | Raggruppa le proprietà di un giocatore per gruppo di colore, con quante ne possiede su quante. Funzione pura, nessuno stato. |
| `client/src/components/MoneyStepper.tsx` (nuovo) | Campo denaro con −/+ e scorciatoie. |
| `client/src/components/TradeBoard.tsx` (modifica) | Distingue offerto da richiesto. |
| `client/src/components/TradeOfferModal.tsx` (modifica) | Altezza massima e scorrimento; i bottoni fuori dallo scorrimento. |
| `client/src/components/MobileBar.tsx` (modifica) | Scambio al posto di Registro fra le schede in basso. |
| `client/src/useIsMobile.ts` (modifica) | Aggiunge la soglia touch per i tablet. |
| `client/src/App.tsx` (modifica) | Sceglie fra procedura guidata e due colonne. |

La divisione fra `propertyGroups.ts` (puro) e i due componenti è deliberata: la
domanda «a chi manca cosa» ha una risposta sola, calcolata in un posto solo, e
le due schermate la disegnano ciascuna a modo proprio. Senza quella
separazione la stessa logica finirebbe copiata in due file destinati a
divergere.

## 4. Dove passa il confine

La soglia di oggi, `MOBILE_BREAKPOINT = 780`, decide l'assetto generale della
pagina e resta com'è. Per il solo composer di scambio serve una soglia diversa,
perché un tablet in orizzontale (1024px) è largo ma si usa col dito, mentre una
finestra da 1024px su un computer è larga e si usa col mouse.

Il criterio è quindi `(hover: none) or (max-width: 780px)`: prendono la
procedura guidata tutti i telefoni e tutti i tablet, in qualunque
orientamento, mentre una finestra stretta su un computer tiene le due colonne.
È lo stesso criterio già usato nel progetto per ingrandire i tasti delle
proprietà.

Si aggiunge a `useIsMobile.ts` come funzione a parte, `useIsTouchLayout()`,
lasciando intatta `useIsMobile()`: due domande diverse, due funzioni diverse.

## 5. La procedura a tre passi

**Passo 1 — Cosa vuoi da lui?** In testa, se gli avversari sono più di uno, la
scelta di con chi trattare. Sotto, le proprietà del destinatario raggruppate
per gruppo di colore, e il denaro che gli chiedi.

**Passo 2 — Cosa gli dai?** Le tue proprietà, il tuo denaro, e le carte uscita
di prigione se ne possiedi.

**Passo 3 — Riepilogo.** Il patto scritto per esteso: cosa esce, cosa entra. Il
bottone *Manda la proposta*.

Struttura fissa in tutti e tre: intestazione ferma in alto, **un solo
contenitore che scorre** in mezzo, bottoni fermi in fondo. Nessuno scorrimento
annidato, mai. In fondo, i puntini di avanzamento e i bottoni *Indietro* e
*Avanti*; al terzo passo *Avanti* diventa *Manda la proposta*.

Cambiare destinatario al passo 1 azzera le richieste, come già fa oggi: erano
rivolte a un'altra persona.

La mappa non compare nella procedura guidata. Su uno schermo da telefono
costerebbe il 37% dello spazio per un'informazione che i due elenchi
raggruppati per colore danno già meglio.

## 6. Le due colonne su computer

Le proprietà smettono di essere un elenco alla rinfusa e si raggruppano per
gruppo di colore, con l'etichetta *completo* oppure *2 di 3*. È l'unica
informazione che conta davvero quando si tratta: a chi manca cosa.

La mappa si stringe e va in mezzo alle due colonne. In fondo compare **il
patto**: cosa esce e cosa entra, aggiornato mentre si sceglie e non solo dopo
aver mandato.

Anche qui l'area che scorre diventa una sola, con `minHeight: 0` sul figlio
flex: senza quella proprietà un figlio in un contenitore flex non si restringe
sotto il proprio contenuto e deborda in silenzio, che è la causa tecnica del
problema di oggi.

## 7. La mappa

Oggi le caselle scelte per lo scambio hanno tutte lo stesso bordo dorato,
quindi la mappa mostra *che* una casella è nello scambio ma non *da che parte*
va. `TradeBoard` passa da una lista `selected` a due liste distinte.

La distinzione è per **colore dell'anello**, non per tratteggio: a venti pixel
un bordo tratteggiato non si legge. Ottone per quello che esce da te, avorio
per quello che entra da lui. La legenda passa da tre voci a quattro.

## 8. Il denaro

Il campo `type="number"` viene sostituito da `MoneyStepper`: due tasti −/+ e le
scorciatoie +50 / +100 / +200. Su telefono un campo numerico apre la tastiera e
si mangia metà schermo proprio mentre stai guardando l'elenco delle proprietà.

Il valore resta comunque digitabile per chi vuole una cifra precisa, e resta
limitato dal saldo di chi deve pagare. Come sempre, il limite vero lo mette il
server: il client raccoglie solo l'intento.

## 9. Il tasto nella barra

Le due schede in fondo diventano **🏠 Proprietà** e **🤝 Scambio**. Il registro
non si perde: il foglio che si apre ha già al suo interno le proprie schede
Proprietà / Registro, quindi ci si arriva in due tocchi invece di uno.

Il tasto *Proponi scambio* che oggi sta dentro il foglio delle proprietà viene
tolto: sarebbe una seconda strada per la stessa cosa.

La scheda Scambio si disabilita quando la partita non è ancora iniziata, quando
è finita, o quando c'è un'azione in sospeso — le stesse condizioni che
governano oggi il tasto che sostituisce. Prima del via resta visibile ma
spenta, così la barra non cambia forma quando la partita comincia.

## 10. Verifica

Il client non ha un framework di test e non se ne introduce uno per questo
lavoro. La verifica è:

- `npx tsc --noEmit` e `npm run build` puliti;
- prova nel browser a quattro larghezze — 375 (telefono), 768 (tablet
  verticale), 1024 con `hover: none` (tablet orizzontale), 1400 (computer) —
  componendo uno scambio completo a due sensi in ciascuna;
- sul difetto della sezione 2, prova prima-e-dopo: si compone uno scambio con
  abbastanza proprietà da far debordare la finestra e si verifica che *Accetta*
  resti raggiungibile.

Le regole dello scambio stanno tutte sul server e sono già coperte dallo smoke
test: qui non si tocca nessuna regola, solo il modo di comporre l'intento.

## Fuori scope

- **Il tavolo delle trattative**, cioè le carte che si spostano fisicamente al
  centro dello schermo: valutato e scartato in favore dell'evoluzione delle due
  colonne, perché era una riscrittura vera del componente per un guadagno
  soprattutto estetico.
- **La procedura guidata su computer.** Deciso esplicitamente: i due contesti
  restano diversi perché le esigenze sono diverse.
- **Il trascinamento delle proprietà.** Su telefono litiga con lo scorrimento,
  e senza di esso non serve.
