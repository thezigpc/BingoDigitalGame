import {
  displayOf,
  sanitizeDisplay,
  CUSTOM_PATTERN_ID,
  DEFAULT_PATTERN_ID,
  DEFAULT_SETTINGS,
  FREE_INDEX,
  SETTINGS_LIMITS,
  findPattern,
  generateCardCells,
  sanitizeCustomMask,
  shuffledBalls,
  winningVariant,
  usedColumns,
  columnOf,
  type AdminRoomSummary,
  type ClaimView,
  type Mask,
  type PatternDef,
  type Phase,
  type Role,
  type RoomSettings,
  type RoomView,
} from "@bingo/shared";
import {
  cryptoRand,
  log,
  newId,
  newSerial,
  newToken,
  type CloseCause,
  type KitRoom,
  type PendingClaim,
  type RoomOverview,
  type SessionKind,
} from "@bargames/gamekit/server";
import { bg } from "../bargames.js";
import { MAX_PLAYERS_PER_ROOM, MAX_TABLES_PER_ROOM } from "../config.js";
import { GameError } from "./errors.js";

interface Card {
  id: string;
  cells: number[];
  daubs: Set<number>;
}

export interface Member {
  id: string;
  token: string;
  role: Role;
  name: string;
  socketIds: Set<string>;
  cards: Card[];
  lastFalseClaimAt: number;
  /** Tables only: may run the game. The host always can. */
  canControl: boolean;
}


/** How the room talks to sockets - injected so Room has no socket.io dependency. */
export interface RoomTransport {
  sendState(socketId: string, view: RoomView): void;
  sendClosed(socketId: string, reason: string): void;
}

const FALSE_CLAIM_COOLDOWN_MS = 3000;
const MAX_CLAIMS_KEPT = 30;

export class Room implements KitRoom {
  readonly members = new Map<string, Member>();
  hostId = "";
  phase: Phase = "lobby";
  gameNumber = 1;
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  patternId = DEFAULT_PATTERN_ID;
  customMask: Mask = [];
  called: number[] = [];
  private drawOrder: number[] = [];
  paused = false;
  nextCallAt: number | null = null;
  private autoTimer: NodeJS.Timeout | null = null;
  claims: ClaimView[] = [];
  /** When each claim was made (Bar Games status). Kept off ClaimView so the views don't change. */
  private readonly claimAt = new WeakMap<ClaimView, number>();
  lastActivityAt = Date.now();
  readonly createdAt = Date.now();
  closed = false;
  /** Secret in the host's "Open Table display" link: a table joining with it gets control. */
  readonly tableKey = newToken();
  /**
   * Bar Games session kind: "patron" for rooms a host phone creates, "venue"
   * for the box's create_room. Used in events and status, and venue rooms
   * aren't idle-closed while a TV shows them.
   */
  kind: SessionKind;
  /** Optional title from the box's create_room (status only). */
  title?: string;
  /**
   * Bar Games "first joiner hosts" (SDK 0.7.0): the box put this room on a TV with nobody
   * hosting yet, so the first phone to join takes the host seat. Cleared once taken.
   */
  hostOpen = false;

  /** Set by the room registry: closes just this room if one of its timers throws. */
  onFatalError: (err: unknown) => void = () => {};
  /** Set by the room registry: a debounced Bar Games players_changed (joins, leaves, kicks). */
  onPlayersChanged: () => void = () => {};

  constructor(
    readonly code: string,
    private readonly transport: RoomTransport,
    kind: SessionKind = "patron",
  ) {
    this.kind = kind;
  }

  // ------------------------------------------------------------- members

  addHost(name: string): Member {
    const m = this.newMember("host", name || "Host");
    this.hostId = m.id;
    return m;
  }

  /**
   * The first phone to join a "first joiner hosts" room becomes its host: the same seat and
   * powers as a phone host who created the room, under the name they typed.
   */
  claimHostSeat(rawName: string | undefined): Member {
    const host = this.members.get(this.hostId);
    if (!this.hostOpen || !host) throw new GameError("BAD_REQUEST");
    this.hostOpen = false;
    host.name = (rawName ?? "").trim().slice(0, 24) || "Host";
    return host;
  }

  addMember(role: "player" | "table", rawName: string | undefined, tableKey?: string): Member {
    if (role === "table") {
      const tables = [...this.members.values()].filter((m) => m.role === "table").length;
      if (tables >= MAX_TABLES_PER_ROOM) throw new GameError("ROOM_FULL");
      const t = this.newMember("table", "Table");
      t.canControl = typeof tableKey === "string" && tableKey === this.tableKey;
      return t;
    }
    if (this.settings.cardMode === "paper") {
      // Paper cards: nobody registers. A joining phone just watches the board.
      if (this.viewers().length >= MAX_PLAYERS_PER_ROOM) throw new GameError("ROOM_FULL");
      return this.newMember("viewer", "");
    }
    const name = (rawName ?? "").trim().slice(0, 24);
    if (!name) throw new GameError("NAME_REQUIRED");
    const players = this.players();
    if (players.length >= MAX_PLAYERS_PER_ROOM) throw new GameError("ROOM_FULL");
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError("NAME_TAKEN");
    const m = this.newMember("player", name);
    this.dealCards(m);
    this.playersChanged();
    return m;
  }

  private newMember(role: Role, name: string): Member {
    const m: Member = {
      id: newId(),
      token: newToken(),
      role,
      name,
      socketIds: new Set(),
      cards: [],
      lastFalseClaimAt: 0,
      canControl: false,
    };
    this.members.set(m.id, m);
    return m;
  }

  findByToken(token: string): Member | undefined {
    for (const m of this.members.values()) if (m.token === token) return m;
    return undefined;
  }

  attachSocket(member: Member, socketId: string): void {
    member.socketIds.add(socketId);
  }

  detachSocket(memberId: string, socketId: string): void {
    this.members.get(memberId)?.socketIds.delete(socketId);
  }

  // ---------------------------------------------- the game kit's KitRoom

  /** Seated players only (not tables or paper-mode viewers). */
  playerCount(): number {
    return this.players().length;
  }

  /** Table (TV) clients connected right now. A venue room isn't idle-closed while > 0. */
  tableCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.role === "table" && m.socketIds.size > 0) n++;
    return n;
  }

  round(): number {
    return this.gameNumber;
  }

  hostConnected(): boolean {
    return (this.members.get(this.hostId)?.socketIds.size ?? 0) > 0;
  }

  hostName(): string | undefined {
    return this.members.get(this.hostId)?.name;
  }

  maxPlayers(): number {
    return MAX_PLAYERS_PER_ROOM;
  }

  /** Status title and the claims waiting for a decision, for the Bar Games box. */
  overviewExtra(): Partial<RoomOverview> {
    const pattern = this.pattern().name;
    const pendingClaims: PendingClaim[] = this.waitingClaims().map(({ claim, at }) => ({
      id: claim.id,
      player: claim.playerName,
      detail: `${pattern} on card ${claim.cardId}, after ${claim.callCount} calls`,
      at: new Date(at).toISOString(),
    }));
    return {
      title: `${this.title ? `${this.title} · ` : ""}Game ${this.gameNumber}: ${pattern}`,
      pendingClaims,
    };
  }

  removeMember(memberId: string, reason: string): void {
    const m = this.members.get(memberId);
    if (!m) return;
    for (const sid of m.socketIds) this.transport.sendClosed(sid, reason);
    this.members.delete(memberId);
    if (m.role === "player") this.playersChanged();
  }

  /** Bar Games players_changed: the registry debounces it (never for reconnects). */
  private playersChanged(): void {
    if (!this.closed) this.onPlayersChanged();
  }

  private emit(type: "round_started" | "round_ended" | "claim_pending" | "winner", data: Record<string, unknown>): void {
    bg.emit({ type, roomCode: this.code, sessionKind: this.kind, data });
  }

  players(): Member[] {
    return [...this.members.values()].filter((m) => m.role === "player");
  }

  viewers(): Member[] {
    return [...this.members.values()].filter((m) => m.role === "viewer");
  }

  /** Host, or a Table display the host trusts. */
  requireCaller(memberId: string): void {
    if (memberId === this.hostId) return;
    const m = this.members.get(memberId);
    if (!m || m.role !== "table" || !m.canControl) throw new GameError("NOT_HOST");
  }

  setTableControl(memberId: string, canControl: boolean): void {
    const m = this.members.get(memberId);
    if (!m || m.role !== "table") throw new GameError("BAD_REQUEST");
    m.canControl = canControl;
  }

  requireHost(memberId: string): void {
    if (memberId !== this.hostId) throw new GameError("NOT_HOST");
  }

  requirePlayer(memberId: string): Member {
    const m = this.members.get(memberId);
    if (!m || m.role !== "player") throw new GameError("NOT_PLAYER");
    return m;
  }

  // --------------------------------------------------------------- cards

  private dealCards(m: Member): void {
    m.cards = Array.from({ length: this.settings.cardsPerPlayer }, () => ({
      id: newSerial(),
      cells: generateCardCells(cryptoRand),
      daubs: new Set<number>(),
    }));
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<RoomSettings>): void {
    const next = { ...this.settings };
    if (patch.cardMode !== undefined) {
      if (patch.cardMode !== "digital" && patch.cardMode !== "paper") throw new GameError("BAD_REQUEST");
      if (this.phase !== "lobby") throw new GameError("WRONG_PHASE");
      next.cardMode = patch.cardMode;
    }
    if (patch.daubMode !== undefined) {
      if (patch.daubMode !== "manual" && patch.daubMode !== "auto") throw new GameError("BAD_REQUEST");
      if (this.phase !== "lobby") throw new GameError("WRONG_PHASE");
      next.daubMode = patch.daubMode;
    }
    if (patch.cardsPerPlayer !== undefined) {
      const { min, max } = SETTINGS_LIMITS.cardsPerPlayer;
      if (!Number.isInteger(patch.cardsPerPlayer) || patch.cardsPerPlayer < min || patch.cardsPerPlayer > max) {
        throw new GameError("BAD_REQUEST");
      }
      if (this.phase !== "lobby") throw new GameError("WRONG_PHASE");
      next.cardsPerPlayer = patch.cardsPerPlayer;
    }
    if (patch.autoCallSeconds !== undefined) {
      const { min, max } = SETTINGS_LIMITS.autoCallSeconds;
      if (typeof patch.autoCallSeconds !== "number" || patch.autoCallSeconds < min || patch.autoCallSeconds > max) {
        throw new GameError("BAD_REQUEST");
      }
      next.autoCallSeconds = Math.round(patch.autoCallSeconds);
    }
    if (patch.autoCall !== undefined) next.autoCall = Boolean(patch.autoCall);
    if (patch.skipUnused !== undefined) next.skipUnused = Boolean(patch.skipUnused);

    const redeal = next.cardsPerPlayer !== this.settings.cardsPerPlayer;
    const toPaper = next.cardMode === "paper" && this.settings.cardMode !== "paper";
    this.settings = next;
    if (toPaper) {
      // Switching to paper cards: anyone already seated with digital cards
      // becomes a nameless viewer. (Going back to digital leaves viewers as
      // viewers; they can rejoin with a name to get cards.)
      for (const p of this.players()) {
        p.role = "viewer";
        p.name = "";
        p.cards = [];
      }
      this.claims = [];
      this.playersChanged();
    }
    if (redeal) for (const p of this.players()) this.dealCards(p);
    this.rescheduleAutoCall();
  }

  setDisplay(patch: unknown): void {
    const clean = sanitizeDisplay(patch);
    if (!clean) throw new GameError("BAD_REQUEST");
    this.settings = { ...this.settings, ...clean };
  }

  setPattern(patternId: string, customMask?: Mask): void {
    if (patternId === CUSTOM_PATTERN_ID) {
      const mask = sanitizeCustomMask(customMask);
      if (!mask) throw new GameError("BAD_REQUEST");
      this.customMask = mask;
    } else if (!findPattern(patternId)) {
      throw new GameError("BAD_REQUEST");
    }
    // Allowed mid-game on purpose: multi-part games switch patterns as they go.
    this.patternId = patternId;
    // With skipUnused, the new pattern can bring balls back into play (or
    // leave none): start or stop auto-calling to match, without restarting
    // a countdown that's already running.
    if (this.phase === "playing" && (!this.autoTimer || this.callableIndex() < 0)) this.rescheduleAutoCall();
  }

  /** Index in drawOrder of the next ball to call, or -1 if none is left. */
  private callableIndex(): number {
    if (!this.settings.skipUnused) return this.drawOrder.length ? 0 : -1;
    const used = usedColumns(this.pattern());
    return this.drawOrder.findIndex((b) => used[columnOf(b)]);
  }

  /** How many balls can still be called. */
  ballsLeft(): number {
    if (!this.settings.skipUnused) return this.drawOrder.length;
    const used = usedColumns(this.pattern());
    return this.drawOrder.filter((b) => used[columnOf(b)]).length;
  }

  pattern(): PatternDef {
    if (this.patternId === CUSTOM_PATTERN_ID) {
      return { id: CUSTOM_PATTERN_ID, name: "Custom Pattern", variants: [this.customMask] };
    }
    return findPattern(this.patternId) ?? findPattern(DEFAULT_PATTERN_ID)!;
  }

  // ---------------------------------------------------------------- game

  startGame(): void {
    if (this.phase !== "lobby") throw new GameError("WRONG_PHASE");
    this.phase = "playing";
    this.drawOrder = shuffledBalls(cryptoRand);
    this.called = [];
    this.claims = [];
    this.paused = false;
    log.info("game", "started", {
      code: this.code,
      game: this.gameNumber,
      players: this.players().length,
      viewers: this.viewers().length,
      cards: this.settings.cardMode,
      pattern: this.patternId,
      daub: this.settings.daubMode,
      auto: this.settings.autoCall,
    });
    this.emit("round_started", { round: this.gameNumber, pattern: this.pattern().name, cardMode: this.settings.cardMode });
    this.rescheduleAutoCall();
  }

  callNext(): number {
    if (this.phase !== "playing") throw new GameError("WRONG_PHASE");
    // Skipped balls stay in drawOrder, so switching to a pattern that uses
    // their column brings them back.
    const i = this.callableIndex();
    if (i < 0) throw new GameError("NO_BALLS_LEFT");
    const [ball] = this.drawOrder.splice(i, 1);
    this.called.push(ball);
    this.rescheduleAutoCall();
    return ball;
  }

  setPaused(paused: boolean): void {
    if (this.phase !== "playing") throw new GameError("WRONG_PHASE");
    this.paused = paused;
    this.rescheduleAutoCall();
  }

  /**
   * Ends the current game: back to the lobby with fresh cards. startNext
   * goes straight into the next game ("New game") instead of stopping in the
   * lobby to change the pattern/settings ("End game").
   */
  newGame(startNext = false): void {
    this.endGame();
    if (startNext) this.startGame();
  }

  private endGame(): void {
    if (this.phase !== "playing") throw new GameError("WRONG_PHASE");
    const winners = this.claims.filter((c) => c.status === "confirmed").map((c) => c.playerName);
    log.info("game", "ended", {
      code: this.code,
      game: this.gameNumber,
      calls: this.called.length,
      winners: winners.join(","),
    });
    this.emit("round_ended", { round: this.gameNumber, calls: this.called.length, winners });
    this.clearAutoTimer();
    this.phase = "lobby";
    this.gameNumber += 1;
    this.called = [];
    this.drawOrder = [];
    this.claims = [];
    this.paused = false;
    for (const p of this.players()) this.dealCards(p);
  }

  daub(memberId: string, cardId: string, index: number): void {
    const m = this.requirePlayer(memberId);
    if (this.phase !== "playing" || this.settings.daubMode !== "manual") throw new GameError("WRONG_PHASE");
    const card = m.cards.find((c) => c.id === cardId);
    if (!card || !Number.isInteger(index) || index < 0 || index >= 25 || index === FREE_INDEX) {
      throw new GameError("BAD_REQUEST");
    }
    if (card.daubs.has(index)) {
      card.daubs.delete(index);
    } else {
      // Reject daubs on uncalled numbers. The client never sends them,
      // so this only catches a tampered client.
      if (!this.called.includes(card.cells[index])) throw new GameError("BAD_REQUEST");
      card.daubs.add(index);
    }
  }

  /** Checks every card the player holds against the called balls. */
  claimBingo(memberId: string): { valid: boolean; cardId: string | null } {
    const m = this.requirePlayer(memberId);
    if (this.phase !== "playing") throw new GameError("WRONG_PHASE");
    const now = Date.now();
    if (now - m.lastFalseClaimAt < FALSE_CLAIM_COOLDOWN_MS) throw new GameError("RATE_LIMITED");

    const called = new Set(this.called);
    const pattern = this.pattern();
    for (const card of m.cards) {
      const v = winningVariant(card.cells, pattern, called);
      if (v < 0) continue;
      const existing = this.claims.find((c) => c.cardId === card.id && c.status !== "dismissed");
      if (existing) return { valid: true, cardId: card.id };
      this.addClaim({
        id: newId(),
        playerId: m.id,
        playerName: m.name,
        cardId: card.id,
        cells: card.cells,
        winningMask: pattern.variants[v],
        status: "pending",
        callCount: this.called.length,
      });
      // Hold the game so the host can verify before another ball drops.
      this.paused = true;
      this.rescheduleAutoCall();
      log.info("game", "valid claim", { code: this.code, player: m.name, card: card.id, calls: this.called.length });
      this.emit("claim_pending", { name: m.name });
      return { valid: true, cardId: card.id };
    }

    m.lastFalseClaimAt = now;
    this.addClaim({
      id: newId(),
      playerId: m.id,
      playerName: m.name,
      cardId: null,
      cells: null,
      winningMask: null,
      status: "invalid",
      callCount: this.called.length,
    });
    log.info("game", "false claim", { code: this.code, player: m.name, calls: this.called.length });
    return { valid: false, cardId: null };
  }

  /** `reason`: a Bar Games box's reject_claim message for the player (the host's buttons send none). */
  resolveClaim(claimId: string, confirm: boolean, reason?: string): void {
    const claim = this.claims.find((c) => c.id === claimId);
    if (!claim || claim.status !== "pending") throw new GameError("BAD_REQUEST");
    claim.status = confirm ? "confirmed" : "dismissed";
    if (!confirm && reason?.trim()) claim.reason = reason.trim().slice(0, 140);
    if (confirm) {
      this.emit("winner", { name: claim.playerName, round: this.gameNumber, calls: this.called.length, pattern: this.pattern().name });
    }
    log.info("game", confirm ? "winner confirmed" : "claim dismissed", {
      code: this.code,
      player: claim.playerName,
      card: claim.cardId,
    });
  }

  /** Valid claims waiting for the host, oldest first, with when each was made. */
  waitingClaims(): { claim: ClaimView; at: number }[] {
    return this.claims
      .filter((c) => c.status === "pending")
      .map((claim) => ({ claim, at: this.claimAt.get(claim) ?? this.createdAt }));
  }

  private addClaim(claim: ClaimView): void {
    this.claimAt.set(claim, Date.now());
    this.claims.push(claim);
    if (this.claims.length > MAX_CLAIMS_KEPT) this.claims.splice(0, this.claims.length - MAX_CLAIMS_KEPT);
  }

  // ---------------------------------------------------------- auto-call

  private clearAutoTimer(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.nextCallAt = null;
  }

  private rescheduleAutoCall(): void {
    this.clearAutoTimer();
    if (this.closed || this.phase !== "playing" || !this.settings.autoCall || this.paused) return;
    if (this.callableIndex() < 0) return;
    const ms = this.settings.autoCallSeconds * 1000;
    this.nextCallAt = Date.now() + ms;
    this.autoTimer = this.safeTimeout("autoCall", ms, () => {
      this.autoTimer = null;
      this.callNext();
      this.broadcast();
    });
  }

  /** Every room timer goes through here: a throw closes this room only. */
  private safeTimeout(label: string, ms: number, fn: () => void): NodeJS.Timeout {
    return setTimeout(() => {
      try {
        fn();
      } catch (err) {
        log.error("room", "timer threw", { code: this.code, timer: label, err: String(err) });
        this.onFatalError(err);
      }
    }, ms);
  }

  // --------------------------------------------------------------- views

  broadcast(): void {
    this.lastActivityAt = Date.now();
    for (const m of this.members.values()) {
      if (m.socketIds.size === 0) continue;
      const view = this.viewFor(m);
      for (const sid of m.socketIds) this.transport.sendState(sid, view);
    }
  }

  sendStateTo(member: Member, socketId: string): void {
    this.transport.sendState(socketId, this.viewFor(member));
  }

  viewFor(m: Member): RoomView {
    const pattern = this.pattern();
    const calledSet = new Set(this.called);
    const auto = this.settings.daubMode === "auto";
    const isHost = m.id === this.hostId;
    return {
      code: this.code,
      you: { id: m.id, role: m.role, name: m.name, canControl: isHost || m.canControl },
      phase: this.phase,
      gameNumber: this.gameNumber,
      settings: { ...this.settings },
      pattern: { id: pattern.id, name: pattern.name, variants: pattern.variants },
      called: this.called.slice(),
      ballsLeft: this.phase === "playing" ? this.ballsLeft() : 0,
      paused: this.paused,
      nextCallAt: this.nextCallAt,
      serverTime: Date.now(),
      players: this.players().map((p) => ({ id: p.id, name: p.name, connected: p.socketIds.size > 0 })),
      tableCount: [...this.members.values()].filter((x) => x.role === "table").length,
      tables: isHost
        ? [...this.members.values()]
            .filter((x) => x.role === "table")
            .map((t) => ({ id: t.id, connected: t.socketIds.size > 0, canControl: t.canControl }))
        : [],
      tableKey: isHost ? this.tableKey : null,
      viewerCount: this.viewers().length,
      claims: this.claims.map((c) => ({ ...c })),
      myCards:
        m.role === "player"
          ? m.cards.map((c) => ({
              id: c.id,
              cells: c.cells,
              daubs: auto
                ? c.cells.flatMap((n, i) => (i !== FREE_INDEX && calledSet.has(n) ? [i] : []))
                : [...c.daubs],
            }))
          : [],
    };
  }

  /** What the /admin room list shows. */
  summary(): AdminRoomSummary {
    const host = this.members.get(this.hostId);
    const players = this.players();
    return {
      code: this.code,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      phase: this.phase,
      gameNumber: this.gameNumber,
      cardMode: this.settings.cardMode,
      calls: this.called.length,
      hostConnected: (host?.socketIds.size ?? 0) > 0,
      players: players.length,
      playersConnected: players.filter((p) => p.socketIds.size > 0).length,
      viewers: this.viewers().length,
      tables: [...this.members.values()].filter((m) => m.role === "table").length,
      display: displayOf(this.settings),
    };
  }

  close(reason: string, _cause?: CloseCause): void {
    if (this.closed) return;
    this.closed = true;
    this.clearAutoTimer();
    for (const m of this.members.values()) for (const sid of m.socketIds) this.transport.sendClosed(sid, reason);
  }
}
