import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(`${server.url}/api/admin${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

let token;

test("first-run setup sets the password once; login and logout work", async () => {
  assert.deepEqual((await api("/status")).body, { setupNeeded: true, authenticated: false });
  assert.equal((await api("/overview")).status, 401, "locked before login");
  assert.equal((await api("/setup", { method: "POST", body: { password: "short" } })).status, 400);

  const setup = await api("/setup", { method: "POST", body: { password: "correct horse" } });
  assert.equal(setup.status, 200);
  token = setup.body.token;
  assert.equal((await api("/setup", { method: "POST", body: { password: "hijack attempt" } })).status, 400, "only once");
  assert.equal((await api("/status", { token })).body.authenticated, true);

  assert.equal((await api("/login", { method: "POST", body: { password: "nope nope" } })).status, 401);
  const login = await api("/login", { method: "POST", body: { password: "correct horse" } });
  assert.equal(login.status, 200);
  await api("/logout", { method: "POST", token: login.body.token });
  assert.equal((await api("/overview", { token: login.body.token })).status, 401, "logged-out token is dead");
});

test("admin sees rooms and can close one; players are told why", async () => {
  const { code, players: [ann] } = await setupRoom(server, ["Ann"]);
  await ann.waitFor((s) => s.myCards.length === 1);
  const { body } = await api("/overview", { token });
  const row = body.rooms.find((r) => r.code === code);
  assert.ok(row, "room listed");
  assert.equal(row.players, 1);
  assert.equal(row.hostConnected, true);

  assert.equal((await api(`/rooms/${code}/close`, { method: "POST", token })).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.match(ann.closedReason ?? "", /administrator/);
  assert.equal((await api(`/rooms/${code}/close`, { method: "POST", token })).status, 404);
});

test("idle time is admin-set, persisted, and enforced by the sweep", async () => {
  assert.equal((await api("/settings", { method: "PUT", token, body: { roomIdleMinutes: 1 } })).status, 400, "min 5");
  const saved = await api("/settings", { method: "PUT", token, body: { roomIdleMinutes: 30 } });
  assert.equal(saved.body.settings.roomIdleMinutes, 30);
  assert.equal((await api("/overview", { token })).body.settings.roomIdleMinutes, 30);

  // Bulk "close rooms idle for more than N minutes": 0 closes everything.
  const { code } = await setupRoom(server, []);
  const res = await api("/rooms/close-idle", { method: "POST", token, body: { minutes: 0 } });
  assert.ok(res.body.closed.includes(code));
});

test("a host's game controls: End game, New game (starts the next), Close room", async () => {
  const { host, players: [bo] } = await setupRoom(server, ["Bo"]);
  await host.ok("startGame");
  await host.ok("callNext");
  await host.ok("newGame", { startNext: true });
  const s = await bo.waitFor((s) => s.gameNumber === 2);
  assert.equal(s.phase, "playing", "New game goes straight into the next game");
  assert.equal(s.called.length, 0);
  await host.ok("newGame", {});
  await bo.waitFor((s) => s.gameNumber === 3 && s.phase === "lobby", "End game stops in the lobby");
  await host.ok("closeRoom");
  await new Promise((r) => setTimeout(r, 200));
  assert.match(bo.closedReason ?? "", /host ended/);
});

test("default look: admin sets it (or copies a room's); a host device's own default wins", async () => {
  // Copy a live room's look, as the admin page's "Use as default look" does.
  const { host } = await setupRoom(server, []);
  await host.ok("setDisplay", { theme: "neon", layout: "classic", align: "top", showRecent: false });
  const overview = await api("/overview", { token });
  const room = overview.body.rooms.find((r) => r.display.theme === "neon");
  assert.ok(room, "rooms list includes each room's look");
  const put = await api("/settings", { method: "PUT", token, body: { displayDefaults: room.display } });
  assert.equal(put.status, 200);

  const fresh = await server.client();
  await fresh.ok("createRoom", {});
  const s = await fresh.waitFor((v) => v.settings);
  assert.equal(s.settings.theme, "neon");
  assert.equal(s.settings.layout, "classic");
  assert.equal(s.settings.align, "top");
  assert.equal(s.settings.showRecent, false);

  // The host's device default goes on top; a junk one is ignored, not fatal.
  const mine = await server.client();
  await mine.ok("createRoom", { display: { theme: "daylight", boardFit: "fill" } });
  const m = await mine.waitFor((v) => v.settings);
  assert.equal(m.settings.theme, "daylight");
  assert.equal(m.settings.boardFit, "fill");
  assert.equal(m.settings.layout, "classic", "the rest still comes from the admin default");
  const junk = await server.client();
  await junk.ok("createRoom", { display: { theme: "plaid" } });
  assert.equal((await junk.waitFor((v) => v.settings)).settings.theme, "neon");

  assert.equal((await api("/settings", { method: "PUT", token, body: { displayDefaults: { theme: "plaid" } } })).status, 400);
  await api("/settings", { method: "PUT", token, body: { displayDefaults: {} } });
  const plain = await server.client();
  await plain.ok("createRoom", {});
  assert.equal((await plain.waitFor((v) => v.settings)).settings.theme, "midnight", "reset to built-in");
});
