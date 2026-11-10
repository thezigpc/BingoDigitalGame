import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("layout and draw animation: callers can change them any time, everyone sees them", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const hs = await host.waitFor((s) => s.tableKey, "host gets table key");
  assert.equal(hs.settings.layout, "easy");
  assert.equal(hs.settings.ballAnimation, "fade");

  await host.ok("setDisplay", { layout: "classic" });
  await ann.waitFor((s) => s.settings.layout === "classic", "player sees the new layout");

  // Mid-game, from a Table the host trusts.
  await host.ok("startGame");
  const tv = await server.client();
  await tv.ok("joinRoom", { code, role: "table", tableKey: hs.tableKey });
  await tv.waitFor((s) => s.you.canControl === true);
  await tv.ok("setDisplay", { layout: "vertical", ballAnimation: "zoom" });
  const s = await host.waitFor((v) => v.settings.layout === "vertical" && v.settings.ballAnimation === "zoom");
  assert.equal(s.phase, "playing", "changing the display doesn't touch the game");

  // Changing only one field leaves the other alone.
  await host.ok("setDisplay", { ballAnimation: "none" });
  await host.waitFor((v) => v.settings.ballAnimation === "none" && v.settings.layout === "vertical");

  // Players, display-only tables and junk values are rejected.
  assert.equal((await ann.emit("setDisplay", { layout: "easy" })).ok, false);
  const plain = await server.client();
  await plain.ok("joinRoom", { code, role: "table" });
  assert.equal((await plain.emit("setDisplay", { layout: "easy" })).ok, false);
  assert.equal((await host.emit("setDisplay", { layout: "sideways" })).ok, false);
  assert.equal((await host.emit("setDisplay", { ballAnimation: "explode" })).ok, false);
  assert.equal((await host.emit("setDisplay", null)).ok, true, "an empty change is harmless");
});

test("pattern card size and placement: validated, rounded, and resettable", async () => {
  const { host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const s0 = await host.waitFor((s) => s.settings);
  assert.equal(s0.settings.patternScale, 1);
  assert.equal(s0.settings.patternPlace, "normal");

  await host.ok("setDisplay", { patternScale: 1.6666, patternPlace: "ball" });
  const s1 = await ann.waitFor((s) => s.settings.patternPlace === "ball", "player sees the change");
  assert.equal(s1.settings.patternScale, 1.67);

  // One field at a time leaves the other alone.
  await host.ok("setDisplay", { patternPlace: "join" });
  await host.waitFor((s) => s.settings.patternPlace === "join" && s.settings.patternScale === 1.67);
  await host.ok("setDisplay", { patternScale: 1 });
  await host.waitFor((s) => s.settings.patternScale === 1 && s.settings.patternPlace === "join");

  for (const bad of [
    { patternScale: 0.1 },
    { patternScale: 2.5 },
    { patternScale: "big" },
    { patternPlace: "corner" },
    { patternPlace: null },
  ]) {
    assert.equal((await host.emit("setDisplay", bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal((await ann.emit("setDisplay", { patternScale: 1 })).ok, false, "players can't");
});

test("theme, alignment, board shape and show/hide options", async () => {
  const { host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const s0 = (await host.waitFor((s) => s.settings)).settings;
  assert.deepEqual(
    [s0.theme, s0.align, s0.boardFit, s0.showJoin, s0.showRecent],
    ["midnight", "center", "fit", true, true],
  );
  await host.ok("setDisplay", { theme: "hall", align: "top", boardFit: "fill", showJoin: false, showRecent: false });
  const s1 = (await ann.waitFor((s) => s.settings.theme === "hall")).settings;
  assert.deepEqual([s1.align, s1.boardFit, s1.showJoin, s1.showRecent], ["top", "fill", false, false]);
  for (const bad of [{ theme: "plaid" }, { align: "left" }, { boardFit: "stretch" }, { showJoin: "no" }, { showRecent: 0 }]) {
    assert.equal((await host.emit("setDisplay", bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal((await host.waitFor((s) => s.settings)).settings.theme, "hall", "a rejected change changes nothing");
});
