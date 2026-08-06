import type { BoardSquare, Ownership } from './socket';

/**
 * Come si leggono gli importi di costruzione che il motore pubblica.
 *
 * Gli importi NON si calcolano qui: arrivano già pronti dal server insieme al
 * tabellone (vedi boardWithAmounts in gameEngine.js e la rotta /board). Quello
 * che resta da fare al client è comunque logica, e sbagliabile: scegliere QUALE
 * casella dell'array leggere, e come chiamare a parole l'unità corrispondente.
 * È un indice, non una formula, ma un indice storto mostra un numero sbagliato
 * esattamente come una formula storta — e mostrarlo accanto a un bottone che
 * addebita tutt'altro è il modo migliore per far perdere fiducia nei numeri.
 *
 * Perciò questa manciata di funzioni sta in un modulo a parte invece che dentro
 * PropertiesPanel.tsx: così logic-test.ts può importarle davvero ed eseguirle
 * (un .tsx non si può importare là, il type-stripping di node non digerisce il
 * JSX), e confrontare quello che il pannello MOSTRA con quello che il motore
 * ADDEBITA, casella per casella e livello per livello. Vedi la sezione
 * "Gli importi mostrati coincidono con quelli che il motore addebita".
 *
 * Gli array del server sono indicizzati per numero di unità meno uno:
 * `buildCosts[0]` è la prima casa, `buildCosts[4]` il primo hotel,
 * `buildCosts[7]` il quarto.
 */

/**
 * Edifici presenti su una casella espressi in "unità casa": 1-4 sono le case,
 * 5-8 i livelli di hotel. Un hotel vale sempre "4 + il suo livello" perché
 * occupa il posto delle quattro case. Rispecchia `unitCount` del motore: non è
 * un importo, è il modo di contare con cui sono indicizzati gli array che il
 * motore pubblica, e senza di esso non si saprebbe quale casella leggere.
 */
export const unitsOf = (owned: Ownership): number =>
  owned.hotels > 0 ? 4 + owned.hotels : owned.houses;

/**
 * Quante unità si possono arrivare a costruire, dato il tetto di hotel scelto
 * al tavolo: 5 con il regolamento classico (quattro case più un hotel), 8 con
 * la modalità grattacieli. Il tetto è una regola della casa, che il client
 * conosce già dallo stato (`rules.skyscraperEnabled`), non una proprietà della
 * casella — infatti il motore pubblica sempre tutti e otto i livelli.
 */
export const maxUnits = (maxHotels: number): number => 4 + maxHotels;

/**
 * Costo della PROSSIMA unità costruibile, o null se non se ne possono più
 * costruire. Non un costo generico: con la modalità grattacieli il 2º, 3º e 4º
 * hotel costano molto più di una casa, ed è proprio quel salto che serve sapere
 * prima di premere il bottone (su Parco della Vittoria si va da 200 a 6.000).
 */
export const nextBuildCost = (
  square: BoardSquare,
  owned: Ownership,
  maxHotels: number
): number | null => {
  const prossima = unitsOf(owned) + 1;
  if (prossima > maxUnits(maxHotels)) return null;
  return square.buildCosts?.[prossima - 1] ?? null;
};

/**
 * Quanto si riprende vendendo l'unità in cima alla pila — l'ultima costruita,
 * che è sempre quella che il motore smonta per prima (vedi sellHouse).
 *
 * Attenzione a un caso che sorprende: metà è di quanto è costata QUELLA unità,
 * non di quanto costerebbe rimetterla. L'ultimo hotel rimasto è costato come
 * una casa, quindi rende metà del prezzo BASSO (100 su Parco della Vittoria),
 * mentre il 4º rende 3.000. Un rimborso unico per tutti gli hotel — la
 * scorciatoia che andava bene quando esisteva un solo livello — qui sbaglierebbe
 * di trenta volte.
 */
export const currentSellRefund = (square: BoardSquare, owned: Ownership): number | null => {
  const presenti = unitsOf(owned);
  if (presenti === 0) return null;
  return square.buildRefunds?.[presenti - 1] ?? null;
};

/**
 * Come si chiama a parole la prossima unità costruibile: "1ª casa" … "4ª casa",
 * poi "hotel". Con la modalità grattacieli gli hotel si numerano ("2º hotel"),
 * senza resta l'unico hotel possibile e numerarlo sarebbe solo rumore.
 *
 * Serve perché un prezzo da solo non si spiega: "€6.000" accanto a "Costruisci"
 * sembra un difetto finché non si legge che quello è il 4º hotel.
 */
export const nextUnitLabel = (owned: Ownership, maxHotels: number): string | null => {
  const prossima = unitsOf(owned) + 1;
  if (prossima > maxUnits(maxHotels)) return null;
  if (prossima <= 4) return `${prossima}ª casa`;
  return maxHotels === 1 ? 'hotel' : `${prossima - 4}º hotel`;
};

/**
 * Come si chiama a parole l'unità in cima alla pila, quella che il bottone
 * "Vendi" toglierebbe. Stessa numerazione di nextUnitLabel.
 */
export const topUnitLabel = (owned: Ownership, maxHotels: number): string | null => {
  const presenti = unitsOf(owned);
  if (presenti === 0) return null;
  if (presenti <= 4) return `${presenti}ª casa`;
  return maxHotels === 1 ? 'hotel' : `${presenti - 4}º hotel`;
};
