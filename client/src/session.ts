import { createSessionStore } from "@bargames/gamekit/client";
import type { DisplaySettings, Role } from "@bingo/shared";

export interface StoredSession {
  roomCode: string;
  token: string;
  name: string;
  role: Role;
}

// The kit's session store, with Bingo's existing keys: the seat is per tab
// ("bingo_session:<tab id>", the id in sessionStorage "bingo_tab_id") so hosting in one
// tab and opening the Table display in another doesn't overwrite the host's seat; it
// lives in localStorage so it survives a mobile browser evicting a backgrounded tab.
// Storage errors (private mode) never throw.
export const sessions = createSessionStore<StoredSession>("bingo");

export const loadSession = (): StoredSession | null => sessions.load();
export const saveSession = (s: StoredSession): void => sessions.save(s);
export const clearSession = (): void => sessions.clear();

/**
 * Host "big screen" mode: the host's own device shows the full-screen board with the
 * draw button (an iPad cast to a TV). Remembered per room ("bingo_bigscreen:<code>") so
 * a reload stays on the board.
 */
export const getBigScreen = (code: string): boolean => sessions.pref(`bigscreen:${code}`) === "1";
export const setBigScreen = (code: string, on: boolean): void => sessions.setPref(`bigscreen:${code}`, on ? "1" : null);

/** Last name typed on this device ("bingo_last_name"), to prefill the join form. */
export const lastName = (): string => sessions.pref("last_name");
export const rememberName = (name: string): void => sessions.setPref("last_name", name);

/** This device's saved default big-screen look ("bingo_display_default"), sent with createRoom. */
export const getDisplayDefault = (): DisplaySettings | null => sessions.json<DisplaySettings>("display_default");
export const setDisplayDefault = (d: DisplaySettings | null): void => sessions.setJson("display_default", d);
