// Socket.io protocol shared by server and client. Clients only send intents;
// the server owns all state and pushes a per-member RoomView after every change.

import type { Mask } from "./bingo.js";

/** viewer: a phone in a paper-card room - sees the shared board, no name, no cards. */
export type Role = "host" | "table" | "player" | "viewer";
export type Phase = "lobby" | "playing";
export type DaubMode = "manual" | "auto";
/** digital: players get cards on their phones. paper: everyone uses their own physical cards. */
export type CardMode = "digital" | "paper";

export const DEFAULT_GAME_NAME = "Bingo Night";

/** How the big screen (Table / host board / paper viewers) arranges itself. */
export type BoardLayout = "easy" | "classic" | "classic-reversed" | "simple" | "stacked" | "vertical";
/** How a newly drawn ball appears. */
export type BallAnimation = "none" | "fade" | "drop" | "zoom" | "roll" | "flip";

export const BOARD_LAYOUTS: { id: BoardLayout; name: string; hint: string }[] = [
  { id: "easy", name: "Easy view", hint: "Game info across the top, the board full width below." },
  { id: "classic", name: "Classic", hint: "Like a bingo hall flashboard: big board, ball and info on the right." },
  { id: "classic-reversed", name: "Classic reversed", hint: "Classic with the ball and info on the left." },
  { id: "simple", name: "Simple", hint: "The board in the middle, game info on both sides." },
  { id: "stacked", name: "Stacked", hint: "The board on top, game info below." },
  { id: "vertical", name: "Vertical", hint: "B-I-N-G-O as columns. Best for portrait screens." },
];

export const BALL_ANIMATIONS: { id: BallAnimation; name: string }[] = [
  { id: "fade", name: "Fade in" },
  { id: "drop", name: "Drop in" },
  { id: "zoom", name: "Zoom" },
  { id: "roll", name: "Roll in" },
  { id: "flip", name: "Flip" },
  { id: "none", name: "Off" },
];

export interface RoomSettings {
  cardMode: CardMode;
  daubMode: DaubMode;
  cardsPerPlayer: number;
  autoCall: boolean;
  autoCallSeconds: number;
  /**
   * Only call numbers from columns the current pattern uses (e.g. Four
   * Corners never calls I, N or G). Re-checked on every call, so a pattern
   * change mid-game takes effect on the next ball.
   */
  skipUnused: boolean;
  /** Display only; can change any time. */
  layout: BoardLayout;
  ballAnimation: BallAnimation;
  /**
   * Pattern card size on the big screen (1 = the layout's own size). It
   * stays in the layout, which reflows around it.
   */
  patternScale: number;
  /** Where the pattern card sits: its normal slot, or swapped with the ball / QR box. */
  patternPlace: PatternPlace;
  /** Side pieces and board line up along the top, or centered as a group. */
  align: BoardAlign;
  /** fit: square-ish board cells. fill: the board stretches to fill its area. */
  boardFit: BoardFit;
  /** The QR code + room code box. */
  showJoin: boolean;
  /** The strip of previous balls. */
  showRecent: boolean;
  /** Color theme for every screen in the room. */
  theme: ThemeId;
}

export type BoardAlign = "top" | "center";
export type BoardFit = "fit" | "fill";
export type ThemeId = "midnight" | "daylight" | "hall" | "neon" | "ocean" | "sunset" | "contrast";

/** swatch: background, panel, accent - for the picker tiles. */
export const THEMES: { id: ThemeId; name: string; swatch: [string, string, string] }[] = [
  { id: "midnight", name: "Midnight", swatch: ["#101528", "#26305a", "#f2b33d"] },
  { id: "daylight", name: "Daylight", swatch: ["#f3f5fb", "#ffffff", "#d97706"] },
  { id: "hall", name: "Bingo hall", swatch: ["#062b1d", "#145c40", "#ffd23f"] },
  { id: "neon", name: "Neon", swatch: ["#0a0014", "#2a0f52", "#00f5d4"] },
  { id: "ocean", name: "Ocean", swatch: ["#04202e", "#0f4f6d", "#ff8c61"] },
  { id: "sunset", name: "Sunset", swatch: ["#2b1020", "#5c2347", "#ffb347"] },
  { id: "contrast", name: "High contrast", swatch: ["#000000", "#222222", "#ffff00"] },
];

export type PatternPlace = "normal" | "ball" | "join";

export const PATTERN_PLACES: { id: PatternPlace; name: string }[] = [
  { id: "normal", name: "Normal spot" },
  { id: "ball", name: "Swap with the ball" },
  { id: "join", name: "Swap with the QR code" },
];

export type DisplaySettings = Pick<
  RoomSettings,
  | "layout"
  | "ballAnimation"
  | "patternScale"
  | "patternPlace"
  | "align"
  | "boardFit"
  | "showJoin"
  | "showRecent"
  | "theme"
>;

export const DISPLAY_KEYS = [
  "layout",
  "ballAnimation",
  "patternScale",
  "patternPlace",
  "align",
  "boardFit",
  "showJoin",
  "showRecent",
  "theme",
] as const satisfies readonly (keyof DisplaySettings)[];

/**
 * Validates a display-settings change (from a room, a host device's saved
 * default, or the admin's server-wide default). Unknown keys are ignored;
 * returns null if any known key has a bad value.
 */
export function sanitizeDisplay(patch: unknown): Partial<DisplaySettings> | null {
  if (patch === null || patch === undefined) return {};
  if (typeof patch !== "object") return null;
  const p = patch as Record<string, unknown>;
  const out: Partial<DisplaySettings> = {};
  const oneOf = <T extends string>(key: keyof DisplaySettings, ids: readonly { id: T }[] | readonly T[]) => {
    if (p[key] === undefined) return true;
    const list = (ids as readonly (T | { id: T })[]).map((x) => (typeof x === "string" ? x : x.id));
    if (!list.includes(p[key] as T)) return false;
    (out as Record<string, unknown>)[key] = p[key];
    return true;
  };
  const bool = (key: keyof DisplaySettings) => {
    if (p[key] === undefined) return true;
    if (typeof p[key] !== "boolean") return false;
    (out as Record<string, unknown>)[key] = p[key];
    return true;
  };
  let ok =
    oneOf("layout", BOARD_LAYOUTS) &&
    oneOf("ballAnimation", BALL_ANIMATIONS) &&
    oneOf("patternPlace", PATTERN_PLACES) &&
    oneOf("align", ["top", "center"] as const) &&
    oneOf("boardFit", ["fit", "fill"] as const) &&
    oneOf("theme", THEMES) &&
    bool("showJoin") &&
    bool("showRecent");
  if (ok && p.patternScale !== undefined) {
    const { min, max } = SETTINGS_LIMITS.patternScale;
    const s = p.patternScale;
    if (typeof s !== "number" || !Number.isFinite(s) || s < min || s > max) ok = false;
    else out.patternScale = Math.round(s * 100) / 100;
  }
  return ok ? out : null;
}

/** Just the display part of a room's settings. */
export function displayOf(s: RoomSettings): DisplaySettings {
  const out = {} as Record<string, unknown>;
  for (const k of DISPLAY_KEYS) out[k] = s[k];
  return out as unknown as DisplaySettings;
}

export const SETTINGS_LIMITS = {
  cardsPerPlayer: { min: 1, max: 4 },
  autoCallSeconds: { min: 3, max: 60 },
  patternScale: { min: 0.5, max: 2 },
} as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  cardMode: "digital",
  daubMode: "manual",
  cardsPerPlayer: 1,
  autoCall: false,
  autoCallSeconds: 8,
  skipUnused: true,
  layout: "easy",
  ballAnimation: "fade",
  patternScale: 1,
  patternPlace: "normal",
  align: "center",
  boardFit: "fit",
  showJoin: true,
  showRecent: true,
  theme: "midnight",
};

export interface PatternView {
  id: string;
  name: string;
  variants: Mask[];
}

export interface CardView {
  id: string;
  /** 25 row-major cells; 0 is the free center. */
  cells: number[];
  /** Cell indices this player has daubed (manual mode). Free center is implicit. */
  daubs: number[];
}

export interface MemberSummary {
  id: string;
  name: string;
  connected: boolean;
}

export type ClaimStatus = "pending" | "confirmed" | "dismissed" | "invalid";

export interface ClaimView {
  id: string;
  playerId: string;
  playerName: string;
  /** Card that matched (valid claims), or null for a false bingo. */
  cardId: string | null;
  /** Cells of the matching card, so the host/table can show it. */
  cells: number[] | null;
  /** The winning variant's mask on that card. */
  winningMask: Mask | null;
  status: ClaimStatus;
  /** How many balls had been called when the claim was made. */
  callCount: number;
}

export interface TableSummary {
  id: string;
  connected: boolean;
  /** Allowed to run the game (call balls, start, pause, resolve claims). */
  canControl: boolean;
}

export interface RoomView {
  code: string;
  /** canControl: true for the host, and for Table displays the host trusts. */
  you: { id: string; role: Role; name: string; canControl: boolean };
  phase: Phase;
  gameNumber: number;
  settings: RoomSettings;
  pattern: PatternView;
  called: number[];
  /** Balls that can still be called (with skipUnused, only from columns the pattern uses). */
  ballsLeft: number;
  /** Auto-calling is paused (host pause, or a pending claim). */
  paused: boolean;
  /** Epoch ms of the next automatic call, if one is scheduled. */
  nextCallAt: number | null;
  /** Server's clock when this view was built, for countdown skew correction. */
  serverTime: number;
  players: MemberSummary[];
  tableCount: number;
  /** Host only (empty for everyone else). */
  tables: TableSummary[];
  /**
   * Host only: secret that makes a Table display joining with it a
   * controller. Put in the host's "Open Table display" link.
   */
  tableKey: string | null;
  /** Phones watching the shared board in a paper-card room. */
  viewerCount: number;
  claims: ClaimView[];
  /** Only populated for the player role. */
  myCards: CardView[];
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface JoinRequest {
  code: string;
  /** "player" joins a paper-card room as a nameless viewer. */
  role: "player" | "table";
  name?: string;
  token?: string;
  /** Table only: the host's table key, granting game controls. */
  tableKey?: string;
}

export interface ResumeRequest {
  code: string;
  token: string;
}

export interface JoinResult {
  code: string;
  token: string;
  memberId: string;
  role: Role;
  name: string;
}

// ------------------------------------------------------------- venue TVs
// Bar Games box only (BARGAMES.md, "Casting"). Mirrors the SDK's CastTargets /
// CastResult so the shared package doesn't depend on the SDK.

export interface TvDisplay {
  id: string;
  name: string;
  group?: string;
  busy: boolean;
  showingThisGame: boolean;
  roomCode?: string;
}
/** enabled false (always, off a box): hide the TVs control. */
export interface TvTargets {
  enabled: boolean;
  pinRequired: boolean;
  displays: TvDisplay[];
}
export interface TvCastResult {
  ok: boolean;
  message?: string;
  /** needsCode: the TV isn't paired with the box yet (staff do that in the box admin). */
  results?: Record<string, { ok: boolean; message?: string; needsCode?: boolean }>;
}

export interface ClientToServerEvents {
  createRoom: (req: { name?: string; display?: Partial<DisplaySettings> }, ack: Ack<JoinResult>) => void;
  /** Lets the join form know whether to ask for a name. */
  roomInfo: (req: { code: string }, ack: Ack<{ cardMode: CardMode }>) => void;
  joinRoom: (req: JoinRequest, ack: Ack<JoinResult>) => void;
  /** Re-sent on every socket connect: rebinds this socket to its seat. */
  resume: (req: ResumeRequest, ack: Ack<JoinResult>) => void;
  leaveRoom: (ack: Ack) => void;

  // host only
  updateSettings: (patch: Partial<RoomSettings>, ack: Ack) => void;
  setPattern: (req: { patternId: string; customMask?: Mask }, ack: Ack) => void;
  setTableControl: (req: { memberId: string; canControl: boolean }, ack: Ack) => void;
  kickPlayer: (memberId: string, ack: Ack) => void;
  closeRoom: (ack: Ack) => void;
  /** Bar Games box only: the venue's TVs, and putting this room on them. */
  listTvs: (ack: Ack<{ tvs: TvTargets }>) => void;
  castToTvs: (req: { ids: string[]; pin?: string }, ack: Ack<{ result: TvCastResult }>) => void;
  stopTvs: (req: { ids: string[]; pin?: string }, ack: Ack<{ result: TvCastResult }>) => void;

  // host, or a Table display with control
  startGame: (ack: Ack) => void;
  callNext: (ack: Ack<{ ball: number }>) => void;
  setPaused: (paused: boolean, ack: Ack) => void;
  resolveClaim: (req: { claimId: string; confirm: boolean }, ack: Ack) => void;
  /** Ends the current game. startNext: deal and start the next one immediately. */
  newGame: (req: { startNext?: boolean }, ack: Ack) => void;
  /** Big-screen look: layout and draw animation. */
  setDisplay: (patch: Partial<DisplaySettings>, ack: Ack) => void;

  // player
  daub: (req: { cardId: string; index: number }, ack: Ack) => void;
  claimBingo: (ack: Ack<{ valid: boolean; cardId: string | null }>) => void;
}

export interface ServerToClientEvents {
  state: (view: RoomView) => void;
  /** Room is gone (closed by host, swept idle, or you were removed). */
  closed: (info: { reason: string }) => void;
}

export const ERRORS = {
  ROOM_NOT_FOUND: "That room code doesn't exist.",
  BAD_TOKEN: "Your seat in this room has expired.",
  NOT_HOST: "Only the host can do that.",
  NOT_PLAYER: "Only players can do that.",
  NOT_IN_ROOM: "You're not in a room.",
  NAME_REQUIRED: "Please enter a name.",
  NAME_TAKEN: "Someone in this room already has that name.",
  ROOM_FULL: "This room is full.",
  WRONG_PHASE: "That can't be done right now.",
  NO_BALLS_LEFT: "There are no balls left to call for this pattern.",
  BAD_REQUEST: "Invalid request.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
} as const;

// ------------------------------------------------------------------ admin
// The /admin page talks plain HTTP (/api/admin/*) with a bearer token.

export interface AdminSettings {
  /** Rooms with no activity for this many minutes are closed automatically. */
  roomIdleMinutes: number;
  /** The big-screen look every new room starts with (a host device's own saved default wins). */
  displayDefaults: Partial<DisplaySettings>;
}

export const ADMIN_SETTINGS_LIMITS = {
  roomIdleMinutes: { min: 5, max: 7 * 24 * 60 },
} as const;

export interface AdminRoomSummary {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  phase: Phase;
  gameNumber: number;
  cardMode: CardMode;
  calls: number;
  hostConnected: boolean;
  players: number;
  playersConnected: number;
  viewers: number;
  tables: number;
  display: DisplaySettings;
}

export interface AdminOverview {
  rooms: AdminRoomSummary[];
  settings: AdminSettings;
  serverTime: number;
}
