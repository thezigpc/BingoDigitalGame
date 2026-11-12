import type { Server, Socket } from "socket.io";
import {
  ERRORS,
  sanitizeDisplay,
  type DisplaySettings,
  type ClientToServerEvents,
  type JoinResult,
  type Mask,
  type RoomSettings,
  type ServerToClientEvents,
} from "@bingo/shared";
import { getAdminSettings } from "../admin/settings.js";
import { clientIp, HOST_CLOSE_REASON, tvs } from "../bargames.js";
import { GameError } from "../rooms/errors.js";
import type { Member, Room } from "../rooms/Room.js";
import type { Rooms } from "../rooms/registry.js";
import { log } from "@bargames/gamekit/server";

interface SocketData {
  code?: string;
  memberId?: string;
  lastEvent?: string;
}
export type IO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AckFn = (res: { ok: boolean; [k: string]: unknown }) => void;

// Failed join/resume attempts per IP: the room code is the only gate on the
// join URL, so guessing codes must not be free.
const JOIN_WINDOW_MS = 60_000;
const JOIN_FAILS_ALLOWED = 20;
const joinFails = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (joinFails.get(ip) ?? []).filter((t) => now - t < JOIN_WINDOW_MS);
  joinFails.set(ip, recent);
  return recent.length >= JOIN_FAILS_ALLOWED;
}
function noteJoinFail(ip: string): void {
  const list = joinFails.get(ip) ?? [];
  list.push(Date.now());
  joinFails.set(ip, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of joinFails) if (list.every((t) => now - t >= JOIN_WINDOW_MS)) joinFails.delete(ip);
}, JOIN_WINDOW_MS).unref();


export function registerSocketHandlers(io: IO, rooms: Rooms): void {
  io.on("connection", (socket: S) => {
    // Behind Cloudflare Tunnel every connection arrives from localhost, so the
    // real address is cf-connecting-ip; on a Bar Games box it's the gateway's
    // x-bargames-client-ip. clientIp() picks the right one.
    const ip = clientIp(socket.request);
    socket.onAny((event: string) => {
      socket.data.lastEvent = event;
    });

    const fail = (ack: AckFn | undefined, err: unknown) => {
      if (!(err instanceof GameError)) {
        log.error("socket", "handler threw", { event: socket.data.lastEvent, err: String(err) });
      }
      log.warn("socket", "rejected", {
        event: socket.data.lastEvent,
        code: socket.data.code,
        member: socket.data.memberId,
        error: err instanceof GameError ? err.code : "INTERNAL",
      });
      if (typeof ack === "function") {
        ack({ ok: false, error: err instanceof GameError ? err.message : ERRORS.BAD_REQUEST });
      }
    };

    const unbind = () => {
      const { code, memberId } = socket.data;
      socket.data.code = undefined;
      socket.data.memberId = undefined;
      if (code && memberId) {
        const room = rooms.get(code);
        if (room) {
          room.detachSocket(memberId, socket.id);
          room.broadcast();
        }
      }
    };

    const bind = (room: Room, member: Member): JoinResult => {
      if (socket.data.code !== room.code || socket.data.memberId !== member.id) unbind();
      room.attachSocket(member, socket.id);
      socket.data.code = room.code;
      socket.data.memberId = member.id;
      return { code: room.code, token: member.token, memberId: member.id, role: member.role, name: member.name };
    };

    /** Runs a room-scoped intent, then broadcasts the new state to everyone. */
    function on<A>(event: keyof ClientToServerEvents, fn: (room: Room, memberId: string, arg: A) => object | void) {
      (socket.on as (e: string, h: (...args: unknown[]) => void) => void)(event, (...args: unknown[]) => {
        const ack = args[args.length - 1] as AckFn;
        const arg = (args.length > 1 ? args[0] : undefined) as A;
        try {
          const { code, memberId } = socket.data;
          const room = code ? rooms.get(code) : undefined;
          if (!room || !memberId || !room.members.has(memberId)) throw new GameError("NOT_IN_ROOM");
          const result = fn(room, memberId, arg) ?? {};
          room.broadcast();
          if (typeof ack === "function") ack({ ok: true, ...result });
        } catch (err) {
          fail(ack, err);
        }
      });
    }

    /** Like on(), for the host only and async (the venue-TV calls go to the box). No broadcast. */
    function onHostAsync<A>(event: keyof ClientToServerEvents, fn: (room: Room, arg: A) => Promise<object>) {
      (socket.on as (e: string, h: (...args: unknown[]) => void) => void)(event, async (...args: unknown[]) => {
        const ack = args[args.length - 1] as AckFn;
        const arg = (args.length > 1 ? args[0] : undefined) as A;
        try {
          const { code, memberId } = socket.data;
          const room = code ? rooms.get(code) : undefined;
          if (!room || !memberId || !room.members.has(memberId)) throw new GameError("NOT_IN_ROOM");
          room.requireHost(memberId);
          const result = await fn(room, arg);
          if (typeof ack === "function") ack({ ok: true, ...result });
        } catch (err) {
          fail(ack, err);
        }
      });
    }

    // Venue TVs (Bar Games box only; off a box: enabled false and every cast refused).
    onHostAsync("listTvs", async () => ({ tvs: await tvs.list() }));
    onHostAsync("castToTvs", async (room, req) => {
      const result = await tvs.cast(room, req);
      log.info("room", "cast to TVs", { code: room.code, ok: result.ok });
      return { result };
    });
    onHostAsync("stopTvs", async (room, req) => {
      const result = await tvs.stop(req);
      log.info("room", "stopped TVs", { code: room.code, ok: result.ok });
      return { result };
    });

    socket.on("createRoom", (req, ack) => {
      try {
        const room = rooms.create();
        // Server-wide default look (admin), then the host device's own saved
        // default on top. A bad saved default is ignored, not fatal.
        room.setDisplay(getAdminSettings().displayDefaults);
        const mine = sanitizeDisplay(req?.display);
        if (mine) room.setDisplay(mine);
        const host = room.addHost(String(req?.name ?? "").trim().slice(0, 24));
        const result = bind(room, host);
        ack({ ok: true, ...result });
        room.broadcast();
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    socket.on("roomInfo", (req, ack) => {
      try {
        if (rateLimited(ip)) throw new GameError("RATE_LIMITED");
        const room = rooms.get(String(req?.code ?? ""));
        if (!room) {
          noteJoinFail(ip);
          throw new GameError("ROOM_NOT_FOUND");
        }
        ack({ ok: true, cardMode: room.settings.cardMode });
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    socket.on("joinRoom", (req, ack) => {
      try {
        if (rateLimited(ip)) throw new GameError("RATE_LIMITED");
        const room = rooms.get(String(req?.code ?? ""));
        if (!room) {
          noteJoinFail(ip);
          throw new GameError("ROOM_NOT_FOUND");
        }
        if (req.role !== "player" && req.role !== "table") throw new GameError("BAD_REQUEST");
        // A known token means "same seat again" - never a second seat.
        const existing = req.token ? room.findByToken(req.token) : undefined;
        // A box room with nobody hosting yet ("first joiner hosts"): the first phone in
        // takes the host seat instead of a player seat.
        const member =
          existing ??
          (req.role === "player" && room.hostOpen ? room.claimHostSeat(req.name) : room.addMember(req.role, req.name, req.tableKey));
        // Re-opening the host's Table link on a known seat still grants control.
        if (existing?.role === "table" && req.tableKey === room.tableKey) existing.canControl = true;
        const result = bind(room, member);
        log.info("room", existing ? "rejoined" : "joined", {
          code: room.code,
          role: member.role,
          name: member.name,
          control: member.role === "table" ? member.canControl : undefined,
        });
        ack({ ok: true, ...result });
        room.broadcast();
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    // Sent by the client on EVERY socket connect, not just the first.
    // socket.io reconnects with a brand-new server-side socket that has no
    // room binding; without this the phone would sit on stale state forever
    // (the CAHDigitalGame "reconnect desync" bug).
    socket.on("resume", (req, ack) => {
      try {
        if (rateLimited(ip)) throw new GameError("RATE_LIMITED");
        const room = rooms.get(String(req?.code ?? ""));
        if (!room) {
          noteJoinFail(ip);
          throw new GameError("ROOM_NOT_FOUND");
        }
        const member = room.findByToken(String(req?.token ?? ""));
        if (!member) {
          noteJoinFail(ip);
          throw new GameError("BAD_TOKEN");
        }
        const result = bind(room, member);
        log.info("room", "resumed", { code: room.code, role: member.role, name: member.name });
        ack({ ok: true, ...result });
        room.broadcast();
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    socket.on("leaveRoom", (ack) => {
      const { code, memberId } = socket.data;
      const room = code ? rooms.get(code) : undefined;
      socket.data.code = undefined;
      socket.data.memberId = undefined;
      if (room && memberId) {
        if (memberId === room.hostId) {
          rooms.closeRoom(room.code, HOST_CLOSE_REASON, "host");
        } else {
          room.detachSocket(memberId, socket.id);
          room.removeMember(memberId, "You left the room.");
          log.info("room", "left", { code: room.code, member: memberId });
          room.broadcast();
        }
      }
      ack({ ok: true });
    });

    socket.on("closeRoom", (ack) => {
      try {
        const { code, memberId } = socket.data;
        const room = code ? rooms.get(code) : undefined;
        if (!room || !memberId) throw new GameError("NOT_IN_ROOM");
        room.requireHost(memberId);
        rooms.closeRoom(room.code, HOST_CLOSE_REASON, "host");
        ack({ ok: true });
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    // ------------------------------------------------------- host only
    on<Partial<RoomSettings>>("updateSettings", (room, id, patch) => {
      room.requireHost(id);
      room.updateSettings(patch ?? {});
    });
    // Callers, not just the host: the pattern can be changed from the board
    // itself (tap the pattern card), e.g. a host with only an iPad on a TV.
    on<{ patternId: string; customMask?: Mask }>("setPattern", (room, id, req) => {
      room.requireCaller(id);
      room.setPattern(String(req?.patternId ?? ""), req?.customMask);
    });
    on("startGame", (room, id) => {
      room.requireCaller(id);
      room.startGame();
    });
    on("callNext", (room, id) => {
      room.requireCaller(id);
      return { ball: room.callNext() };
    });
    on<number>("callBall", (room, id, ball) => {
      room.requireCaller(id);
      return { ball: room.callBall(Number(ball)) };
    });
    on<number>("uncallBall", (room, id, ball) => {
      room.requireCaller(id);
      room.uncallBall(Number(ball));
    });
    on<boolean>("setPaused", (room, id, paused) => {
      room.requireCaller(id);
      room.setPaused(Boolean(paused));
    });
    on<{ claimId: string; confirm: boolean }>("resolveClaim", (room, id, req) => {
      room.requireCaller(id);
      room.resolveClaim(String(req?.claimId ?? ""), Boolean(req?.confirm));
    });
    on<{ startNext?: boolean } | undefined>("newGame", (room, id, req) => {
      room.requireCaller(id);
      room.newGame(Boolean(req?.startNext));
    });
    on<Partial<DisplaySettings> | undefined>("setDisplay", (room, id, req) => {
      room.requireCaller(id);
      room.setDisplay(req ?? {});
    });
    on<{ memberId: string; canControl: boolean }>("setTableControl", (room, id, req) => {
      room.requireHost(id);
      room.setTableControl(String(req?.memberId ?? ""), Boolean(req?.canControl));
    });
    on<string>("kickPlayer", (room, id, target) => {
      room.requireHost(id);
      if (target === room.hostId || !room.members.has(target)) throw new GameError("BAD_REQUEST");
      room.removeMember(target, "The host removed you from the room.");
    });

    // ---------------------------------------------------------- player
    on<{ cardId: string; index: number }>("daub", (room, id, req) => {
      room.daub(id, String(req?.cardId ?? ""), Number(req?.index));
    });
    on("claimBingo", (room, id) => room.claimBingo(id));

    socket.on("disconnect", () => unbind());
  });
}
