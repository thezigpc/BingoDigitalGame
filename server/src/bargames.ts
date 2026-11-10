// The game's single connection to a Bar Games box (see BARGAMES.md).
//
// Off a box (no BG_CORE_URL / BG_GAME_TOKEN env) every call here is a no-op and
// the game behaves exactly as before: that's guaranteed by the SDK.

import { createBarGames, type CommandResult, type GameStatus } from "@bargames/sdk/server";
import type { IncomingMessage } from "node:http";
import { DEFAULT_GAME_NAME } from "@bingo/shared";
import { GameError } from "./rooms/errors.js";
import type { Room } from "./rooms/Room.js";
import type { RoomManager } from "./rooms/RoomManager.js";

export const bg = createBarGames({
  gameId: "bingo",
  defaultName: process.env.GAME_NAME || DEFAULT_GAME_NAME,
});

/** True when running on a box. Guards anything box-only. */
export const onBox = bg.connected;

/**
 * Real player IP for rate limits and logs. Off a box it returns exactly what
 * the old `cf-connecting-ip ?? socket address` expression did.
 */
export const clientIp = (req: IncomingMessage): string => bg.clientIp(req);

/** Display name: the venue's rename on a box, otherwise the game's own GAME_NAME logic. */
export async function displayName(fallback: string): Promise<string> {
  return onBox ? (await bg.venue()).game.displayName : fallback;
}

/** Same text the host's own "Close room" sends to everyone in the room. */
export const HOST_CLOSE_REASON = "The host ended this room.";

/**
 * Level 3: the venue's iPad (or a schedule / Home Assistant) acting as the
 * room's host. Each command runs the same Room method the host's socket intent
 * does, then broadcasts, exactly like the socket `on(...)` wrapper. Refusals
 * come back as { ok: false, message } with the game's own error text; nothing
 * here throws.
 */
export function registerBarGames(rooms: RoomManager): void {
  /** fn returns a refusal message, or runs the host's Room method and returns nothing. */
  const asHost =
    (fn: (room: Room) => string | void) =>
    ({ roomCode }: { roomCode?: string }): CommandResult => {
      const room = roomCode ? rooms.get(roomCode) : undefined;
      if (!room) return { ok: false, message: "No room with that code." };
      try {
        const refused = fn(room);
        if (refused) return { ok: false, message: refused };
        room.broadcast();
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof GameError ? err.message : "That didn't work." };
      }
    };
  const NOT_PLAYING = "No game is being played in this room.";

  bg.onCommand(
    "start",
    asHost((room) => (room.phase !== "lobby" ? "The game has already started." : room.startGame())),
  );
  bg.onCommand(
    "pause",
    asHost((room) =>
      room.phase !== "playing" ? NOT_PLAYING : room.paused ? "The game is already paused." : room.setPaused(true),
    ),
  );
  bg.onCommand(
    "resume",
    asHost((room) =>
      room.phase !== "playing" ? NOT_PLAYING : !room.paused ? "The game isn't paused." : room.setPaused(false),
    ),
  );
  // The host's "New game": ends the current game, then deals and starts the next one.
  bg.onCommand("next_round", asHost((room) => (room.phase !== "playing" ? NOT_PLAYING : room.newGame(true))));
  bg.onCommand("end", ({ roomCode }) => {
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (!room) return { ok: false, message: "No room with that code." };
    rooms.closeRoom(room.code, HOST_CLOSE_REASON, "host");
    return { ok: true };
  });

  bg.setStatusProvider(
    (): GameStatus => ({
      rooms: rooms.all().map((r) => {
        const s = r.summary();
        return {
          code: r.code,
          kind: r.kind,
          players: s.players,
          phase: r.phase,
          title: `Game ${r.gameNumber}: ${r.pattern().name}`,
          hostConnected: s.hostConnected,
        };
      }),
    }),
  );
}

export type { GameStatus };
