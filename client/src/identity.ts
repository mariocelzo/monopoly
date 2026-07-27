// Identità del giocatore, indipendente dal socket. L'id del socket cambia a
// ogni riconnessione: se lo si usasse come playerId, ricaricare la pagina
// significherebbe perdere proprietà e denaro.

const CLIENT_ID_KEY = 'monopoly.clientId';
const ROOM_KEY = 'monopoly.room';

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
