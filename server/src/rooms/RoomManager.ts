import type { SessionKind } from "@bargames/sdk";
import type { AdminRoomSummary } from "@bingo/shared";
import { MAX_ROOMS, ROOM_SWEEP_INTERVAL_MS } from "../config.js";
import { getAdminSettings } from "../admin/settings.js";
import { bg } from "../bargames.js";
import { log } from "../util/logger.js";
import { GameError } from "./errors.js";
import { newRoomCode } from "./ids.js";
import { Room, type RoomTransport } from "./Room.js";

export const IDLE_CLOSE_REASON = "This room was closed after a long period of inactivity.";
export const ADMIN_CLOSE_REASON = "An administrator closed this room.";

/** Why a room closed, for the Bar Games room_closed event. */
export type CloseCause = "host" | "admin" | "idle" | "error" | "shutdown";

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly transport: RoomTransport) {
    setInterval(() => this.sweepIdleRooms(), ROOM_SWEEP_INTERVAL_MS).unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  create(kind: SessionKind = "patron"): Room {
    if (this.rooms.size >= MAX_ROOMS) throw new GameError("ROOM_FULL");
    let code = newRoomCode();
    while (this.rooms.has(code)) code = newRoomCode();
    const room = new Room(code, this.transport);
    room.kind = kind;
    room.onFatalError = () => this.closeRoom(code, "Something went wrong and this room had to close.", "error");
    this.rooms.set(code, room);
    log.info("room", "created", { code, rooms: this.rooms.size });
    bg.emit({ type: "room_created", roomCode: code, sessionKind: room.kind });
    return room;
  }

  /**
   * Bar Games create_room: a room the box starts for its TVs, with no host
   * phone. It gets an empty host seat (named "Venue") so venue staff can take
   * the host controls later with the seat's token (the hostUrl).
   */
  createVenueRoom({ kind = "venue", title }: { kind?: SessionKind; title?: string } = {}): { room: Room; hostToken: string } {
    const room = this.create(kind);
    room.title = title?.trim().slice(0, 60) || undefined;
    room.setDisplay(getAdminSettings().displayDefaults);
    const host = room.addHost("Venue");
    return { room, hostToken: host.token };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  list(): AdminRoomSummary[] {
    return [...this.rooms.values()].map((r) => r.summary()).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  closeRoom(code: string, reason: string, cause: CloseCause): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    room.close(reason);
    this.rooms.delete(code);
    log.info("room", "closed", { code, reason, rooms: this.rooms.size });
    bg.emit({ type: "room_closed", roomCode: code, sessionKind: room.kind, data: { reason: cause } });
    return true;
  }

  closeAll(reason: string): void {
    for (const code of [...this.rooms.keys()]) this.closeRoom(code, reason, "shutdown");
  }

  /** Closes every room idle for longer than `minutes`. Returns the codes closed. */
  closeIdle(minutes: number, reason: string, now = Date.now(), cause: CloseCause = "idle"): string[] {
    const closed: string[] = [];
    for (const [code, room] of [...this.rooms]) {
      try {
        // A box's venue room has no host phone; it stays open while a TV shows it.
        if (cause === "idle" && room.kind === "venue" && room.hasConnectedTable()) continue;
        if (now - room.lastActivityAt > minutes * 60_000 && this.closeRoom(code, reason, cause)) closed.push(code);
      } catch (err) {
        log.error("room", "idle close failed for room", { code, err: String(err) });
      }
    }
    return closed;
  }

  /** Auto-close, using the admin-set idle time (read fresh every sweep). */
  sweepIdleRooms(now = Date.now()): void {
    this.closeIdle(getAdminSettings().roomIdleMinutes, IDLE_CLOSE_REASON, now);
  }
}
