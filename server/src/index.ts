import { createServer } from "http";
import { existsSync } from "fs";
import path from "path";
import express from "express";
import { Server } from "socket.io";
import { DEFAULT_GAME_NAME } from "@bingo/shared";
import { CLIENT_DIST_PATH, PORT } from "./config.js";
import { createRooms } from "./rooms/registry.js";
import { adminAuth, adminRouter } from "./admin/routes.js";
import { initAdminSettings } from "./admin/settings.js";
import { registerSocketHandlers, type IO } from "./socket/index.js";
import { bg, displayName, registerBarGames } from "./bargames.js";
import { installShutdown, log, SOCKET_SERVER_OPTIONS } from "@bargames/gamekit/server";

await initAdminSettings();
await adminAuth.init();

const app = express();
const httpServer = createServer(app);
const io: IO = new Server(httpServer, {
  // Spot half-open mobile connections in ~15s instead of ~45s (10 s ping, 5 s timeout).
  ...SOCKET_SERVER_OPTIONS,
  maxHttpBufferSize: 64 * 1024,
});

const rooms = createRooms({
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

// SIGTERM/SIGINT (deploys) and crashes: tell every room why, flush the Bar Games
// room_closed events, give socket.io a moment to deliver, then exit.
installShutdown(rooms, {
  restartReason: "The server is restarting for an update. Please rejoin in a minute.",
  crashReason: "The server hit an unexpected error and had to restart. Please rejoin in a minute.",
  drainMs: 500,
  flush: () => bg.flush(),
  beforeExit: () => void io.close(),
});
