import { createServer } from "http";
import { existsSync } from "fs";
import path from "path";
import express from "express";
import { Server } from "socket.io";
import { DEFAULT_GAME_NAME } from "@bingo/shared";
import { CLIENT_DIST_PATH, PORT } from "./config.js";
import { RoomManager } from "./rooms/RoomManager.js";
import { initAdminAuth } from "./admin/auth.js";
import { adminRouter } from "./admin/routes.js";
import { initAdminSettings } from "./admin/settings.js";
import { registerSocketHandlers, type IO } from "./socket/index.js";
import { bg, displayName, registerBarGames } from "./bargames.js";
import { log } from "./util/logger.js";

await initAdminSettings();
await initAdminAuth();

const app = express();
const httpServer = createServer(app);
const io: IO = new Server(httpServer, {
  // Spot half-open mobile connections in ~15s instead of ~45s.
  pingInterval: 10_000,
  pingTimeout: 5_000,
  maxHttpBufferSize: 64 * 1024,
});

const rooms = new RoomManager({
  sendState: (socketId, view) => io.to(socketId).emit("state", view),
  sendClosed: (socketId, reason) => io.to(socketId).emit("closed", { reason }),
});

// Bar Games: /__bargames/* (venue.json, theme.css, command, status). Before
// the SPA catch-all, which would otherwise swallow those paths.
app.use(bg.middleware());
registerBarGames(rooms);

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});
app.use("/api/admin", adminRouter(rooms));
app.get("/api/config", async (_req, res) => {
  // On a Bar Games box: the venue's name for the game. Otherwise GAME_NAME, as before.
  res.json({ gameName: await displayName(process.env.GAME_NAME || DEFAULT_GAME_NAME) });
});

if (existsSync(CLIENT_DIST_PATH)) {
  app.use(express.static(CLIENT_DIST_PATH, { index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIST_PATH, "index.html")));
} else {
  log.warn("boot", "client build not found; serving API only", { path: CLIENT_DIST_PATH });
}

registerSocketHandlers(io, rooms);

httpServer.listen(PORT, () => {
  log.info("boot", "listening", { port: PORT });
});

let shuttingDown = false;
function shutdown(reason: string, exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("boot", "shutting down", { reason });
  rooms.closeAll(
    exitCode === 0
      ? "The server is restarting for an update. Please rejoin in a minute."
      : "The server hit an unexpected error and had to restart. Please rejoin in a minute.",
  );
  void bg.flush(); // Bar Games: send the room_closed events (no-op off a box)
  // Give socket.io a moment to flush the "closed" messages.
  setTimeout(() => process.exit(exitCode), 500).unref();
}
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("uncaughtException", (err) => {
  log.error("boot", "uncaught exception", { err: String(err?.stack ?? err) });
  shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (err) => {
  log.error("boot", "unhandled rejection", { err: String(err) });
  shutdown("unhandledRejection", 1);
});
