import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@bingo/shared";

// In dev, Vite serves the client on :5174 while the server runs on :3002.
// In production the server serves the built client itself, so both share one
// origin (one Cloudflare Tunnel hostname, no exposed port).
const isViteDevServer = window.location.port === "5174";
export const serverUrl = isViteDevServer
  ? `${window.location.protocol}//${window.location.hostname}:3002`
  : window.location.origin;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  autoConnect: false,
  // WebSocket first. With socket.io's default (start on HTTP long-polling,
  // then upgrade), events emitted right after page load rode the polling
  // transport and were intermittently lost through the Cloudflare Tunnel -
  // the join form's ack timed out and the server never saw the event.
  // Polling stays as a fallback for networks that block WebSockets.
  transports: ["websocket", "polling"],
});

type AckResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Emit with an ack as a promise. Rejects with the server's error message. */
export function call<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  if (!socket.connected) socket.connect();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The server didn't respond. Check your connection.")), 8000);
    (socket.emit as (e: string, ...a: unknown[]) => void)(event, ...args, (res: AckResult<T>) => {
      clearTimeout(timer);
      if (res.ok) resolve(res as T);
      else reject(new Error(res.error));
    });
  });
}
