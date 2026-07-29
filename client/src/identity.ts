// Identità del giocatore, indipendente dal socket. L'id del socket cambia a
// ogni riconnessione: se lo si usasse come playerId, ricaricare la pagina
// significherebbe perdere proprietà e denaro.

const CLIENT_ID_KEY = 'monopoly.clientId';
const ROOM_KEY = 'monopoly.room';
// Segnalibro nel registro: il timestamp (`at`) dell'ultima riga vista prima di
// perdere la connessione o chiudere la scheda. Persistito perché una
// disconnessione vera spesso sopravvive a un ricaricamento della pagina, e
// senza un segnalibro fuori dallo state di React non sapremmo più da dove
// ripartire per capire cosa è successo nel frattempo.
const LOG_BOOKMARK_KEY = 'monopoly.logBookmarkAt';

/** localStorage può essere inaccessibile (navigazione privata, cookie bloccati). */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Senza memoria persistente il gioco funziona lo stesso: si perde solo la
    // possibilità di rientrare dopo aver chiuso il browser.
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* vedi sopra */
  }
}

/** Identificativo stabile del browser, creato alla prima visita. */
export function getClientId(): string {
  const existing = read(CLIENT_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  write(CLIENT_ID_KEY, id);
  return id;
}

/** Ultimo tavolo a cui si è seduti, per rientrarci da soli alla riapertura. */
export function saveRoom(roomCode: string) {
  write(ROOM_KEY, roomCode);
}

export function loadRoom(): string | null {
  return read(ROOM_KEY);
}

export function clearRoom() {
  remove(ROOM_KEY);
}

/** Timestamp dell'ultima riga di registro vista, per il riepilogo al rientro. */
export function saveLogBookmark(at: number) {
  write(LOG_BOOKMARK_KEY, String(at));
}

export function loadLogBookmark(): number | null {
  const raw = read(LOG_BOOKMARK_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clearLogBookmark() {
  remove(LOG_BOOKMARK_KEY);
}
