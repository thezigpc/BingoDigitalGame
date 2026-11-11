import path from "path";
import { createJsonStore } from "@bargames/gamekit/server";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const PORT = num("PORT", 3002);
/** Built client, served by this process in production (one origin, one tunnel hostname). */
export const CLIENT_DIST_PATH = process.env.CLIENT_DIST_PATH ?? path.resolve(here, "../../client/dist");
/**
 * Persisted admin state (password hash, admin-set settings). Kept outside the
 * code so deploys never touch it; deploy-dev.ps1 excludes it from its mirror.
 */
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, "../../data");
/** JSON files in DATA_DIR (admin password hash, admin settings). */
export const store = createJsonStore(DATA_DIR);
/**
 * Default for the admin "close rooms after N minutes idle" setting, used
 * until an admin saves one. The live value comes from admin/settings.ts.
 */
export const DEFAULT_ROOM_IDLE_MINUTES = num("ROOM_IDLE_MINUTES", 120);
export const ROOM_SWEEP_INTERVAL_MS = num("ROOM_SWEEP_INTERVAL_MS", 60 * 1000);
/** Overrides the admin password set through the /admin setup screen. */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
export const MAX_ROOMS = num("MAX_ROOMS", 200);
export const MAX_PLAYERS_PER_ROOM = num("MAX_PLAYERS_PER_ROOM", 100);
export const MAX_TABLES_PER_ROOM = num("MAX_TABLES_PER_ROOM", 5);
