/**
 * Altezza minima, in px, dei controlli che si toccano col dito.
 *
 * 44px è il minimo raccomandato dalle linee guida di accessibilità; 46 ci sta
 * sopra con un margine. I due valori erano finiti mescolati fra i componenti e
 * perfino dentro lo stesso file, quindi la misura sta qui una volta sola: chi
 * aggiunge un comando importa la costante e non deve più scegliere.
 *
 * Non passano di qui i controlli secondari — schede, chip, il bottone che
 * chiude il pannello — che sono di proposito più piccoli per pesare meno degli
 * altri: lì la misura minore è una scelta, non una svista.
 */
export const TOUCH_TARGET = 46;
