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

/** A fake box core: serves the venue context and records every event. */
async function fakeCore() {
  const events = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
      if (req.url === "/internal/events") {
        events.push(JSON.parse(body));
        return void res.writeHead(204).end();
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

  test("rate limit keys on the gateway's client IP, so one guest can't lock out the bar", async () => {
    const gw = (ip) => ({ "x-bargames-via": "1", "x-bargames-client-ip": ip });
    assert.match((await failJoins(server.url, gw("192.168.1.50"), 21)).error, RATE_LIMITED);
    // Same socket address (the box gateway), different guest: still allowed.
    assert.doesNotMatch((await failJoins(server.url, gw("192.168.1.51"), 1)).error, RATE_LIMITED);
  });
});
