import { io, type Socket } from "socket.io-client";
import { createCall, serverBase, serverOrigin, socketPath, SOCKET_OPTIONS } from "@bargames/gamekit/client";
import type { ClientToServerEvents, ServerToClientEvents } from "@bingo/shared";

// In dev, Vite serves the client on :5174 while the server runs on :3002. In production
// the server serves the built client itself, so both share one origin (one Cloudflare
// Tunnel hostname, no exposed port).
//
// Under a path prefix (a Bar Games box's https://<venue>/bingo/, or BASE_PATH behind your
// own proxy) the server injects the prefix into index.html. `serverUrl` carries it, so
// every fetch is `${serverUrl}/api/...`; socket.io takes the bare origin plus a `path`
// (a URL's path would be read as a namespace). At the root both are as before.
const dev = { vitePort: 5174, serverPort: 3002 };
export const serverUrl = serverBase(dev);

// WebSocket first (the kit's SOCKET_OPTIONS). With socket.io's default (start on HTTP
// long-polling, then upgrade), events emitted right after page load rode the polling
// transport and were intermittently lost through the Cloudflare Tunnel: the join form's
// ack timed out and the server never saw the event. Polling stays as a fallback.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverOrigin(dev), {
  ...SOCKET_OPTIONS,
  path: socketPath(),
});

const kitCall = createCall(socket as unknown as Parameters<typeof createCall>[0]);

/** Emit with an ack as a promise. Rejects with the server's error message. */
export function call<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return kitCall<T>(event, ...args);
}

const slowKitCall = kitCall.withTimeout(30_000);

/** The same, with 30 s to answer: casting to venue TVs (AirPlay can take a while). */
export function slowCall<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return slowKitCall<T>(event, ...args);
}
