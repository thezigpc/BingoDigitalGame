// Hosting from the box and co-hosts (Bingo 0.9.0, SDK 0.14.0, the game kit's HostSeats):
// staff take-over (host_link), single-use co-host invites (cohost_link and the host's own
// "Add a co-host"), remove_cohost, and what a co-host may and may not do.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { HostSeats } from "@bargames/gamekit/server";
import { startServer } from "../harness.mjs";

const TOKEN = "test-token";

/** A minimal box core: accepts events, answers the venue context. */
async function fakeCore() {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
      if (req.url === "/internal/venue") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(
          JSON.stringify({
            protocol: 1,
            venue: { name: "Test Bar" },
            game: { id: "bingo", displayName: "Bingo" },
            standalone: false,
            generatedAt: new Date().toISOString(),
          }),
        );
      }
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}

/** The query value of a link path ("/join/ABCD?host=..."). */
const param = (path, name) => new URL(path, "http://x").searchParams.get(name);

/** Collects "notice" messages on a test client. */
const notices = (c) => {
  const got = [];
  c.socket.on("notice", (n) => got.push(n.message));
  return got;
};

describe("hosting from the box", () => {
  let server, core;
  before(async () => {
    core = await fakeCore();
    server = await startServer({ BG_GAME_ID: "bingo", BG_CORE_URL: core.url, BG_GAME_TOKEN: TOKEN });
  });
  after(async () => {
    await server.stop();
    await core.close();
  });

  const command = async (command, roomCode, args) => {
    const res = await fetch(`${server.url}/__bargames/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ command, roomCode, args }),
    });
    return res.json();
  };
  const createRoom = async (args) => {
    const r = await command("create_room", undefined, args);
    assert.equal(r.ok, true, r.message);
    return r.data;
  };

  test("take-over: a new host link, the old one stops working, the old host is a co-host", async () => {
    const { roomCode: code, hostUrl } = await createRoom({ kind: "venue", firstJoinerHosts: true });
    const firstKey = param(hostUrl, "host");

    // The first phone from the TV's QR code hosts.
    const cat = await server.client();
    const catNotices = notices(cat);
    const joined = await cat.ok("joinRoom", { code, role: "player", name: "Cat" });
    assert.equal(joined.role, "host");
    await cat.ok("startGame");

    // Staff take over from the box's Rooms page.
    const link = await command("host_link", code);
    assert.equal(link.ok, true, link.message);
    const newKey = param(link.data.url, "host");
    assert.ok(newKey && newKey !== firstKey, "a new host link each time");

    // Cat's phone is told, and stays on as a co-host (its own token still works).
    const catView = await cat.waitFor((s) => s.you.role === "cohost", "Cat is a co-host");
    assert.equal(catView.you.canControl, true);
    assert.match(catNotices.join(" "), /took over hosting/i);
    const again = await server.client();
    assert.equal((await again.ok("resume", { code, token: joined.token })).role, "cohost");

    // The old host link stops working; the new one opens the host seat (and hands back the
    // seat's own token, which a later take-over leaves working).
    const stale = await server.client();
    const refused = await stale.emit("resume", { code, token: firstKey });
    assert.equal(refused.ok, false);
    const staff = await server.client();
    const seat = await staff.ok("resume", { code, token: newKey });
    assert.equal(seat.role, "host");
    assert.notEqual(seat.token, newKey);
    await staff.ok("callNext");

    // Still only one host: the next QR joiner is a player.
    const dan = await server.client();
    assert.equal((await dan.ok("joinRoom", { code, role: "player", name: "Dan" })).role, "player");

    // A second take-over: the staff seat becomes a co-host too.
    const second = await command("host_link", code);
    assert.equal(second.ok, true);
    await staff.waitFor((s) => s.you.role === "cohost", "staff seat is a co-host");
    const status = await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.equal(status.rooms.find((r) => r.code === code).players, 1, "co-hosts aren't counted as players");
    assert.equal((await command("end", code)).ok, true);
  });

  test("take-over of a phone host's room (no first-joiner offer)", async () => {
    const host = await server.client();
    const created = await host.ok("createRoom", { name: "Pat" });
    const link = await command("host_link", created.code);
    assert.equal(link.ok, true, link.message);
    assert.match(link.message, /co-host/);
    await host.waitFor((s) => s.you.role === "cohost", "Pat is a co-host");
    // A co-host can't close the room.
    assert.equal((await host.emit("closeRoom")).ok, false);
    assert.equal((await command("end", created.code)).ok, true);
  });

  test("co-host invites work once (box cohost_link and the host's own button)", async () => {
    const host = await server.client();
    const created = await host.ok("createRoom", { name: "Host" });
    const code = created.code;

    const box = await command("cohost_link", code, { minutes: 5 });
    assert.equal(box.ok, true, box.message);
    const expires = Date.parse(box.data.expiresAt) - Date.now();
    assert.ok(expires > 4 * 60_000 && expires <= 5 * 60_000 + 1000, `expires in about 5 minutes (${expires} ms)`);
    const invite = param(box.data.url, "cohost");

    const eve = await server.client();
    const e = await eve.ok("joinRoom", { code, role: "player", name: "Eve", cohost: invite });
    assert.equal(e.role, "cohost");
    // Used: the same link again is refused.
    const fay = await server.client();
    const refused = await fay.emit("joinRoom", { code, role: "player", name: "Fay", cohost: invite });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /expired or was already used/);
    // A made-up invite too.
    assert.equal((await fay.emit("joinRoom", { code, role: "player", name: "Fay", cohost: "nope" })).ok, false);

    // The host's own "Add a co-host": a player already in the room is promoted.
    const gus = await server.client();
    const g = await gus.ok("joinRoom", { code, role: "player", name: "Gus" });
    const mine = await host.ok("cohostInvite");
    assert.match(mine.path, new RegExp(`^/join/${code}\\?cohost=`));
    const promoted = await gus.ok("joinRoom", { code, role: "player", token: g.token, cohost: param(mine.path, "cohost") });
    assert.equal(promoted.role, "cohost");
    assert.equal(promoted.memberId, g.memberId, "same seat, now a co-host");
    const hv = await host.waitFor((s) => s.cohosts.length === 2, "two co-hosts listed");
    assert.deepEqual(hv.cohosts.map((c) => c.name).sort(), ["Eve", "Gus"]);
    assert.equal(hv.players.length, 0);
    // Only the host hands out invites.
    assert.equal((await eve.emit("cohostInvite")).ok, false);
    await host.ok("closeRoom");
  });

  test("a co-host runs the game but can't end the room or remove anyone", async () => {
    const host = await server.client();
    const { code } = await host.ok("createRoom", { name: "Host" });
    const ann = await server.client();
    const a = await ann.ok("joinRoom", { code, role: "player", name: "Ann" });
    const { path } = await host.ok("cohostInvite");
    const co = await server.client();
    await co.ok("joinRoom", { code, role: "player", name: "Cole", cohost: param(path, "cohost") });

    await co.ok("startGame");
    const { ball } = await co.ok("callNext");
    assert.ok(ball >= 1 && ball <= 75);
    await co.ok("setPaused", true);
    await co.ok("setPaused", false);
    await co.ok("updateSettings", { autoCallSeconds: 10 });
    await co.ok("newGame", { startNext: true });

    assert.equal((await co.emit("closeRoom")).ok, false, "can't close the room");
    assert.equal((await co.emit("kickPlayer", a.memberId)).ok, false, "can't remove a player");
    const cv = await co.waitFor((s) => s.cohosts.length === 1, "co-host list");
    assert.equal((await co.emit("removeCohost", cv.cohosts[0].id)).ok, false, "can't remove a co-host");
    // Leaving takes the co-host out; the room stays open.
    await co.ok("leaveRoom");
    await host.waitFor((s) => s.cohosts.length === 0, "co-host gone");
    await host.ok("callNext");
    await host.ok("closeRoom");
  });

  test("remove_cohost (box) and the host's Remove: back to a player with cards", async () => {
    const host = await server.client();
    const { code } = await host.ok("createRoom", { name: "Host" });
    const invite = async () => param((await host.ok("cohostInvite")).path, "cohost");
    const hal = await server.client();
    const halNotices = notices(hal);
    const h = await hal.ok("joinRoom", { code, role: "player", name: "Hal", cohost: await invite() });
    const ivy = await server.client();
    const i = await ivy.ok("joinRoom", { code, role: "player", name: "Ivy", cohost: await invite() });

    const removed = await command("remove_cohost", code, { memberId: h.memberId });
    assert.equal(removed.ok, true, removed.message);
    const hv = await hal.waitFor((s) => s.you.role === "player", "Hal is a player");
    assert.equal(hv.myCards.length, 1, "dealt a card");
    assert.match(halNotices.join(" "), /not a co-host/i);
    assert.equal((await hal.emit("callNext")).ok, false);
    // Not a co-host (any more): refused.
    assert.equal((await command("remove_cohost", code, { memberId: h.memberId })).ok, false);

    await host.ok("removeCohost", i.memberId);
    await ivy.waitFor((s) => s.you.role === "player", "Ivy is a player");
    await host.ok("closeRoom");
  });
});

describe("co-host invites expire (HostSeats in a Room)", () => {
  test("an invite past its expiry is refused, a fresh one works", async () => {
    const { Room } = await import("../../server/dist/rooms/Room.js");
    const transport = { sendState() {}, sendClosed() {}, sendNotice() {} };
    let now = Date.now();
    const room = new Room("TEST", transport, "venue");
    room.addHost("Venue");
    room.seats = new HostSeats({ now: () => now });
    const old = room.seats.invite(60_000);
    now += 61_000;
    assert.equal(room.seats.redeem(old.token), false, "expired");
    const fresh = room.seats.invite(60_000);
    assert.equal(room.seats.redeem(fresh.token), true);
    const m = room.seatCohost(undefined, "Jo");
    assert.equal(m.role, "cohost");
    assert.equal(room.seats.roleOf(m.id), "cohost");
    assert.equal(room.seats.redeem(fresh.token), false, "single use");
  });
});
