// The game's single connection to a Bar Games box (see BARGAMES.md).
//
// Off a box (no BG_CORE_URL / BG_GAME_TOKEN env) every call here is a no-op and
// the game behaves exactly as before: that's guaranteed by the SDK.

import { wireBarGames } from "@bargames/gamekit/bargames";
import { createBarGames, type CommandResult } from "@bargames/sdk/server";
import type { IncomingMessage } from "node:http";
import { DEFAULT_GAME_NAME } from "@bingo/shared";
import { createVenueRoom, type Rooms } from "./rooms/registry.js";
import type { Room } from "./rooms/Room.js";

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

/** TV ids and PIN from a host's cast request, bounded. Bad input: no ids. */
function castArgs(req: unknown): { ids: string[]; pin?: string } {
  const r = (req ?? {}) as { ids?: unknown; pin?: unknown };
  const ids = Array.isArray(r.ids)
    ? r.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, 50)
    : [];
  const pin = typeof r.pin === "string" && r.pin ? r.pin.slice(0, 32) : undefined;
  return { ids, pin };
}

/**
 * Casting from the host screen (step 6b). Callers check the room's host first.
 * Off a box the SDK answers enabled: false / ok: false without any network call.
 */
export const tvs = {
  list: () => bg.displays(),
  cast: (room: Room, req: unknown) => {
    const { ids, pin } = castArgs(req);
    return ids.length ? bg.cast(room.code, ids, { pin }) : Promise.resolve({ ok: false, message: "Pick a TV first." });
  },
  stop: (req: unknown) => {
    const { ids, pin } = castArgs(req);
    return ids.length ? bg.stopCast(ids, { pin }) : Promise.resolve({ ok: false, message: "Pick a TV first." });
  },
};

/** Same text the host's own "Close room" sends to everyone in the room. */
export const HOST_CLOSE_REASON = "The host ended this room.";

/**
 * Level 3, through the game kit's wireBarGames: status (every room's overview), the
 * room_created / room_closed / players_changed events, "end", create_room and the claim
 * commands. Each command runs the same Room method the host's socket intent does, then
 * broadcasts, exactly like the socket `on(...)` wrapper. Refusals come back as
 * { ok: false, message } with the game's own text.
 */
export function registerBarGames(rooms: Rooms): void {
  /** fn returns a refusal message, or runs the host's Room method and returns nothing. */
  const asHost =
    (fn: (room: Room) => string | void) =>
    (room: Room): CommandResult => {
      const refused = fn(room);
      if (refused) return { ok: false, message: refused };
      room.broadcast();
      return { ok: true };
    };
  const NOT_PLAYING = "No game is being played in this room.";

  wireBarGames(bg, rooms, {
    // The box starts a room for its TVs (iPad: "Put a game on the TVs > New room").
    // No host phone: the commands drive it, and hostUrl opens the empty host seat on
    // the staff iPad. Opening /join/{code}?as=table casts it.
    createVenueRoom: ({ kind, title }) => {
      const { room, hostToken } = createVenueRoom(rooms, kind ?? "venue", title); // GameError("ROOM_FULL") at the cap
      room.broadcast();
      return { room, hostUrl: `/join/${room.code}?host=${encodeURIComponent(hostToken)}` };
    },
    commands: {
      start: asHost((room) => (room.phase !== "lobby" ? "The game has already started." : room.startGame())),
      pause: asHost((room) =>
        room.phase !== "playing" ? NOT_PLAYING : room.paused ? "The game is already paused." : room.setPaused(true),
      ),
      resume: asHost((room) =>
        room.phase !== "playing" ? NOT_PLAYING : !room.paused ? "The game isn't paused." : room.setPaused(false),
      ),
      // The host's "New game": ends the current game, then deals and starts the next one.
      next_round: asHost((room) => (room.phase !== "playing" ? NOT_PLAYING : room.newGame(true))),
    },
    // Staff confirm or turn down a BINGO from the iPad: the host's Confirm winner /
    // Dismiss buttons. The kit picks the oldest waiting claim when no claimId is given.
    claims: {
      confirm: (room, id) => asHost((r) => r.resolveClaim(id, true))(room),
      reject: (room, id, reason) => asHost((r) => r.resolveClaim(id, false, reason))(room),
    },
    // "end" closes the room like the host's own Close room, with the same message.
    endReason: HOST_CLOSE_REASON,
  });
}
