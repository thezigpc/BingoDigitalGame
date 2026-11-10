import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { columnOf, findPattern, usedColumns } from "@bingo/shared";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("usedColumns: free center doesn't count; line patterns use every column", () => {
  assert.deepEqual(usedColumns(findPattern("four-corners")), [true, false, false, false, true]);
  assert.deepEqual(usedColumns(findPattern("any-line")), [true, true, true, true, true]);
  // Custom: only the free center plus one B square -> only B matters.
  assert.deepEqual(usedColumns({ variants: [[0, 12]] }), [true, false, false, false, false]);
  assert.equal(columnOf(1), 0);
  assert.equal(columnOf(15), 0);
  assert.equal(columnOf(16), 1);
  assert.equal(columnOf(75), 4);
});

test("skip unused numbers: only the pattern's columns are called; switching patterns brings the rest back", async () => {
  const { host } = await setupRoom(server, []);
  await host.waitFor((s) => s.settings.skipUnused === true, "on by default");

  // Custom pattern: just the top-left (B) square.
  await host.ok("setPattern", { patternId: "custom", customMask: [0] });
  await host.ok("startGame");
  await host.waitFor((s) => s.phase === "playing" && s.ballsLeft === 15, "15 B balls in play");

  const called = [];
  for (let i = 0; i < 15; i++) called.push((await host.ok("callNext")).ball);
  assert.ok(called.every((b) => b >= 1 && b <= 15), `only B balls called: ${called}`);
  const none = await host.emit("callNext");
  assert.equal(none.ok, false, "nothing left for this pattern");
  await host.waitFor((s) => s.ballsLeft === 0);

  // Four corners also uses O: those 15 come back into play mid-game.
  await host.ok("setPattern", { patternId: "four-corners" });
  await host.waitFor((s) => s.ballsLeft === 15, "O balls back in play");
  const o = (await host.ok("callNext")).ball;
  assert.ok(o >= 61 && o <= 75, `O ball called: ${o}`);

  // Turning skipping off puts every remaining ball back.
  await host.ok("updateSettings", { skipUnused: false });
  await host.waitFor((s) => s.ballsLeft === 75 - 16, "all remaining balls in play");
});
