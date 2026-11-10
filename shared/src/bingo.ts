// Core 75-ball bingo rules: card layout, generation, patterns and win checks.
// Pure functions only - the server runs them authoritatively, and the client
// reuses them for display (e.g. highlighting a pattern), never to decide a win.

export const LETTERS = ["B", "I", "N", "G", "O"] as const;
export type Letter = (typeof LETTERS)[number];

export const MAX_BALL = 75;
export const CARD_SIZE = 5;
export const CELL_COUNT = CARD_SIZE * CARD_SIZE;
/** Row-major index of the free center square. */
export const FREE_INDEX = 12;
/** Value stored in a card's free cell. */
export const FREE = 0;

/** Returns an integer in [0, maxExclusive). Server passes crypto.randomInt. */
export type RandInt = (maxExclusive: number) => number;

export function letterFor(ball: number): Letter {
  return LETTERS[Math.min(4, Math.floor((ball - 1) / 15))];
}

export function columnRange(col: number): [number, number] {
  return [col * 15 + 1, col * 15 + 15];
}

export function ballLabel(ball: number): string {
  return `${letterFor(ball)}${ball}`;
}

export function shuffle<T>(items: readonly T[], rand: RandInt): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** All 75 balls in a random draw order. */
export function shuffledBalls(rand: RandInt): number[] {
  return shuffle(
    Array.from({ length: MAX_BALL }, (_, i) => i + 1),
    rand,
  );
}

/**
 * A 5x5 card as 25 row-major cells. Column c holds 5 distinct numbers from
 * its letter's 15-number range; the center is FREE.
 */
export function generateCardCells(rand: RandInt): number[] {
  const cells = new Array<number>(CELL_COUNT).fill(FREE);
  for (let col = 0; col < CARD_SIZE; col++) {
    const [lo] = columnRange(col);
    const pool = shuffle(
      Array.from({ length: 15 }, (_, i) => lo + i),
      rand,
    );
    for (let row = 0; row < CARD_SIZE; row++) {
      const idx = row * CARD_SIZE + col;
      if (idx === FREE_INDEX) continue;
      cells[idx] = pool[row];
    }
  }
  return cells;
}

/** True when the card cell at `index` counts as marked given the called balls. */
export function isCovered(cells: readonly number[], index: number, called: ReadonlySet<number>): boolean {
  return index === FREE_INDEX || called.has(cells[index]);
}

// ---------------------------------------------------------------- patterns

/** A set of cell indices that must all be covered. */
export type Mask = number[];

export interface PatternDef {
  id: string;
  name: string;
  /** Winning if ANY variant is fully covered. */
  variants: Mask[];
}

const idx = (row: number, col: number) => row * CARD_SIZE + col;
const range5 = [0, 1, 2, 3, 4];

const ROWS: Mask[] = range5.map((r) => range5.map((c) => idx(r, c)));
const COLS: Mask[] = range5.map((c) => range5.map((r) => idx(r, c)));
const DIAG_DOWN: Mask = range5.map((i) => idx(i, i));
const DIAG_UP: Mask = range5.map((i) => idx(4 - i, i));
const LINES: Mask[] = [...ROWS, ...COLS, DIAG_DOWN, DIAG_UP];

const uniq = (m: Mask): Mask => [...new Set(m)].sort((a, b) => a - b);
const fromGrid = (grid: string[]): Mask => {
  const out: number[] = [];
  grid.forEach((line, r) => [...line].forEach((ch, c) => ch === "X" && out.push(idx(r, c))));
  return out;
};

function pairs(lines: Mask[]): Mask[] {
  const out: Mask[] = [];
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) out.push(uniq([...lines[a], ...lines[b]]));
  }
  return out;
}

export const PATTERNS: PatternDef[] = [
  { id: "any-line", name: "Any Line", variants: LINES },
  { id: "horizontal", name: "Any Horizontal Line", variants: ROWS },
  { id: "vertical", name: "Any Vertical Line", variants: COLS },
  { id: "diagonal", name: "Any Diagonal", variants: [DIAG_DOWN, DIAG_UP] },
  { id: "two-lines", name: "Any Two Lines", variants: pairs(LINES) },
  { id: "four-corners", name: "Four Corners", variants: [[idx(0, 0), idx(0, 4), idx(4, 0), idx(4, 4)]] },
  {
    id: "postage-stamp",
    name: "Postage Stamp (any corner)",
    variants: [
      [idx(0, 0), idx(0, 1), idx(1, 0), idx(1, 1)],
      [idx(0, 3), idx(0, 4), idx(1, 3), idx(1, 4)],
      [idx(3, 0), idx(3, 1), idx(4, 0), idx(4, 1)],
      [idx(3, 3), idx(3, 4), idx(4, 3), idx(4, 4)],
    ],
  },
  { id: "letter-x", name: "Letter X", variants: [uniq([...DIAG_DOWN, ...DIAG_UP])] },
  { id: "plus", name: "Plus Sign", variants: [uniq([...ROWS[2], ...COLS[2]])] },
  { id: "letter-t", name: "Letter T", variants: [uniq([...ROWS[0], ...COLS[2]])] },
  { id: "letter-l", name: "Letter L", variants: [uniq([...COLS[0], ...ROWS[4]])] },
  {
    id: "small-frame",
    name: "Small Frame",
    variants: [fromGrid([".....", ".XXX.", ".X.X.", ".XXX.", "....."])],
  },
  {
    id: "large-frame",
    name: "Large Frame",
    variants: [fromGrid(["XXXXX", "X...X", "X...X", "X...X", "XXXXX"])],
  },
  {
    id: "diamond",
    name: "Diamond",
    variants: [fromGrid(["..X..", ".X.X.", "X...X", ".X.X.", "..X.."])],
  },
  {
    id: "kite",
    name: "Kite",
    variants: [fromGrid(["...XX", "...XX", "..X..", ".X...", "X...."])],
  },
  { id: "blackout", name: "Blackout (Full Card)", variants: [range5.flatMap((r) => ROWS[r])] },
];

export const DEFAULT_PATTERN_ID = "any-line";
export const CUSTOM_PATTERN_ID = "custom";

export function findPattern(id: string): PatternDef | undefined {
  return PATTERNS.find((p) => p.id === id);
}

/** Validates a host-drawn mask: unique in-range indices, at least one real cell. */
export function sanitizeCustomMask(mask: unknown): Mask | null {
  if (!Array.isArray(mask)) return null;
  const cleaned = uniq(mask.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < CELL_COUNT));
  if (cleaned.filter((n) => n !== FREE_INDEX).length < 1) return null;
  return cleaned;
}

/**
 * Which B-I-N-G-O columns can matter for this pattern: a column counts if any
 * variant uses one of its cells (the free center doesn't count, it's always
 * covered). Used by "Skip unused numbers".
 */
export function usedColumns(pattern: Pick<PatternDef, "variants">): boolean[] {
  const used = [false, false, false, false, false];
  for (const mask of pattern.variants) for (const i of mask) if (i !== FREE_INDEX) used[i % CARD_SIZE] = true;
  return used;
}

/** The column (0 = B ... 4 = O) a ball belongs to. */
export function columnOf(ball: number): number {
  return Math.min(4, Math.floor((ball - 1) / 15));
}

/** Index of the first variant fully covered on this card, or -1. */
export function winningVariant(cells: readonly number[], pattern: PatternDef, called: ReadonlySet<number>): number {
  return pattern.variants.findIndex((mask) => mask.every((i) => isCovered(cells, i, called)));
}
