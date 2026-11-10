// Bar Games integration (BARGAMES.md): standalone stays exactly as before, and
// on a (fake) box the commands, status and events work.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { io } from "socket.io-client";
import { DEFAULT_GAME_NAME } from "@bingo/shared";
import { startServer, setupRoom } from "../harness.mjs";

const TOKEN = "test-token";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TVS = {
  enabled: true,
  pinRequired: true,
  displays: [
    { id: "roku:A1", name: "Bar left", busy: false, showingThisGame: false },
    { id: "roku:B2", name: "Bar right", busy: true, showingThisGame: true, roomCode: "WXYZ" },
  ],
};

/** A fake box core: serves the venue context and TVs, records every event and cast. */
async function fakeCore() {
  const events = [];
  const casts = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
      if (req.url === "/internal/events") {
        events.push(JSON.parse(body));
        return void res.writeHead(204).end();
      }
      if (req.url === "/internal/displays") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify(TVS));
      }
      if (req.url === "/internal/cast" || req.url === "/internal/cast/stop") {
        const b = JSON.parse(body);
        casts.push({ url: req.url, ...b });
        res.writeHead(200, { "content-type": "application/json" });
        if (b.pin !== "4321") return void res.end(JSON.stringify({ ok: false, message: "Wrong TV PIN" }));
        const results = Object.fromEntries(
          b.displayIds.map((id) => [id, id === "roku:B2" ? { ok: false, needsCode: true } : { ok: true }]),
        );
        return void res.end(JSON.stringify({ ok: true, results }));
      }
      if (req.url === "/internal/venue") {
        res.writeHead(200, { "content-type": "application/json" });
        const theme = { colors: { background: "#0b2a2a", surface: "#12403f", text: "#f2fffd", primary: "#ff4fa3", accent: "#ffd23f" } };
        return void res.end(
          JSON.stringify({
            protocol: 1,
            venue: { name: "Test Bar", theme },
            game: { id: "bingo", displayName: "Bingo at Test Bar", theme },
            standalone: false,
            generatedAt: new Date().toISOString(),
          }),
        );
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    events,
    casts,
    /** Events of one type for one room. */
    of: (type, code) => events.filter((e) => e.type === type && (!code || e.roomCode === code)),
    async waitFor(pred, label, ms = 5000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(25);
      }
      throw new Error(`no event: ${label}; got ${JSON.stringify(events.map((e) => e.type))}`);
    },
    close: () => new Promise((r) => srv.close(r)),
  };
}

/** Fails roomInfo `n` times with the given headers; returns the last ack. */
async function failJoins(url, headers, n) {
  const socket = io(url, { transports: ["websocket"], reconnection: false, forceNew: true, extraHeaders: headers });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  let last;
  for (let i = 0; i < n; i++) last = await new Promise((r) => socket.emit("roomInfo", { code: "ZZZZ" }, r));
  socket.close();
  return last;
}
const RATE_LIMITED = /too many|slow down|try again/i;

describe("standalone (no BG_* env)", () => {
  let server;
  before(async () => (server = await startServer({ GAME_NAME: "" })));
  after(async () => server.stop());

  test("/api/config keeps the game's own name; venue.json says standalone", async () => {
    assert.deepEqual(await (await fetch(`${server.url}/api/config`)).json(), { gameName: DEFAULT_GAME_NAME });
    const venue = await (await fetch(`${server.url}/__bargames/venue.json`)).json();
    assert.equal(venue.standalone, true);
    assert.equal(venue.game.displayName, DEFAULT_GAME_NAME);
  });

  test("box endpoints are closed and gateway headers are ignored", async () => {
    const status = await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(status.status, 401);
    const cmd = await fetch(`${server.url}/__bargames/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "start", roomCode: "ABCD" }),
    });
    assert.equal(cmd.status, 401);
  });

  test("venue TVs: hidden (enabled false) and refused off a box; host only", async () => {
    const { host, players } = await setupRoom(server, ["Ann"]);
    assert.deepEqual((await host.ok("listTvs")).tvs, { enabled: false, pinRequired: false, displays: [] });
    assert.equal((await host.ok("castToTvs", { ids: ["roku:A1"], pin: "1" })).result.ok, false);
    assert.equal((await host.ok("stopTvs", { ids: ["roku:A1"] })).result.ok, false);
    for (const ev of ["listTvs", "castToTvs", "stopTvs"]) {
      const res = ev === "listTvs" ? await players[0].emit(ev) : await players[0].emit(ev, { ids: ["roku:A1"] });
      assert.equal(res.ok, false, `${ev} from a player`);
      assert.match(res.error, /only the host/i);
    }
  });

  test("join rate limit still keys on cf-connecting-ip (clientIp), not a spoofed gateway header", async () => {
    const a = { "cf-connecting-ip": "203.0.113.1", "x-bargames-via": "1", "x-bargames-client-ip": "10.0.0.1" };
    assert.match((await failJoins(server.url, a, 21)).error, RATE_LIMITED, "21st failure from one IP is limited");
    // Same spoofed gateway IP, different real (Cloudflare) IP: not limited.
    const b = { "cf-connecting-ip": "203.0.113.2", "x-bargames-via": "1", "x-bargames-client-ip": "10.0.0.1" };
    assert.doesNotMatch((await failJoins(server.url, b, 1)).error, RATE_LIMITED);
  });
});

describe("on a box", () => {
  let server, core;
  before(async () => {
    core = await fakeCore();
    server = await startServer({ BG_GAME_ID: "bingo", BG_CORE_URL: core.url, BG_GAME_TOKEN: TOKEN });
  });
  after(async () => {
    await server.stop();
    await core.close();
  });

  const command = async (command, roomCode, token = TOKEN) => {
    const res = await fetch(`${server.url}/__bargames/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ command, roomCode }),
    });
    return { status: res.status, ...(await res.json()) };
  };

  test("name comes from the venue; the token is never served", async () => {
    assert.deepEqual(await (await fetch(`${server.url}/api/config`)).json(), { gameName: "Bingo at Test Bar" });
    const venue = await (await fetch(`${server.url}/__bargames/venue.json`)).text();
    assert.equal(JSON.parse(venue).standalone, false);
    assert.ok(!venue.includes(TOKEN));
    assert.ok(!server.output.includes(TOKEN), "token never logged");
  });

  test("commands need the token", async () => {
    assert.equal((await command("start", "ABCD", "wrong")).status, 401);
  });

  test("start: good room, unknown room, wrong state", async () => {
    const { code, host } = await setupRoom(server, []);
    assert.equal((await command("start", "QQQQ")).ok, false, "unknown room");
    const ok = await command("start", code);
    assert.equal(ok.ok, true, ok.message);
    await host.waitFor((s) => s.phase === "playing", "host sees the game start");
    const again = await command("start", code);
    assert.equal(again.ok, false, "already playing");
    assert.ok(again.message);
  });

  test("pause / resume: good room, unknown room, wrong state", async () => {
    const { code, host } = await setupRoom(server, []);
    assert.equal((await command("pause", code)).ok, false, "nothing to pause in the lobby");
    assert.equal((await command("resume", code)).ok, false, "nothing to resume in the lobby");
    await host.ok("startGame");
    assert.equal((await command("resume", code)).ok, false, "not paused");
    assert.equal((await command("pause", code)).ok, true);
    await host.waitFor((s) => s.paused === true, "paused");
    assert.equal((await command("pause", code)).ok, false, "already paused");
    assert.equal((await command("resume", code)).ok, true);
    await host.waitFor((s) => s.paused === false, "resumed");
    assert.equal((await command("pause", "QQQQ")).ok, false);
    assert.equal((await command("resume", "QQQQ")).ok, false);
  });

  test("next_round: good room, unknown room, wrong state", async () => {
    const { code, host } = await setupRoom(server, []);
    assert.equal((await command("next_round", code)).ok, false, "lobby: use start");
    await host.ok("startGame");
    await host.ok("callNext");
    assert.equal((await command("next_round", code)).ok, true);
    await host.waitFor((s) => s.phase === "playing" && s.gameNumber === 2 && s.called.length === 0, "game 2 started");
    assert.equal((await command("next_round", "QQQQ")).ok, false);
  });

  test("end closes the room like the host's Close room; status lists rooms", async () => {
    const { code, host, players } = await setupRoom(server, ["Ann", "Bo"]);
    await players[0].waitFor((s) => s.players.length === 2);
    const table = await server.client();
    await table.ok("joinRoom", { code, role: "table" });

    const status = await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const mine = status.rooms.find((r) => r.code === code);
    assert.deepEqual(
      { ...mine, title: undefined },
      { code, kind: "patron", players: 2, phase: "lobby", title: undefined, hostConnected: true },
    );
    assert.match(mine.title, /Game 1/);

    assert.equal((await command("end", code)).ok, true);
    await sleep(100);
    assert.equal(host.closedReason, "The host ended this room.");
    assert.equal(players[0].closedReason, "The host ended this room.");
    assert.equal((await command("end", code)).ok, false, "already gone");
    await core.waitFor((e) => e.type === "room_closed" && e.roomCode === code && e.data.reason === "host", "room_closed");
  });

  test("events: created, players (debounced), round, claim, winner, round end", async () => {
    const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
    const created = await core.waitFor((e) => e.type === "room_created" && e.roomCode === code, "room_created");
    assert.equal(created.sessionKind, "patron");
    assert.equal(created.gameId, "bingo");

    // Three more joins and a leave inside 2 s: one event with the final count.
    const extra = [];
    for (const name of ["Bo", "Cy", "Di"]) {
      const p = await server.client();
      await p.ok("joinRoom", { code, role: "player", name });
      extra.push(p);
    }
    await extra[2].ok("leaveRoom");
    await sleep(2600);
    const pc = core.of("players_changed", code);
    assert.equal(pc.length, 1, JSON.stringify(pc));
    assert.deepEqual(pc[0].data, { players: 3 });
    // A reconnect (resume) is not a player change.
    const again = await server.client();
    await again.ok("resume", { code, token: ann.token });
    await sleep(2300);
    assert.equal(core.of("players_changed", code).length, 1);

    // A pattern only the top-left B square matters for: call every B ball and
    // Ann's card wins.
    await host.ok("setPattern", { patternId: "custom", customMask: [0] });
    await host.ok("startGame");
    const started = await core.waitFor((e) => e.type === "round_started" && e.roomCode === code, "round_started");
    assert.deepEqual(started.data, { round: 1, pattern: "Custom Pattern", cardMode: "digital" });
    for (let i = 0; i < 15; i++) await host.ok("callNext");
    await ann.waitFor((s) => s.called.length === 15);
    assert.equal((await ann.ok("claimBingo")).valid, true);
    const claim = await core.waitFor((e) => e.type === "claim_pending" && e.roomCode === code, "claim_pending");
    assert.deepEqual(claim.data, { name: "Ann" });

    const pending = (await host.waitFor((s) => s.claims.some((c) => c.status === "pending"))).claims.find((c) => c.status === "pending");
    await host.ok("resolveClaim", { claimId: pending.id, confirm: true });
    const win = await core.waitFor((e) => e.type === "winner" && e.roomCode === code, "winner");
    assert.deepEqual(win.data, { name: "Ann", round: 1, calls: 15, pattern: "Custom Pattern" });

    await host.ok("newGame", { startNext: false });
    const ended = await core.waitFor((e) => e.type === "round_ended" && e.roomCode === code, "round_ended");
    assert.deepEqual(ended.data, { round: 1, calls: 15, winners: ["Ann"] });

    // Privacy: no IPs, socket ids or tokens in any event.
    const all = JSON.stringify(core.events);
    assert.ok(!all.includes(ann.token) && !all.includes(ann.socket.id) && !all.includes("127.0.0.1"));
  });

  test("create_room: a venue room with no host phone, driven by commands", async () => {
    const res = await fetch(`${server.url}/__bargames/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "create_room", args: { kind: "venue", purpose: "display", title: "Friday Bingo" } }),
    });
    const created = await res.json();
    assert.equal(created.ok, true, created.message);
    const { roomCode: code, hostUrl } = created.data;
    assert.match(code, /^[A-Z]{4}$/);
    const ev = await core.waitFor((e) => e.type === "room_created" && e.roomCode === code, "room_created");
    assert.equal(ev.sessionKind, "venue");

    const status = await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const mine = status.rooms.find((r) => r.code === code);
    assert.equal(mine.kind, "venue");
    assert.equal(mine.players, 0);
    assert.equal(mine.hostConnected, false);
    assert.match(mine.title, /^Friday Bingo · Game 1/);

    // A TV opens the table route; players join by code as usual.
    const tv = await server.client();
    assert.equal((await tv.ok("joinRoom", { code, role: "table" })).role, "table");
    const ann = await server.client();
    await ann.ok("joinRoom", { code, role: "player", name: "Ann" });

    // Commands run it.
    assert.equal((await command("start", code)).ok, true);
    await tv.waitFor((s) => s.phase === "playing", "playing");
    assert.equal((await command("pause", code)).ok, true);
    assert.equal((await command("resume", code)).ok, true);
    assert.equal((await command("next_round", code)).ok, true);
    await tv.waitFor((s) => s.gameNumber === 2, "game 2");

    // hostUrl's token takes the empty host seat (the staff iPad).
    const url = new URL(hostUrl, server.url);
    assert.equal(url.pathname, `/join/${code}`);
    const ipad = await server.client();
    const seat = await ipad.ok("resume", { code, token: url.searchParams.get("host") });
    assert.equal(seat.role, "host");
    await ipad.ok("callNext");

    assert.equal((await command("end", code)).ok, true);
    await sleep(100);
    assert.equal(tv.closedReason, "The host ended this room.");
    await core.waitFor((e) => e.type === "room_closed" && e.roomCode === code, "room_closed");
  });

  test("venue TVs: host lists and casts with the PIN; players can't; the PIN is never logged", async () => {
    const { code, host, players } = await setupRoom(server, ["Ann"]);
    assert.deepEqual((await host.ok("listTvs")).tvs, TVS);
    assert.match((await players[0].emit("listTvs")).error, /only the host/i);
    assert.match((await players[0].emit("castToTvs", { ids: ["roku:A1"], pin: "4321" })).error, /only the host/i);

    const wrong = (await host.ok("castToTvs", { ids: ["roku:A1"], pin: "0000" })).result;
    assert.deepEqual(wrong, { ok: false, message: "Wrong TV PIN" });
    const good = (await host.ok("castToTvs", { ids: ["roku:A1", "roku:B2"], pin: "4321" })).result;
    assert.equal(good.ok, true);
    assert.equal(good.results["roku:B2"].needsCode, true);
    assert.deepEqual(core.casts.at(-1), { url: "/internal/cast", roomCode: code, displayIds: ["roku:A1", "roku:B2"], pin: "4321" });

    const stop = (await host.ok("stopTvs", { ids: ["roku:A1"], pin: "4321" })).result;
    assert.equal(stop.ok, true);
    assert.deepEqual(core.casts.at(-1), { url: "/internal/cast/stop", displayIds: ["roku:A1"], pin: "4321" });

    // Junk input never reaches the box.
    const n = core.casts.length;
    assert.equal((await host.ok("castToTvs", { ids: "roku:A1" })).result.ok, false);
    assert.equal((await host.ok("castToTvs", {})).result.ok, false);
    assert.equal(core.casts.length, n);
    assert.ok(!server.output.includes("4321"), "PIN never logged");
  });

  test("rate limit keys on the gateway's client IP, so one guest can't lock out the bar", async () => {
    const gw = (ip) => ({ "x-bargames-via": "1", "x-bargames-client-ip": ip });
    assert.match((await failJoins(server.url, gw("192.168.1.50"), 21)).error, RATE_LIMITED);
    // Same socket address (the box gateway), different guest: still allowed.
    assert.doesNotMatch((await failJoins(server.url, gw("192.168.1.51"), 1)).error, RATE_LIMITED);
  });
});

describe("venue room idle close", () => {
  let server, core;
  before(async () => {
    core = await fakeCore();
    server = await startServer({
      BG_GAME_ID: "bingo",
      BG_CORE_URL: core.url,
      BG_GAME_TOKEN: TOKEN,
      ROOM_IDLE_MINUTES: "0.01", // 0.6 s
      ROOM_SWEEP_INTERVAL_MS: "200",
    });
  });
  after(async () => {
    await server.stop();
    await core.close();
  });

  const createRoom = async () => {
    const res = await fetch(`${server.url}/__bargames/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "create_room", args: { kind: "venue" } }),
    });
    return (await res.json()).data.roomCode;
  };
  const listed = async (code) => {
    const status = await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    return status.rooms.some((r) => r.code === code);
  };

  test("stays open while a TV shows it, idle-closes once no TV is connected", async () => {
    const code = await createRoom();
    const tv = await server.client();
    await tv.ok("joinRoom", { code, role: "table" });
    await sleep(1500);
    assert.equal(await listed(code), true, "still open with a TV connected");
    tv.socket.close();
    await sleep(1500);
    assert.equal(await listed(code), false, "idle-closed after the TV left");
    const closed = await core.waitFor((e) => e.type === "room_closed" && e.roomCode === code, "room_closed");
    assert.equal(closed.data.reason, "idle");
  });

  test("a patron room with a TV still idle-closes as before", async () => {
    const { code, host } = await setupRoom(server, []);
    const tv = await server.client();
    await tv.ok("joinRoom", { code, role: "table" });
    await sleep(1500);
    assert.equal(await listed(code), false);
    assert.ok(host.closedReason);
  });
});
