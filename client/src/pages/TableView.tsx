import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MAX_BALL, SETTINGS_LIMITS, type RoomView } from "@bingo/shared";
import { PatternPicker } from "../components/PatternPicker";
import { toggleFullscreen } from "../fullscreen";
import { Ball, BallBoard, skippedRows, CardGrid, Countdown, PatternCard, QrCode, joinUrl, pickBall } from "../components/bits";
import { isOnBox } from "@bargames/sdk/client";
import { useGameName } from "../useGameName";
import { useVenue } from "../useVenue";
import { RoomDisplayPicker } from "../components/DisplayPicker";
import type { Act } from "./RoomPage";

/**
 * Keep a TV/tablet display awake while it's showing the board. Off when `off` is set: on a
 * box TV the SDK's tableMode already holds the wake lock.
 */
function useWakeLock(off: boolean) {
  useEffect(() => {
    if (off) return;
    type WL = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WL> } };
    let lock: WL | null = null;
    const acquire = () =>
      nav.wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    acquire();
    const onVis = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [off]);
}

interface Props {
  view: RoomView;
  skew: number;
  act: Act;
  /** A phone in a paper-card room: no join box, no controls, no names. */
  viewer?: boolean;
  /**
   * Set when the HOST is showing this board on their own device (an iPad or
   * laptop cast/mirrored to a TV): flips back to the settings screen.
   */
  onHostControls?: () => void;
}

/**
 * The shared board, sized to fill whatever screen it's on (container-query
 * units in index.css - nothing here scrolls). A Table the host trusts also
 * gets the game controls, plus keyboard / presentation-clicker shortcuts.
 */
export function TableView({ view, skew, act, viewer = false, onHostControls }: Props) {
  const gameName = useGameName();
  const venue = useVenue();
  const venueLogo = isOnBox(venue) ? venue.game.theme.logoUrl : undefined;
  const playing = view.phase === "playing";
  const control = view.you.canControl && !viewer;
  // A box's TV: a kiosk browser with the mouse hidden, already full screen.
  // Nobody can press anything there, so it shows no buttons at all.
  const boxTv = isOnBox(venue) && !control;
  // The room page runs tableMode (which keeps the screen awake) on a box TV Table.
  useWakeLock(boxTv && view.you.role === "table");
  const pending = view.claims.find((c) => c.status === "pending");
  const winners = view.claims.filter((c) => c.status === "confirmed");
  const latestWinner = winners[winners.length - 1];
  const ballsLeft = view.ballsLeft;
  const current = view.called[view.called.length - 1];
  const previous = view.called.slice(-6, -1).reverse();

  // A confirmed winner takes over the screen briefly, then gets out of the
  // way so the board is visible if play continues.
  const [shownWinner, setShownWinner] = useState<string | null>(null);
  useEffect(() => {
    if (!latestWinner) return;
    setShownWinner(latestWinner.id);
    const t = setTimeout(() => setShownWinner(null), 12_000);
    return () => clearTimeout(t);
  }, [latestWinner?.id]);
  const spotlight = pending ?? (latestWinner && latestWinner.id === shownWinner ? latestWinner : undefined);
  const calledSet = new Set(view.called);
  // Ball-machine mode: whoever runs the board taps each drawn number on it.
  const machine = view.settings.drawMode === "machine";
  const onPick = control && playing && machine ? pickBall(view.called, act) : undefined;

  // Space / Right arrow / PageDown (what presentation clickers send) calls
  // the next ball; P pauses auto-calling.
  useEffect(() => {
    if (!control) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (playing && !machine && [" ", "ArrowRight", "PageDown"].includes(e.key)) {
        e.preventDefault();
        if (ballsLeft > 0) act("callNext");
      } else if (playing && view.settings.autoCall && (e.key === "p" || e.key === "P")) {
        act("setPaused", !view.paused);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [control, playing, machine, ballsLeft, view.paused, view.settings.autoCall, act]);

  // New game: end this one and deal + start the next straight away.
  // End game: stop and go back to setup (to change the pattern etc.).
  const newGame = () =>
    window.confirm(`End game ${view.gameNumber} and start game ${view.gameNumber + 1} now? Players get new cards.`) &&
    act("newGame", { startNext: true });
  const endGame = () =>
    window.confirm(`End game ${view.gameNumber}? You can change the pattern before starting the next one.`) &&
    act("newGame", { startNext: false });
  // Host only (a trusted Table can run games but not end the whole session).
  const closeRoom = () =>
    window.confirm("Close this room? Everyone is sent back to the home page and the room code stops working.") &&
    act("closeRoom");

  const url = joinUrl(view.code, venue);
  // The address under the QR code: "play.example.net/bingo", without the scheme or /join/CODE.
  const joinAddress = url.replace(/^https?:\/\//, "").replace(/\/join\/.*/, "");
  const [showMenu, setShowMenu] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Pattern card: a size and a placement preset (normal, or swapped with the
  // ball / QR box). It always stays in the layout; when it's scaled, the
  // layout reflows around it (see .pattern-scaled in index.css). Phone
  // viewers keep the normal card.
  const tvRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const patternScale = viewer ? 1 : view.settings.patternScale;
  const showJoin = !viewer && view.settings.showJoin;
  const rawPlace = viewer ? "normal" : view.settings.patternPlace;
  // No QR box to swap with when it's hidden.
  const place = rawPlace === "join" && !showJoin ? "normal" : rawPlace;

  // Never draw the card bigger than its slot can take: if it would run into
  // the ball, info, QR box or board (or off the screen), the *shown* size
  // steps down before paint until it fits. The saved size doesn't change, so
  // a size picked on a big TV still works on a laptop. Re-measured from the
  // full size whenever anything that affects it changes.
  const [fit, setFit] = useState(Infinity);
  const [, setResized] = useState(0);
  const shown = Math.min(patternScale, fit);
  const fitKey = [
    patternScale,
    place,
    view.settings.layout,
    view.settings.align,
    view.settings.boardFit,
    showJoin,
    view.settings.showRecent,
    view.pattern.id,
    view.phase,
    viewer,
  ].join("|");
  useLayoutEffect(() => setFit(Infinity), [fitKey]);
  useEffect(() => {
    // A resize changes the layout without a React render, so force one to re-measure.
    const reset = () => {
      setFit(Infinity);
      setResized((n) => n + 1);
    };
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  useLayoutEffect(() => {
    const tvEl = tvRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!tvEl || !box || !box.width || shown <= SETTINGS_LIMITS.patternScale.min) return;
    const tv = tvEl.getBoundingClientRect();
    const inside = (r: DOMRect) =>
      r.left >= tv.left - 1 && r.top >= tv.top - 1 && r.right <= tv.right + 1 && r.bottom <= tv.bottom + 1;
    const hit = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const pieces = [".tv-pattern", ".tv-ball", ".tv-info", ".tv-join", ".tv-board .board"]
      .map((sel) => tvEl.querySelector(sel)?.getBoundingClientRect())
      .filter((r): r is DOMRect => Boolean(r && r.width));
    const buttons = [...tvEl.querySelectorAll(".tv-controls .btn, .tv-tool")].map((el) => el.getBoundingClientRect());
    // The pattern growing is what squeezes everything else, so any piece
    // colliding or pushed off the screen counts while it's enlarged; at or
    // below normal size only the pattern's own box does.
    const watched = shown > 1 ? [...pieces, ...buttons] : [box];
    let ok = watched.every(inside);
    for (let a = 0; a < pieces.length && ok; a++)
      for (let b = a + 1; b < pieces.length; b++)
        if ((shown > 1 || a === 0) && hit(pieces[a], pieces[b])) ok = false;
    if (!ok) setFit(Math.max(SETTINGS_LIMITS.patternScale.min, shown * 0.93));
  });
  const patternStyle: CSSProperties | undefined = shown !== 1 ? ({ zoom: shown } as CSSProperties) : undefined;
  const tvStyle =
    shown !== 1
      ? ({
          "--ps": shown,
          "--fr15": `${15 * shown}fr`,
          "--fr22": `${22 * shown}fr`,
          "--fr26": `${26 * shown}fr`,
          "--fr30": `${30 * shown}fr`,
        } as unknown as CSSProperties)
      : undefined;
  const tvClass = [
    "tv",
    `layout-${view.settings.layout}`,
    viewer ? "tv-viewer" : "",
    patternScale !== 1 ? "pattern-scaled" : "",
    place !== "normal" ? `place-${place}` : "",
    `align-${view.settings.align}`,
    // The device tapping numbers off a ball machine gets the biggest squares it can.
    `board-${onPick ? "fill" : view.settings.boardFit}`,
    showJoin ? "" : "no-join",
    view.settings.showRecent ? "" : "hide-recent",
  ]
    .filter(Boolean)
    .join(" ");
  // ⛶ is always offered (see fullscreen.ts). Phone viewers get it in the room header.

  return (
    <main ref={tvRef} className={tvClass} style={tvStyle}>
      <section className="tv-top">
        <div className="tv-ball">
          {playing && current ? (
            <Ball key={current} n={current} isNew />
          ) : (
            <div className="tv-ready">
              <span>Game</span>
              <strong>{view.gameNumber}</strong>
            </div>
          )}
        </div>

        <div className="tv-info">
          <div className="tv-title">
            {!viewer && venueLogo && <img className="tv-logo" src={venueLogo} alt="" />}
            {!viewer && <span>{gameName}</span>}
            <span className="muted">Game {view.gameNumber}</span>
            <span className="tv-tools">
              {onHostControls && (
                <button
                  className="btn btn-ghost tv-tool"
                  onClick={onHostControls}
                  aria-label="Host controls"
                  title="Host controls"
                >
                  ⚙
                </button>
              )}
              {!viewer && !boxTv && (
                <button
                  className="btn btn-ghost tv-tool"
                  onClick={toggleFullscreen}
                  aria-label="Full screen"
                  title="Full screen"
                >
                  ⛶
                </button>
              )}
              {control && (
                <button
                  className={`btn btn-ghost tv-tool ${showMenu ? "on" : ""}`}
                  onClick={() => setShowMenu((s) => !s)}
                  aria-expanded={showMenu}
                  aria-label="Menu"
                  title="Menu: layout, theme, full screen"
                >
                  ☰
                </button>
              )}
            </span>
          </div>
          <div className="tv-stats">
            {playing ? (
              <>
                <span>
                  <strong>{view.called.length}</strong> / {MAX_BALL} called
                </span>
                {view.paused ? <span className="tag">Paused</span> : <Countdown at={view.nextCallAt} skew={skew} />}
              </>
            ) : (
              <span>
                Get ready!
                {view.settings.cardMode === "digital" && ` ${view.players.length} playing.`}
              </span>
            )}
          </div>
          {playing && previous.length > 0 && (
            <div className="tv-recent" aria-label="Previous calls">
              {previous.map((n) => (
                <Ball key={n} n={n} size="sm" />
              ))}
            </div>
          )}
          {viewer && view.settings.cardMode === "digital" && (
            <p className="muted tv-note">
              The host switched this game to phone cards. To get a card, leave and join again with your name.
            </p>
          )}
          {control && (
            <div className="tv-controls">
              {playing ? (
                <>
                  {!machine && (
                  <button
                    className="btn btn-primary tv-call"
                    disabled={ballsLeft === 0}
                    onClick={() => act("callNext")}
                  >
                    {ballsLeft > 0 ? "Call next ball" : view.called.length < MAX_BALL ? "No balls left for this pattern" : "All balls called"}
                  </button>
                  )}
                  {view.settings.autoCall && !machine && (
                    <button className="btn btn-secondary" onClick={() => act("setPaused", !view.paused)}>
                      {view.paused ? "Resume" : "Pause"}
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={newGame}>
                    New game
                  </button>
                  <button className="btn btn-ghost" onClick={endGame}>
                    End game
                  </button>
                </>
              ) : (
                <button className="btn btn-primary tv-call" onClick={() => act("startGame")}>
                  Start game {view.gameNumber}
                </button>
              )}
            </div>
          )}
          {control && playing && (
            <span className="muted tv-hint">
              {machine ? "Tap each number on the board as it comes out of the machine" : "Space or → calls the next ball"}
            </span>
          )}
        </div>

        <div ref={boxRef} className="tv-pattern" style={patternStyle}>
          {control ? (
            <button
              className="tv-pattern-btn"
              onClick={() => setShowPicker(true)}
              aria-label={`Pattern: ${view.pattern.name}. Tap to change it.`}
              title="Tap to change the pattern"
            >
              <PatternCard pattern={view.pattern} size="tv" editable />
            </button>
          ) : (
            <PatternCard pattern={view.pattern} size="tv" />
          )}
          {winners.length > 0 && view.settings.cardMode === "digital" && (
            <div className="tv-winners">🏆 {winners.map((w) => w.playerName).join(", ")}</div>
          )}
        </div>

        {showJoin && (
          <div className={`tv-join${joinAddress.length <= 30 ? " join-wide" : ""}`}>
            <QrCode text={url} size={200} />
            <div className="tv-join-text">
              <span className="muted">Join at</span>
              <JoinAddress address={joinAddress} />
              <span className="big-code">{view.code}</span>
            </div>
          </div>
        )}
      </section>

      <section className="tv-board">
        <BallBoard called={view.called} skip={skippedRows(view)} onPick={onPick} />
      </section>

      {showPicker && control && <PatternPicker view={view} act={act} onClose={() => setShowPicker(false)} />}

      {showMenu && control && (
        <div className="tv-menu panel" role="dialog" aria-label="Board menu">
          <div className="admin-row">
            <h2>Board</h2>
            <button className="btn btn-small btn-primary" onClick={() => setShowMenu(false)}>
              Done
            </button>
          </div>
          <div className="row">
            <button className="btn btn-secondary btn-small" onClick={toggleFullscreen}>
              ⛶ Full screen
            </button>
            {onHostControls && (
              <button className="btn btn-danger btn-small" onClick={closeRoom}>
                Close room
              </button>
            )}
          </div>
          <h3 className="subhead">Layout and animation</h3>
          <RoomDisplayPicker view={view} act={act} compact />
        </div>
      )}

      {spotlight && (
        <div className={`table-overlay ${pending ? "checking" : "won"}`}>
          <div className="overlay-box">
            <h1>{pending ? "BINGO!" : "Winner!"}</h1>
            <h2>{spotlight.playerName}</h2>
            {spotlight.cells && (
              <CardGrid
                cells={spotlight.cells}
                marked={new Set(spotlight.cells.flatMap((n, i) => (calledSet.has(n) ? [i] : [])))}
                highlight={new Set(spotlight.winningMask ?? [])}
                serial={spotlight.cardId ?? undefined}
              />
            )}
            {pending && control ? (
              <div className="row center-row">
                <button
                  className="btn btn-primary"
                  onClick={() => act("resolveClaim", { claimId: pending.id, confirm: true })}
                >
                  Confirm winner
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => act("resolveClaim", { claimId: pending.id, confirm: false })}
                >
                  Dismiss
                </button>
              </div>
            ) : pending ? (
              <p className="muted">The host is checking the card…</p>
            ) : (
              <>
                <p className="muted">Won on call {spotlight.callCount}</p>
                {control && (
                  <div className="row center-row">
                    <button className="btn btn-primary" onClick={newGame}>
                      New game
                    </button>
                    <button className="btn btn-ghost" onClick={() => setShownWinner(null)}>
                      Keep playing
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * The join address under the QR code. It has no spaces ("play.example.net/bingo"),
 * so offer line breaks after each dot and slash, and shrink a long one; the CSS
 * breaks anywhere as a last resort, so the address always stays inside the box.
 */
function JoinAddress({ address }: { address: string }) {
  const parts = address.split(/(?<=[./])/);
  // Longer than "play.example.net/bingo": smaller text, so it takes fewer lines.
  const scale = Math.max(0.6, Math.min(1, 24 / address.length));
  return (
    <span className="muted join-address" style={scale < 1 ? { fontSize: `${scale}em` } : undefined}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {p}
        </Fragment>
      ))}
    </span>
  );
}
