import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findPattern, winningVariant } from "@bingo/shared";
import { startServer, setupRoom } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("lobby: players get cards, settings are host-only, names are unique", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const s = await ann.waitFor((s) => s.myCards.length === 1, "card dealt");
  assert.equal(s.phase, "lobby");
  assert.equal(s.you.role, "player");

  const dup = await (await server.client()).emit("joinRoom", { code, role: "player", name: "ann" });
  assert.equal(dup.ok, false);

  assert.equal((await ann.emit("startGame")).ok, false);

  await host.ok("updateSettings", { cardsPerPlayer: 3 });
  await ann.waitFor((s) => s.myCards.length === 3, "redeal to 3 cards");
  assert.equal((await host.emit("updateSettings", { cardsPerPlayer: 9 })).ok, false);

  const table = await server.client();
  await table.ok("joinRoom", { code, role: "table" });
  await host.waitFor((s) => s.tableCount === 1, "table counted");
});

test("full game: daub rules, false claim, valid claim pauses, host confirms, new game", async () => {
  const { host, players: [bob] } = await setupRoom(server, ["Bob"]);
  await bob.waitFor((s) => s.myCards.length === 1);
  assert.equal((await host.emit("callNext")).ok, false, "no calling in the lobby");
  await host.ok("startGame");
  await bob.waitFor((s) => s.phase === "playing");

  // A claim with nothing called is false, and the host sees it.
  const early = await bob.ok("claimBingo");
  assert.equal(early.valid, false);
  await host.waitFor((s) => s.claims.some((c) => c.status === "invalid" && c.playerName === "Bob"));
  assert.equal((await bob.emit("claimBingo")).ok, false, "cooldown after a false claim");

  const card = bob.state.myCards[0];
  const pattern = findPattern("any-line");
  const called = new Set();
  // Daubing a number that hasn't been called is rejected.
  assert.equal((await bob.emit("daub", { cardId: card.id, index: 0 })).ok, false);

  while (winningVariant(card.cells, pattern, called) < 0) {
    const { ball } = await host.ok("callNext");
    called.add(ball);
    const i = card.cells.indexOf(ball);
    if (i >= 0) await bob.ok("daub", { cardId: card.id, index: i });
  }
  await bob.waitFor((s) => s.called.length === called.size);
  assert.ok(bob.state.myCards[0].daubs.length > 0);

  await sleep(3100); // false-claim cooldown
  const claim = await bob.ok("claimBingo");
  assert.equal(claim.valid, true);
  assert.equal(claim.cardId, card.id);
  const hs = await host.waitFor((s) => s.claims.some((c) => c.status === "pending"), "pending claim");
  assert.equal(hs.paused, true, "a valid claim pauses the game");
  const pending = hs.claims.find((c) => c.status === "pending");
  assert.ok(pending.winningMask.length >= 4);

  await bob.ok("claimBingo"); // duplicate - must not add another entry
  await host.ok("resolveClaim", { claimId: pending.id, confirm: true });
  const after = await bob.waitFor((s) => s.claims.some((c) => c.status === "confirmed"));
  assert.equal(after.claims.filter((c) => c.cardId === card.id).length, 1);

  await host.ok("newGame");
  const fresh = await bob.waitFor((s) => s.phase === "lobby" && s.gameNumber === 2);
  assert.equal(fresh.called.length, 0);
  assert.equal(fresh.claims.length, 0);
  assert.notEqual(fresh.myCards[0].id, card.id, "new cards for a new game");
});

test("auto-daub mode marks called numbers for the player", async () => {
  const { host, players: [cy] } = await setupRoom(server, ["Cy"]);
  await host.ok("updateSettings", { daubMode: "auto" });
  await host.ok("startGame");
  assert.equal((await host.emit("updateSettings", { daubMode: "manual" })).ok, false, "locked mid-game");
  const cells = (await cy.waitFor((s) => s.phase === "playing")).myCards[0].cells;
  let hit = false;
  while (!hit) {
    const { ball } = await host.ok("callNext");
    hit = cells.includes(ball);
  }
  const s = await cy.waitFor((s) => s.myCards[0].daubs.length === 1);
  assert.equal((await cy.emit("daub", { cardId: s.myCards[0].id, index: s.myCards[0].daubs[0] })).ok, false);
});

test("custom pattern and automatic calling", async () => {
  const { host, players: [di] } = await setupRoom(server, ["Di"]);
  await host.ok("setPattern", { patternId: "custom", customMask: [0, 4, 20, 24] });
  assert.equal((await host.emit("setPattern", { patternId: "nope" })).ok, false);
  await host.ok("updateSettings", { autoCall: true, autoCallSeconds: 3 });
  await host.ok("startGame");
  const s = await di.waitFor((s) => s.phase === "playing" && s.nextCallAt !== null);
  assert.equal(s.pattern.id, "custom");
  await di.waitFor((s) => s.called.length === 1, "auto call", 6000);
  await host.ok("setPaused", true);
  const paused = await di.waitFor((s) => s.paused && s.nextCallAt === null);
  assert.equal(paused.called.length, 1);
});
