import express, { type Request, type Response, type NextFunction } from "express";
import type { AdminOverview, AdminSettings } from "@bingo/shared";
import { ADMIN_CLOSE_REASON, type RoomManager } from "../rooms/RoomManager.js";
import { clientIp } from "../bargames.js";
import { log } from "@bargames/gamekit/server";
import { isValidSession, login, loginBlocked, logout, setupNeeded, setupPassword } from "./auth.js";
import { getAdminSettings, updateAdminSettings } from "./settings.js";

const bearer = (req: Request) => req.get("authorization")?.replace(/^Bearer\s+/i, "");

/** /api/admin/*: password login, room list/close, and admin settings. */
export function adminRouter(rooms: RoomManager): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: "16kb" }));
  // Admin responses are never cacheable.
  r.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  r.get("/status", (req, res) => {
    res.json({ setupNeeded: setupNeeded(), authenticated: isValidSession(bearer(req)) });
  });

  r.post("/setup", async (req, res) => {
    try {
      const token = await setupPassword(String(req.body?.password ?? ""));
      res.json({ ok: true, token });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "Setup failed." });
    }
  });

  r.post("/login", async (req, res) => {
    const ip = clientIp(req);
    if (loginBlocked(ip)) {
      res.status(429).json({ ok: false, error: "Too many failed attempts. Try again in 15 minutes." });
      return;
    }
    const token = await login(String(req.body?.password ?? ""), ip);
    if (!token) {
      res.status(401).json({ ok: false, error: "Wrong password." });
      return;
    }
    res.json({ ok: true, token });
  });

  r.post("/logout", (req, res) => {
    logout(bearer(req));
    res.json({ ok: true });
  });

  // Everything below needs a signed-in admin.
  r.use((req: Request, res: Response, next: NextFunction) => {
    if (!isValidSession(bearer(req))) {
      res.status(401).json({ ok: false, error: "Please sign in again." });
      return;
    }
    next();
  });

  r.get("/overview", (_req, res) => {
    const body: AdminOverview = { rooms: rooms.list(), settings: getAdminSettings(), serverTime: Date.now() };
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
      rooms.sweepIdleRooms();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "Couldn't save." });
    }
  });

  return r;
}
