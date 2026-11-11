import { io, type Socket } from "socket.io-client";
import { createCall, serverOrigin, SOCKET_OPTIONS } from "@bargames/gamekit/client";
import type { ClientToServerEvents, ServerToClientEvents } from "@bingo/shared";

// In dev, Vite serves the client on :5174 while the server runs on :3002. In production
// the server serves the built client itself, so both share one origin (one Cloudflare
// Tunnel hostname, no exposed port).
export const serverUrl = serverOrigin({ vitePort: 5174, serverPort: 3002 });

// WebSocket first (the kit's SOCKET_OPTIONS). With socket.io's default (start on HTTP
// long-polling, then upgrade), events emitted right after page load rode the polling
// transport and were intermittently lost through the Cloudflare Tunnel: the join form's
// ack timed out and the server never saw the event. Polling stays as a fallback.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  ...SOCKET_OPTIONS,
  transports: [...SOCKET_OPTIONS.transports],
});

/** The kit's untyped call, for kit hooks that take one (useRoomConnection). */
export const rawCall = createCall(socket as unknown as Parameters<typeof createCall>[0]);

/** Emit with an ack as a promise. Rejects with the server's error message. */
export function call<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return rawCall<T>(event, ...args);
}
