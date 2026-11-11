import { createSettingStore } from "@bargames/gamekit/server";
import { ADMIN_SETTINGS_LIMITS, sanitizeDisplay, type AdminSettings } from "@bingo/shared";
import { DEFAULT_ROOM_IDLE_MINUTES, store } from "../config.js";

// Admin settings in DATA_DIR/settings.json (the kit's setting store: atomic writes, and
// a damaged file is left untouched while the defaults apply).
const settings = createSettingStore<AdminSettings>({
  store,
  file: "settings.json",
  defaults: { roomIdleMinutes: DEFAULT_ROOM_IDLE_MINUTES, displayDefaults: {} },
  normalize: clean,
});

export const initAdminSettings = () => settings.init();
export const getAdminSettings = (): AdminSettings => settings.get();

/** Validates only the fields being changed (a readable error if one is bad), then saves. */
export async function updateAdminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  return settings.set(validate(patch));
}

const idleOk = (n: number) =>
  Number.isFinite(n) && n >= ADMIN_SETTINGS_LIMITS.roomIdleMinutes.min && n <= ADMIN_SETTINGS_LIMITS.roomIdleMinutes.max;

/**
 * A loaded or merged settings object, cleaned: unknown keys dropped, a bad saved value
 * replaced by its default (a hand-edited or older file never stops the server).
 */
function clean(s: AdminSettings): AdminSettings {
  const n = Math.round(Number(s.roomIdleMinutes));
  return {
    roomIdleMinutes: idleOk(n) ? n : DEFAULT_ROOM_IDLE_MINUTES,
    displayDefaults: sanitizeDisplay(s.displayDefaults) ?? {},
  };
}

function validate(patch: Partial<AdminSettings>): Partial<AdminSettings> {
  const out: Partial<AdminSettings> = {};
  if (patch.roomIdleMinutes !== undefined) {
    const { min, max } = ADMIN_SETTINGS_LIMITS.roomIdleMinutes;
    const n = Math.round(Number(patch.roomIdleMinutes));
    if (!idleOk(n)) throw new Error(`Idle time must be between ${min} and ${max} minutes.`);
    out.roomIdleMinutes = n;
  }
  if (patch.displayDefaults !== undefined) {
    const display = sanitizeDisplay(patch.displayDefaults);
    if (!display) throw new Error("Those display settings aren't valid.");
    out.displayDefaults = display;
  }
  return out;
}
