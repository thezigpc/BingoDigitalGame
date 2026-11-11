// The room registry (the game kit's RoomRegistry): codes, the room cap, the idle sweep
// (a box's venue room stays open while a TV shows it), close causes, crash containment
// and debounced players_changed. Bingo's Room implements the kit's KitRoom.

import { RoomRegistry, type SessionKind } from "@bargames/gamekit/server";
import type { AdminRoomSummary } from "@bingo/shared";
import { getAdminSettings } from "../admin/settings.js";
import { MAX_ROOMS, ROOM_SWEEP_INTERVAL_MS } from "../config.js";
import { GameError } from "./errors.js";
import { Room, type RoomTransport } from "./Room.js";

export const IDLE_CLOSE_REASON = "This room was closed after a long period of inactivity.";
export const ADMIN_CLOSE_REASON = "An administrator closed this room.";
export const ERROR_CLOSE_REASON = "Something went wrong and this room had to close.";

export type Rooms = RoomRegistry<Room>;
export type { CloseCause } from "@bargames/gamekit/server";

export function createRooms(transport: RoomTransport): Rooms {
  const rooms: Rooms = new RoomRegistry<Room>({
    create: (code, kind, ctx) => {
      const room = new Room(code, transport, kind);
      // A throw in one room's timer closes only that room.
      room.onFatalError = () => ctx.close(ERROR_CLOSE_REASON, "error");
      // Joins, leaves, kicks and the paper-mode switch (never reconnects).
      room.onPlayersChanged = () => rooms.notePlayers(room);
      return room;
    },
    maxRooms: MAX_ROOMS,
    // Bingo's codes as before: 4 letters from the kit's default alphabet (no 0/O, 1/I/L),
    // and typed codes only trimmed and uppercased.
    normalizeCode: (code) => code.trim().toUpperCase(),
    idleMinutes: () => getAdminSettings().roomIdleMinutes, // read fresh every sweep
    sweepIntervalMs: ROOM_SWEEP_INTERVAL_MS,
    idleReason: IDLE_CLOSE_REASON,
    errorReason: ERROR_CLOSE_REASON,
    fullError: () => new GameError("ROOM_FULL"),
    // SDK 0.4.0: a "Join" button on the venue's games list (never for private rooms).
    joinPath: (r) => `/join/${r.code}`,
  });
  return rooms;
}

/**
 * Bar Games create_room: a room the box starts for its TVs, with no host phone. It gets
 * an empty host seat (named "Venue") so venue staff can take the host controls later
 * with the seat's token (the hostUrl).
 */
export function createVenueRoom(rooms: Rooms, kind: SessionKind = "venue", title?: string): { room: Room; hostToken: string } {
  let hostToken = "";
  const room = rooms.create(kind, (r) => {
    r.title = title?.trim().slice(0, 60) || undefined;
    r.setDisplay(getAdminSettings().displayDefaults);
    hostToken = r.addHost("Venue").token;
  });
  return { room, hostToken };
}

/** What the /admin room list shows, most recently active first. */
export function listRooms(rooms: Rooms): AdminRoomSummary[] {
  return rooms
    .all()
    .map((r) => r.summary())
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
