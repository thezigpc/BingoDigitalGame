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
  const passwordChecks = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
      if (req.url === "/internal/events") {
        events.push(JSON.parse(body));
        return void res.writeHead(204).end();
      }
      if (req.url === "/internal/venue-password") {
        const b = JSON.parse(body);
        passwordChecks.push(b);
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ ok: b.password === "box-password" }));
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
    passwordChecks,
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
const adminLogin = (url, password) =>
  fetch(`${url}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
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

  test("staff sign-in: spoofed gateway staff headers are ignored off a box", async () => {
    const staff = { "x-bargames-via": "1", "x-bargames-staff": "1" };
    const st = await (await fetch(`${server.url}/api/admin/status`, { headers: staff })).json();
    assert.equal(st.trusted, false);
    const t = await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers: staff });
    assert.equal(t.status, 403);
  });

  test("the venue password: never accepted off a box", async () => {
    assert.equal((await adminLogin(server.url, "box-password")).ok, false);
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
      { ...mine, title: undefined, createdAt: undefined, lastActivityAt: undefined },
      {
        code,
        kind: "patron",
        players: 2,
        phase: "lobby",
        round: 1,
        title: undefined,
        hostConnected: true,
        hostName: "Host",
        tables: 1,
        maxPlayers: 100,
        createdAt: undefined,
        lastActivityAt: undefined,
        joinPath: `/join/${code}`,
      },
    );
    assert.match(mine.title, /Game 1/);
    assert.ok(Date.parse(mine.createdAt) <= Date.parse(mine.lastActivityAt), "ISO times");

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

  test("staff sign-in: the box's signed-in staff get an admin session without the password", async () => {
    const staff = { "x-bargames-via": "1", "x-bargames-staff": "1" };
    // Not staff (a guest through the gateway, or anyone straight to the game): refused.
    for (const headers of [{ "x-bargames-via": "1" }, { "x-bargames-staff": "1" }, {}]) {
      assert.equal((await (await fetch(`${server.url}/api/admin/status`, { headers })).json()).trusted, false);
      assert.equal((await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers })).status, 403);
    }
    assert.equal((await (await fetch(`${server.url}/api/admin/status`, { headers: staff })).json()).trusted, true);
    const res = await (await fetch(`${server.url}/api/admin/trusted`, { method: "POST", headers: staff })).json();
    assert.equal(res.ok, true);
    const overview = await fetch(`${server.url}/api/admin/overview`, { headers: { authorization: `Bearer ${res.token}` } });
    assert.equal(overview.status, 200, "the staff session works like a password session");
  });

  test("the venue's admin password opens Bingo's admin, before and after Bingo has its own", async () => {
    const asks = () => core.passwordChecks.length;
    // No Bingo password yet: the box's password signs in; anything else doesn't.
    assert.equal((await (await fetch(`${server.url}/api/admin/status`)).json()).setupNeeded, true);
    assert.equal((await adminLogin(server.url, "nope")).ok, false);
    const boxRes = await adminLogin(server.url, "box-password");
    assert.equal(boxRes.status, 200);
    const { token } = await boxRes.json();
    assert.equal((await fetch(`${server.url}/api/admin/overview`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal(core.passwordChecks.at(-1).password, "box-password");
    assert.ok(core.passwordChecks.at(-1).clientIp, "the box gets the client IP for its own limits");

    // Bingo's own password: it doesn't ask the box. The box's still works too.
    const setup = await fetch(`${server.url}/api/admin/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "bingo-own-password" }),
    });
    assert.equal(setup.status, 200);
    const before = asks();
    assert.equal((await adminLogin(server.url, "bingo-own-password")).status, 200);
    assert.equal(asks(), before, "the box isn't asked when Bingo's password matches");
    assert.equal((await adminLogin(server.url, "box-password")).status, 200);
    assert.equal((await adminLogin(server.url, "wrong-password")).ok, false);
  });

  test("create_room with firstJoinerHosts: the first phone to join becomes the host", async () => {
    const make = async (args) => {
      const res = await fetch(`${server.url}/__bargames/command`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ command: "create_room", args }),
      });
      const created = await res.json();
      assert.equal(created.ok, true, created.message);
      return created.data.roomCode;
    };
    const code = await make({ kind: "venue", purpose: "display", firstJoinerHosts: true });
    // The TV that shows it is a table, not the host.
    const tv = await server.client();
    assert.equal((await tv.ok("joinRoom", { code, role: "table" })).role, "table");

    const cat = await server.client();
    const first = await cat.ok("joinRoom", { code, role: "player", name: "Cat" });
    assert.equal(first.role, "host");
    assert.equal(first.name, "Cat");
    const view = await cat.waitFor((s) => s.you.role === "host", "host view");
    assert.equal(view.you.role, "host");
    // Same powers as a phone host: settings, start, call, close.
    await cat.ok("startGame");
    await cat.ok("callNext");
    const status = await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const mine = status.rooms.find((r) => r.code === code);
    assert.equal(mine.hostConnected, true);
    assert.equal(mine.hostName, "Cat");
    assert.equal(mine.players, 0, "the host isn't a player");

    // Everyone after that is a player; a reload keeps the host seat.
    const dan = await server.client();
    assert.equal((await dan.ok("joinRoom", { code, role: "player", name: "Dan" })).role, "player");
    const again = await server.client();
    assert.equal((await again.ok("resume", { code, token: first.token })).role, "host");
    await cat.ok("closeRoom");

    // Without the flag: today's venue room (nobody joins as host).
    const plain = await make({ kind: "venue" });
    const eve = await server.client();
    assert.equal((await eve.ok("joinRoom", { code: plain, role: "player", name: "Eve" })).role, "player");
    assert.equal((await command("end", plain)).ok, true);
  });

  test("joinPath: venue and patron rooms get Bingo's join route; a private room never does", async () => {
    const make = async (kind) => {
      const res = await fetch(`${server.url}/__bargames/command`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ command: "create_room", args: { kind } }),
      });
      return (await res.json()).data.roomCode;
    };
    const venue = await make("venue");
    const priv = await make("private");
    const { code: patron } = await setupRoom(server, []);
    const status = await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const row = (code) => status.rooms.find((r) => r.code === code);
    assert.equal(row(venue).joinPath, `/join/${venue}`);
    assert.equal(row(patron).joinPath, `/join/${patron}`);
    assert.equal(row(priv).kind, "private");
    assert.equal("joinPath" in row(priv), false, "never for a private room");
    for (const code of [venue, priv]) await command("end", code);
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

  test("confirm_claim / reject_claim and pendingClaims in status", async () => {
    const { code, host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"]);
    const cmd = async (name, roomCode, args) => {
      const res = await fetch(`${server.url}/__bargames/command`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ command: name, roomCode, args }),
      });
      return res.json();
    };
    const statusOf = async () =>
      (await (await fetch(`${server.url}/__bargames/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).rooms.find(
        (r) => r.code === code,
      );

    // Nothing waiting yet: no pendingClaims, and both commands refuse.
    assert.equal((await statusOf()).pendingClaims, undefined);
    assert.equal((await cmd("confirm_claim", code)).ok, false);
    assert.equal((await cmd("reject_claim", code)).ok, false);

    // Every card wins once all B balls are out; Ann claims first, then Bo.
    await host.ok("setPattern", { patternId: "custom", customMask: [0] });
    await host.ok("startGame");
    for (let i = 0; i < 15; i++) await host.ok("callNext");
    await bo.waitFor((s) => s.called.length === 15);
    assert.equal((await ann.ok("claimBingo")).valid, true);
    await sleep(5);
    assert.equal((await bo.ok("claimBingo")).valid, true);

    const pending = (await statusOf()).pendingClaims;
    assert.equal(pending.length, 2);
    assert.deepEqual(pending.map((c) => c.player), ["Ann", "Bo"], "oldest first");
    assert.match(pending[0].detail, /^Custom Pattern on card [A-Z0-9]{6}, after 15 calls$/);
    assert.ok(!Number.isNaN(Date.parse(pending[0].at)));
    assert.ok(pending[0].at <= pending[1].at);
    const hostIds = (await host.waitFor((s) => s.claims.filter((c) => c.status === "pending").length === 2)).claims.map((c) => c.id);
    assert.ok(hostIds.includes(pending[0].id) && hostIds.includes(pending[1].id), "ids are the game's claim ids");

    // Refusals: unknown room, unknown claim.
    assert.equal((await cmd("confirm_claim", "QQQQ")).ok, false);
    assert.equal((await cmd("reject_claim", "QQQQ", { claimId: pending[0].id })).ok, false);
    const unknown = await cmd("confirm_claim", code, { claimId: "nope" });
    assert.equal(unknown.ok, false);
    assert.ok(unknown.message);

    // claimId omitted: the oldest (Ann's) is confirmed, through the host's path.
    assert.equal((await cmd("confirm_claim", code)).ok, true);
    await host.waitFor((s) => s.claims.find((c) => c.id === pending[0].id)?.status === "confirmed", "Ann confirmed");
    const win = await core.waitFor((e) => e.type === "winner" && e.roomCode === code, "winner");
    assert.equal(win.data.name, "Ann");
    const again = await cmd("reject_claim", code, { claimId: pending[0].id });
    assert.equal(again.ok, false, "already decided");
    assert.match(again.message, /^That BINGO claim isn't waiting any more: it was already confirmed or turned down/, "Bingo's own words");
    assert.deepEqual((await statusOf()).pendingClaims.map((c) => c.player), ["Bo"]);

    // reject_claim by id, with a reason the player sees.
    assert.equal((await cmd("reject_claim", code, { claimId: pending[1].id, reason: "Card was checked: not this pattern" })).ok, true);
    const boView = await bo.waitFor((s) => s.claims.find((c) => c.id === pending[1].id)?.status === "dismissed", "Bo rejected");
    assert.equal(boView.claims.find((c) => c.id === pending[1].id).reason, "Card was checked: not this pattern");
    assert.match((await cmd("confirm_claim", code, { claimId: pending[1].id })).message, /isn't waiting/);
    assert.equal((await statusOf()).pendingClaims, undefined, "nothing waiting");
    const none = await cmd("confirm_claim", code);
    assert.equal(none.ok, false, "omitted claimId, nothing waiting");
    assert.equal(none.message, "No BINGO claim is waiting in this room.");
  });

  test("the host's own Dismiss sends no reason (unchanged)", async () => {
    const { host, players: [ann] } = await setupRoom(server, ["Ann"]);
    await host.ok("setPattern", { patternId: "custom", customMask: [0] });
    await host.ok("startGame");
    for (let i = 0; i < 15; i++) await host.ok("callNext");
    await ann.waitFor((s) => s.called.length === 15);
    await ann.ok("claimBingo");
    const claim = (await host.waitFor((s) => s.claims.some((c) => c.status === "pending"))).claims[0];
    await host.ok("resolveClaim", { claimId: claim.id, confirm: false });
    const v = await ann.waitFor((s) => s.claims[0]?.status === "dismissed");
    assert.equal("reason" in v.claims[0], false);
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
