import { ADMIN_SETTINGS_LIMITS, sanitizeDisplay, type AdminSettings } from "@bingo/shared";
import { DEFAULT_ROOM_IDLE_MINUTES } from "../config.js";
import { readJson, writeJson } from "./store.js";

const FILE = "settings.json";

let current: AdminSettings = { roomIdleMinutes: DEFAULT_ROOM_IDLE_MINUTES, displayDefaults: {} };

export async function initAdminSettings(): Promise<void> {
  const saved = await readJson<Partial<AdminSettings>>(FILE);
  if (!saved) return;
  try {
    current = { ...current, ...validate(saved) };
  } catch {
    // A hand-edited or older settings file shouldn't stop the server.
    current = { ...current, displayDefaults: sanitizeDisplay(saved.displayDefaults) ?? {} };
  }
}

export function getAdminSettings(): AdminSettings {
  return { ...current };
}

export async function updateAdminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  current = { ...current, ...validate(patch) };
  await writeJson(FILE, current);
  return getAdminSettings();
}

function validate(patch: Partial<AdminSettings>): Partial<AdminSettings> {
  const out: Partial<AdminSettings> = {};
  if (patch.roomIdleMinutes !== undefined) {
    const { min, max } = ADMIN_SETTINGS_LIMITS.roomIdleMinutes;
    const n = Math.round(Number(patch.roomIdleMinutes));
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`Idle time must be between ${min} and ${max} minutes.`);
    }
    out.roomIdleMinutes = n;
  }
  if (patch.displayDefaults !== undefined) {
    const clean = sanitizeDisplay(patch.displayDefaults);
    if (!clean) throw new Error("Those display settings aren't valid.");
    out.displayDefaults = clean;
  }
  return out;
}
