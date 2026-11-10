import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("a dropped player resumes the same seat and cards, and gets fresh state", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const before = await ann.waitFor((s) => s.myCards.length === 1);
  await host.ok("startGame");
  await ann.waitFor((s) => s.phase === "playing");

  ann.socket.close();
  await host.waitFor((s) => s.players[0].connected === false, "host sees disconnect");
  await host.ok("callNext");
  await host.ok("callNext");

  // A fresh socket knows nothing until it resumes with the stored token.
  const again = await server.client();
  const res = await again.ok("resume", { code, token: ann.token });
  assert.equal(res.memberId, before.you.id);
  const s = await again.waitFor((s) => s.called.length === 2, "missed calls arrive");
  assert.equal(s.myCards[0].id, before.myCards[0].id);
  await host.waitFor((s) => s.players[0].connected === true, "host sees reconnect");

  // Joining again with the stored token keeps the same seat too.
  const third = await server.client();
  const rejoin = await third.ok("joinRoom", { code, role: "player", name: "Whatever", token: ann.token });
  assert.equal(rejoin.memberId, before.you.id);
  assert.equal(host.state.players.length, 1);
});

test("bad codes and tokens are rejected; the host closing the room notifies players", async () => {
  const { code, host, players: [bob] } = await setupRoom(server, ["Bob"]);
  const stranger = await server.client();
  assert.equal((await stranger.emit("resume", { code, token: "forged" })).ok, false);
  assert.equal((await stranger.emit("joinRoom", { code: "ZZZZ", role: "player", name: "x" })).ok, false);
  await host.ok("closeRoom");
  await new Promise((r) => setTimeout(r, 200));
  assert.match(bob.closedReason ?? "", /host ended/);
});
