import { test } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import {
  FREE,
  FREE_INDEX,
  PATTERNS,
  CUSTOM_PATTERN_ID,
  columnRange,
  findPattern,
  generateCardCells,
  sanitizeCustomMask,
  shuffledBalls,
  winningVariant,
  letterFor,
} from "@bingo/shared";

test("cards: 5 distinct numbers per column from the right range, free center", () => {
  for (let n = 0; n < 200; n++) {
    const cells = generateCardCells(randomInt);
    assert.equal(cells.length, 25);
    assert.equal(cells[FREE_INDEX], FREE);
    for (let col = 0; col < 5; col++) {
      const [lo, hi] = columnRange(col);
      const nums = [0, 1, 2, 3, 4].map((r) => r * 5 + col).filter((i) => i !== FREE_INDEX).map((i) => cells[i]);
      assert.equal(new Set(nums).size, nums.length);
      for (const x of nums) assert.ok(x >= lo && x <= hi, `col ${col} has ${x}`);
    }
  }
});

test("draw order is a permutation of 1..75", () => {
  const balls = shuffledBalls(randomInt);
  assert.deepEqual([...balls].sort((a, b) => a - b), Array.from({ length: 75 }, (_, i) => i + 1));
  assert.equal(letterFor(1), "B");
  assert.equal(letterFor(31), "N");
  assert.equal(letterFor(75), "O");
});

test("win checks use called balls and the free center", () => {
  const cells = generateCardCells(randomInt);
  const anyLine = findPattern("any-line");
  // Middle row needs only 4 balls because of the free center.
  const middleRow = [10, 11, 13, 14].map((i) => cells[i]);
  assert.equal(winningVariant(cells, anyLine, new Set(middleRow.slice(0, 3))), -1);
  assert.notEqual(winningVariant(cells, anyLine, new Set(middleRow)), -1);
  const blackout = findPattern("blackout");
  assert.equal(winningVariant(cells, blackout, new Set(middleRow)), -1);
  assert.equal(winningVariant(cells, blackout, new Set(cells)), 0);
});

test("every pattern is a valid set of masks", () => {
  for (const p of PATTERNS) {
    assert.ok(p.variants.length > 0, p.id);
    for (const m of p.variants) for (const i of m) assert.ok(Number.isInteger(i) && i >= 0 && i < 25, p.id);
  }
  assert.ok(!findPattern(CUSTOM_PATTERN_ID));
});

test("custom masks are sanitized", () => {
  assert.equal(sanitizeCustomMask("nope"), null);
  assert.equal(sanitizeCustomMask([]), null);
  assert.equal(sanitizeCustomMask([FREE_INDEX]), null);
  assert.deepEqual(sanitizeCustomMask([4, 0, 0, 99, -1, 2.5]), [0, 4]);
});
