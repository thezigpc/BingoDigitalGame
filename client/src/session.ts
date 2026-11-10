import type { DisplaySettings } from "@bingo/shared";
import type { Role } from "@bingo/shared";

const PREFIX = "bingo_session";
const TAB_ID_KEY = "bingo_tab_id";

export interface StoredSession {
  roomCode: string;
  token: string;
  name: string;
  role: Role;
}

// Scoped per tab (random id in sessionStorage) so hosting in one tab and
// opening the Table display in another doesn't overwrite the host's seat.
// The session itself lives in localStorage so it survives a mobile browser
// evicting a backgrounded tab.
function tabId(): string {
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

const key = () => `${PREFIX}:${tabId()}`;

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(key());
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(key(), JSON.stringify(s));
  } catch {
    /* private mode: reconnect after a reload won't work, but play continues */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(key());
  } catch {
    /* ignore */
  }
}

/**
 * Host "big screen" mode: the host's own device shows the full-screen board
 * with the draw button (an iPad cast to a TV). Remembered per room so a
 * reload stays on the board.
 */
export function getBigScreen(code: string): boolean {
  try {
    return localStorage.getItem(`bingo_bigscreen:${code}`) === "1";
  } catch {
    return false;
  }
}
export function setBigScreen(code: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(`bingo_bigscreen:${code}`, "1");
    else localStorage.removeItem(`bingo_bigscreen:${code}`);
  } catch {
    /* ignore */
  }
}

/** Last name typed on this device, to prefill the join form. */
export function lastName(): string {
  try {
    return localStorage.getItem("bingo_last_name") ?? "";
  } catch {
    return "";
  }
}
export function rememberName(name: string): void {
  try {
    localStorage.setItem("bingo_last_name", name);
  } catch {
    /* ignore */
  }
}

/** This device's saved default big-screen look, sent with createRoom. */
export function getDisplayDefault(): DisplaySettings | null {
  try {
    const raw = localStorage.getItem("bingo_display_default");
    return raw ? (JSON.parse(raw) as DisplaySettings) : null;
  } catch {
    return null;
  }
}
export function setDisplayDefault(d: DisplaySettings | null): void {
  try {
    if (d) localStorage.setItem("bingo_display_default", JSON.stringify(d));
    else localStorage.removeItem("bingo_display_default");
  } catch {
    /* ignore */
  }
}
