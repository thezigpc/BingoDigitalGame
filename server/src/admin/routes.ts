import { adminRouter as kitAdminRouter, createAdminAuth, log } from "@bargames/gamekit/server";
import type express from "express";
import type { AdminOverview, AdminSettings } from "@bingo/shared";
import { ADMIN_PASSWORD, store } from "../config.js";
import { ADMIN_CLOSE_REASON, listRooms, type Rooms } from "../rooms/registry.js";
import { clientIp, onBox } from "../bargames.js";
import { getAdminSettings, updateAdminSettings } from "./settings.js";

/**
 * The admin password (the kit's admin auth): the ADMIN_PASSWORD env var, or a scrypt hash
 * chosen once on the /admin setup screen and kept in DATA_DIR/admin.json. Whoever
 * completes setup first becomes admin, so do it right after deploying.
 */
export const adminAuth = createAdminAuth({
  store,
  envPassword: ADMIN_PASSWORD,
  // Bingo's admin.json has always derived keys from the salt's bytes. Must match, or
  // every live admin is locked out.
  saltFormat: "bytes",
  // Standalone behind Cloudflare a whole venue's Wi-Fi shares one public IP, so a
  // per-IP lockout would let any guest lock the real admin out; the kit's global cap
  // and capped delay still slow guessing. On a box each device has its own address.
  failsAllowed: onBox ? undefined : Infinity,
});

/** /api/admin/*: the kit's status, setup, login and logout, then Bingo's room list, close and settings. */
export function adminRouter(rooms: Rooms): express.Router {
  const r = kitAdminRouter({ auth: adminAuth, clientIp });

  // Everything below needs a signed-in admin (the kit's router checks it).
  r.get("/overview", (_req, res) => {
    const body: AdminOverview = { rooms: listRooms(rooms), settings: getAdminSettings(), serverTime: Date.now() };
    res.json(body);
  });

  r.post("/rooms/:code/close", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const ok = rooms.closeRoom(code, ADMIN_CLOSE_REASON, "admin");
    log.info("admin", "closed room", { code, ok });
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { ok: false, error: "That room is already gone." });
  });

  r.post("/rooms/close-idle", (req, res) => {
    const minutes = Number(req.body?.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      res.status(400).json({ ok: false, error: "Enter a number of minutes." });
      return;
    }
    const closed = rooms.closeIdle(minutes, ADMIN_CLOSE_REASON, Date.now(), "admin");
    log.info("admin", "closed idle rooms", { minutes, count: closed.length });
    res.json({ ok: true, closed });
  });

  r.put("/settings", async (req, res) => {
    try {
      const settings = await updateAdminSettings((req.body ?? {}) as Partial<AdminSettings>);
      log.info("admin", "settings updated", { roomIdleMinutes: settings.roomIdleMinutes });
      // Apply the new idle time right away rather than at the next sweep.
      rooms.sweepIdle();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "Couldn't save." });
    }
  });

  return r;
}
