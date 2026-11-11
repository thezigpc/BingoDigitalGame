// The game's single connection to a Bar Games box (see BARGAMES.md).
//
// Off a box (no BG_CORE_URL / BG_GAME_TOKEN env) every call here is a no-op and
// the game behaves exactly as before: that's guaranteed by the SDK.

import { createBarGames, type ClaimArgs, type CommandResult, type GameStatus } from "@bargames/sdk/server";
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
 * Level 3: the venue's iPad (or a schedule / Home Assistant) acting as the
 * room's host. Each command runs the same Room method the host's socket intent
 * does, then broadcasts, exactly like the socket `on(...)` wrapper. Refusals
 * come back as { ok: false, message } with the game's own error text; nothing
 * here throws.
 */
export function registerBarGames(rooms: RoomManager): void {
  /** fn returns a refusal message, or runs the host's Room method and returns nothing. */
  const asHost =
    (fn: (room: Room, args: unknown) => string | void) =>
    ({ roomCode, args }: { roomCode?: string; args?: unknown }): CommandResult => {
      const room = roomCode ? rooms.get(roomCode) : undefined;
      if (!room) return { ok: false, message: "No room with that code." };
      try {
        const refused = fn(room, args);
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
  // Staff confirm or turn down a BINGO from the iPad: the host's Confirm winner /
  // Dismiss buttons (room.resolveClaim). No claimId: the oldest one waiting.
  const resolveClaim = (confirm: boolean) =>
    asHost((room, args) => {
      const { claimId, reason } = (args ?? {}) as ClaimArgs;
      const claim =
        claimId === undefined || claimId === null || claimId === ""
          ? room.pendingClaims()[0]?.claim
          : room.claims.find((c) => c.id === String(claimId));
      if (!claim) return claimId ? "That BINGO claim doesn't exist." : "No BINGO claim is waiting in this room.";
      if (claim.status === "invalid") return "That claim wasn't a valid BINGO, so there's nothing to decide.";
      if (claim.status !== "pending") {
        return `That BINGO claim was already ${claim.status === "confirmed" ? "confirmed" : "turned down"}.`;
      }
      room.resolveClaim(claim.id, confirm, confirm || typeof reason !== "string" ? undefined : reason);
    });
  bg.onCommand("confirm_claim", resolveClaim(true));
  bg.onCommand("reject_claim", resolveClaim(false));

  bg.onCommand("end", ({ roomCode }) => {
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (!room) return { ok: false, message: "No room with that code." };
    rooms.closeRoom(room.code, HOST_CLOSE_REASON, "host");
    return { ok: true };
  });

  // The box starts a room for its TVs (iPad: "Put a game on the TVs > New room").
  // No host phone: the commands above drive it, and hostUrl opens the empty
  // host seat on the staff iPad. Opening /join/{code}?as=table casts it.
  bg.onCreateRoom(({ kind, title }) => {
    const { room, hostToken } = rooms.createVenueRoom({ kind, title }); // throws GameError("ROOM_FULL") at the cap
    room.broadcast();
    return { roomCode: room.code, hostUrl: `/join/${room.code}?host=${encodeURIComponent(hostToken)}` };
  });

  bg.setStatusProvider(
    (): GameStatus => ({
      rooms: rooms.all().map((r) => {
        const s = r.summary();
        const pending = r.pendingClaims();
        return {
          code: r.code,
          kind: r.kind,
          players: s.players,
          phase: r.phase,
          title: `${r.title ? `${r.title} · ` : ""}Game ${r.gameNumber}: ${r.pattern().name}`,
          hostConnected: s.hostConnected,
          // Left out when nothing is waiting.
          pendingClaims: pending.length === 0 ? undefined : pending.map(({ claim, at }) => ({
            id: claim.id,
            player: claim.playerName,
            detail: `${r.pattern().name} on card ${claim.cardId}, after ${claim.callCount} calls`,
            at: new Date(at).toISOString(),
          })),
        };
      }),
    }),
  );
}

export type { GameStatus };
