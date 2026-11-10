import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("paper cards: joiners are nameless viewers who see calls but have no cards", async () => {
  const { code, host } = await setupRoom(server, []);
  await host.ok("updateSettings", { cardMode: "paper" });

  const probe = await server.client();
  assert.equal((await probe.ok("roomInfo", { code })).cardMode, "paper");
  assert.equal((await probe.emit("roomInfo", { code: "ZZZZ" })).ok, false);

  // No name needed, and any name given is not shown to anyone.
  const v1 = await server.client();
  const j1 = await v1.ok("joinRoom", { code, role: "player" });
  assert.equal(j1.role, "viewer");
  const v2 = await server.client();
  await v2.ok("joinRoom", { code, role: "player", name: "Secret" });

  const hs = await host.waitFor((s) => s.viewerCount === 2, "host sees 2 viewers");
  assert.equal(hs.players.length, 0);
  assert.ok(!JSON.stringify(hs).includes("Secret"));

  await host.ok("setPattern", { patternId: "four-corners" });
  await host.ok("startGame");
  const { ball } = await host.ok("callNext");
  const vs = await v1.waitFor((s) => s.called.length === 1);
  assert.equal(vs.called[0], ball);
  assert.equal(vs.pattern.id, "four-corners");
  assert.equal(vs.myCards.length, 0);
  assert.equal(vs.players.length, 0);

  assert.equal((await v1.emit("claimBingo")).ok, false, "viewers can't claim");
  assert.equal((await host.emit("updateSettings", { cardMode: "digital" })).ok, false, "locked mid-game");
});

test("switching a room to paper turns seated players into viewers", async () => {
  const { host, players: [ann] } = await setupRoom(server, ["Ann"]);
  await ann.waitFor((s) => s.myCards.length === 1);
  await host.ok("updateSettings", { cardMode: "paper" });
  const s = await ann.waitFor((s) => s.you.role === "viewer");
  assert.equal(s.myCards.length, 0);
  assert.equal(s.you.name, "");
  const hs = await host.waitFor((s) => s.viewerCount === 1 && s.players.length === 0);
  assert.equal(hs.settings.cardMode, "paper");
});
