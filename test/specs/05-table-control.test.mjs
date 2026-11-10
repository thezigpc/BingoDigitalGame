import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("a Table opened with the host's key can run the game; one joined by code alone cannot", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const hs = await host.waitFor((s) => s.tableKey, "host gets table key");
  assert.equal((await ann.waitFor((s) => s.myCards.length === 1)).tableKey, null, "players never see the key");

  const plain = await server.client();
  await plain.ok("joinRoom", { code, role: "table" });
  const ps = await plain.waitFor((s) => s.you.role === "table");
  assert.equal(ps.you.canControl, false);
  assert.equal(ps.tableKey, null);
  assert.equal((await plain.emit("startGame")).ok, false);

  const forged = await server.client();
  await forged.ok("joinRoom", { code, role: "table", tableKey: "guess" });
  assert.equal((await forged.emit("startGame")).ok, false);

  const tv = await server.client();
  const joined = await tv.ok("joinRoom", { code, role: "table", tableKey: hs.tableKey });
  await tv.waitFor((s) => s.you.canControl === true, "keyed table has control");

  await tv.ok("startGame");
  const { ball } = await tv.ok("callNext");
  await ann.waitFor((s) => s.called[0] === ball, "player sees the table's call");
  await tv.ok("setPaused", true);
  // A controlling table can change the pattern from the board (tap the card),
  // but still can't touch host-only settings. The forged one can't do either.
  await tv.ok("setPattern", { patternId: "blackout" });
  await ann.waitFor((s) => s.pattern.id === "blackout", "player sees the table's pattern");
  assert.equal((await forged.emit("setPattern", { patternId: "any-line" })).ok, false);
  assert.equal((await tv.emit("updateSettings", { autoCall: true })).ok, false);

  // Host sees all three tables and can grant / revoke control.
  const tables = (await host.waitFor((s) => s.tables.length === 3)).tables;
  assert.equal(tables.filter((t) => t.canControl).length, 1);
  await host.ok("setTableControl", { memberId: ps.you.id, canControl: true });
  await plain.waitFor((s) => s.you.canControl === true);
  await plain.ok("callNext");
  await host.ok("setTableControl", { memberId: joined.memberId, canControl: false });
  await tv.waitFor((s) => s.you.canControl === false);
  assert.equal((await tv.emit("callNext")).ok, false);
  assert.equal((await tv.emit("setTableControl", { memberId: joined.memberId, canControl: true })).ok, false);
});
