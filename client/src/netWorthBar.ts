/**
 * Logica pura per la barra proporzionale del patrimonio (vedi Player.netWorth
 * in socket.ts, calcolato dal server). Un numero da solo si legge, non si
 * "vede": una barra fa capire a colpo d'occhio chi è avanti, che è tutto
 * quello che serve — non contare gli euro uno per uno.
 */

/** Quanto riempire la barra del patrimonio di un giocatore, in percentuale. */
export interface NetWorthShare {
  id: string;
  percent: number;
}

/**
 * Percentuale di riempimento (0-100) per ciascun giocatore, relativa al più
 * ricco del tavolo — non al totale di tutti i patrimoni messi insieme.
 * Confrontarsi col totale farebbe accorciare la barra del leader ogni volta
 * che si aggiunge un giocatore (con sei al tavolo il primo sembrerebbe
 * "solo" al 20%, anche se sta dominando), dando un'impressione sbagliata.
 * Confrontarsi col più ricco invece è stabile: la sua barra è sempre piena,
 * le altre dicono chiaramente "quanto manca per essere in testa".
 *
 * Il massimo parte da 1, mai da 0: a inizio partita (o se per assurdo tutti
 * fossero a zero) evita una divisione per zero che trasformerebbe ogni
 * percentuale in NaN e farebbe sparire le barre invece di mostrarle vuote.
 * Il patrimonio di un giocatore è clampato a un minimo di 0 prima del
 * calcolo: durante un debito in sospeso il saldo può essere transitoriamente
 * negativo, e una barra a larghezza negativa romperebbe il layout.
 */
export function netWorthShares(players: { id: string; netWorth: number }[]): NetWorthShare[] {
  const max = Math.max(1, ...players.map((p) => Math.max(0, p.netWorth)));
  return players.map((p) => ({
    id: p.id,
    percent: Math.min(100, (Math.max(0, p.netWorth) / max) * 100),
  }));
}
