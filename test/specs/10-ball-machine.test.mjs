import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("ball machine: tap to call, no Call next, take back a mis-tap", async () => {
  const { host, players } = await setupRoom(server, ["Ann"]);
  const [ann] = players;
  await host.waitFor((s) => s.settings.drawMode === "app", "the app draws by default");

  // Off by default: picking a number is refused.
  await host.ok("startGame");
  assert.equal((await host.emit("callBall", 7)).ok, false, "not in app mode");

  // Switch mid-game; auto-call stops and nothing is skipped.
  await host.ok("updateSettings", { autoCall: true, autoCallSeconds: 3 });
  await host.ok("updateSettings", { drawMode: "machine" });
  const s = await host.waitFor((v) => v.settings.drawMode === "machine");
  assert.equal(s.nextCallAt, null, "no auto-call countdown with a ball machine");
  assert.equal(s.ballsLeft, 75);

  const res = await host.emit("callNext");
  assert.equal(res.ok, false, "Call next ball is refused");
  assert.match(res.error, /ball machine/);

  assert.equal((await host.ok("callBall", 7)).ball, 7);
  await host.ok("callBall", 64);
  await host.waitFor((v) => v.called.join() === "7,64" && v.ballsLeft === 73, "both called, in order");
  assert.equal((await host.emit("callBall", 7)).ok, false, "already called");
  for (const bad of [0, 76, 2.5, "x"]) assert.equal((await host.emit("callBall", bad)).ok, false, `bad ball ${bad}`);
  assert.equal((await ann.emit("callBall", 8)).ok, false, "players can't call");

  // A player marks a called number; taking the number back clears the mark.
  const card = (await ann.waitFor((v) => v.myCards.length === 1)).myCards[0];
  const ball = card.cells.find((n, i) => i !== 12 && !host.state.called.includes(n));
  await host.ok("callBall", ball);
  await ann.ok("daub", { cardId: card.id, index: card.cells.indexOf(ball) });
  await ann.waitFor((v) => v.myCards[0].daubs.includes(card.cells.indexOf(ball)), "marked");
  await host.ok("uncallBall", ball);
  await host.waitFor((v) => !v.called.includes(ball) && v.ballsLeft === 73, "taken back");
  await ann.waitFor((v) => !v.myCards[0].daubs.includes(card.cells.indexOf(ball)), "mark cleared");
  assert.equal((await host.emit("uncallBall", ball)).ok, false, "can't take back an uncalled number");
  // It can be called again.
  await host.ok("callBall", ball);
});

test("ball machine: a waiting claim blocks take-backs and doesn't pause", async () => {
  const { host, players } = await setupRoom(server, ["Bob"]);
  const [bob] = players;
  await host.ok("updateSettings", { drawMode: "machine", daubMode: "auto" });
  await host.ok("setPattern", { patternId: "four-corners" });
  await host.ok("startGame");
  const card = (await bob.waitFor((v) => v.phase === "playing" && v.myCards.length === 1)).myCards[0];
  for (const i of [0, 4, 20, 24]) await host.ok("callBall", card.cells[i]);

  const claim = await bob.ok("claimBingo");
  assert.equal(claim.valid, true);
  const s = await host.waitFor((v) => v.claims.some((c) => c.status === "pending"));
  assert.equal(s.paused, false, "no Paused state with a ball machine");

  const blocked = await host.emit("uncallBall", card.cells[0]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /claim/);

  const pending = s.claims.find((c) => c.status === "pending");
  await host.ok("resolveClaim", { claimId: pending.id, confirm: false });
  await host.ok("uncallBall", card.cells[0]);
});

test("ball machine: a Table with control can pick numbers; a display-only one can't", async () => {
  const { code, host } = await setupRoom(server, []);
  await host.ok("updateSettings", { drawMode: "machine" });
  await host.ok("startGame");
  const tv = await server.client();
  await tv.ok("joinRoom", { code, role: "table" });
  assert.equal((await tv.emit("callBall", 5)).ok, false, "display-only");
  const tableId = (await host.waitFor((v) => v.tables.length === 1)).tables[0].id;
  await host.ok("setTableControl", { memberId: tableId, canControl: true });
  await tv.waitFor((v) => v.you.canControl);
  await tv.ok("callBall", 5);
  await tv.ok("uncallBall", 5);

  // Back to the app: Call next works again and skips nothing already called.
  await host.ok("updateSettings", { drawMode: "app" });
  assert.equal((await host.emit("callBall", 9)).ok, false, "picking is off again");
  const { ball } = await host.ok("callNext");
  assert.ok(ball >= 1 && ball <= 75);
});
