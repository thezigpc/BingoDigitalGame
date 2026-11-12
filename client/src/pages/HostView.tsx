import { basePath } from "@bargames/gamekit/client";
import { useEffect, useState } from "react";
import {
  CUSTOM_PATTERN_ID,
  MAX_BALL,
  PATTERNS,
  SETTINGS_LIMITS,
  type ClaimView,
  type Mask,
  type RoomView,
} from "@bingo/shared";
import {
  BallBoard,
  skippedRows,
  CardGrid,
  Countdown,
  PatternCard,
  PatternEditor,
  QrCode,
  RecentBalls,
  joinUrl,
} from "../components/bits";
import type { Act } from "./RoomPage";
import { RoomDisplayPicker } from "../components/DisplayPicker";
import { TvsPanel } from "../components/TvsPanel";
import { useVenue } from "../useVenue";

interface Props {
  view: RoomView;
  skew: number;
  act: Act;
  /** Switch this device to the full-screen board (iPad/laptop cast to a TV). */
  onShowBoard: () => void;
}

export function HostView({ view, skew, act, onShowBoard }: Props) {
  const playing = view.phase === "playing";
  const pending = view.claims.filter((c) => c.status === "pending");
  const falseClaims = view.claims
    .filter((c) => c.status === "invalid")
    .slice(-3)
    .reverse();
  const winners = view.claims.filter((c) => c.status === "confirmed");
  const ballsLeft = view.ballsLeft;
  const paper = view.settings.cardMode === "paper";

  return (
    <main className="host">
      {pending.map((c) => (
        <ClaimPanel key={c.id} claim={c} called={view.called} act={act} />
      ))}

      {playing ? (
        <section className="panel caller">
          <RecentBalls called={view.called} size="xl" />
          <div className="caller-meta">
            <span>
              {view.called.length} called · {ballsLeft} left
            </span>
            {view.settings.autoCall && !view.paused && <Countdown at={view.nextCallAt} skew={skew} />}
            {view.paused && <span className="tag">Paused</span>}
          </div>
          <button className="btn btn-primary btn-huge" disabled={ballsLeft === 0} onClick={() => act("callNext")}>
            {ballsLeft > 0
              ? "Call next ball"
              : view.called.length < MAX_BALL
                ? "No balls left for this pattern"
                : "All balls called"}
          </button>
          <div className="row">
            <label className="switch">
              <input
                type="checkbox"
                checked={view.settings.autoCall}
                onChange={(e) => act("updateSettings", { autoCall: e.target.checked })}
              />
              Auto-call
            </label>
            <SecondsInput view={view} act={act} />
            <SkipUnusedSwitch view={view} act={act} />
            {view.settings.autoCall && (
              <button className="btn btn-ghost" onClick={() => act("setPaused", !view.paused)}>
                {view.paused ? "Resume" : "Pause"}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2>Game {view.gameNumber}</h2>
          <p className="muted">
            {paper
              ? "Paper cards: everyone plays on their own card. Phones that join just follow the numbers."
              : view.players.length === 0
                ? "Waiting for players to join. Share the room code below."
                : `${view.players.length} player${view.players.length === 1 ? "" : "s"} ready.`}
          </p>
          <button className="btn btn-primary btn-huge" onClick={() => act("startGame")}>
            Start game {view.gameNumber}
          </button>
          <button className="btn btn-secondary btn-big board-here" onClick={onShowBoard}>
            📺 Show the board on this screen
          </button>
          <p className="muted small">
            For an iPad or laptop that's casting to a TV. The board has its own draw button.
          </p>
        </section>
      )}

      <GamePanel view={view} act={act} />

      {winners.length > 0 && (
        <section className="panel winners">
          <h2>Winners</h2>
          <ul>
            {winners.map((w) => (
              <li key={w.id}>
                🏆 <strong>{w.playerName}</strong>{" "}
                <span className="muted">
                  card {w.cardId} · on call {w.callCount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {falseClaims.length > 0 && (
        <section className="panel notices">
          {falseClaims.map((c) => (
            <p key={c.id} className="muted">
              ✗ {c.playerName} called bingo on call {c.callCount}, but no card matches yet.
            </p>
          ))}
        </section>
      )}

      <PatternPanel view={view} act={act} />

      {playing && (
        <section className="panel">
          <h2>Board</h2>
          <BallBoard called={view.called} compact skip={skippedRows(view)} />
        </section>
      )}

      <SettingsPanel view={view} act={act} />
      <PlayersPanel view={view} act={act} />
      <TvsPanel code={view.code} />
      <TablesPanel view={view} act={act} onShowBoard={onShowBoard} />
      <InvitePanel code={view.code} />
    </main>
  );
}

function ClaimPanel({ claim, called, act }: { claim: ClaimView; called: number[]; act: Act }) {
  const calledSet = new Set(called);
  const marked = new Set((claim.cells ?? []).flatMap((n, i) => (calledSet.has(n) ? [i] : [])));
  return (
    <section className="panel claim" aria-live="assertive">
      <h2>🎉 {claim.playerName} has BINGO!</h2>
      <p className="muted">
        Card {claim.cardId} · checked by the server on call {claim.callCount}. The game is paused.
      </p>
      {claim.cells && <CardGrid cells={claim.cells} marked={marked} highlight={new Set(claim.winningMask ?? [])} />}
      <div className="row">
        <button className="btn btn-primary" onClick={() => act("resolveClaim", { claimId: claim.id, confirm: true })}>
          Confirm winner
        </button>
        <button className="btn btn-ghost" onClick={() => act("resolveClaim", { claimId: claim.id, confirm: false })}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

function SkipUnusedSwitch({ view, act }: { view: RoomView; act: Act }) {
  return (
    <label
      className="switch"
      title="Only call numbers from the B-I-N-G-O columns the pattern uses. Four Corners, for example, only calls B and O."
    >
      <input
        type="checkbox"
        checked={view.settings.skipUnused}
        onChange={(e) => act("updateSettings", { skipUnused: e.target.checked })}
      />
      Skip unused numbers
    </label>
  );
}

function SecondsInput({ view, act }: { view: RoomView; act: Act }) {
  const { min, max } = SETTINGS_LIMITS.autoCallSeconds;
  return (
    <label className="inline">
      every
      <select
        value={view.settings.autoCallSeconds}
        onChange={(e) => act("updateSettings", { autoCallSeconds: Number(e.target.value) })}
      >
        {[3, 5, 8, 10, 15, 20, 30, 45, 60]
          .filter((s) => s >= min && s <= max)
          .map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
      </select>
    </label>
  );
}

function PatternPanel({ view, act }: { view: RoomView; act: Act }) {
  const isCustom = view.pattern.id === CUSTOM_PATTERN_ID;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Mask>(isCustom ? view.pattern.variants[0] : []);
  useEffect(() => {
    if (isCustom) setDraft(view.pattern.variants[0]);
  }, [isCustom, view.pattern.variants]);

  const choose = (id: string) => {
    if (id === CUSTOM_PATTERN_ID) {
      setEditing(true);
      return;
    }
    setEditing(false);
    act("setPattern", { patternId: id });
  };

  return (
    <section className="panel pattern-panel">
      <h2>Pattern</h2>
      <div className="pattern-row">
        <PatternCard pattern={view.pattern} size="md" showName={false} />
        <div className="grow">
          <select value={editing ? CUSTOM_PATTERN_ID : view.pattern.id} onChange={(e) => choose(e.target.value)}>
            {PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={CUSTOM_PATTERN_ID}>Custom… (draw your own)</option>
          </select>
          {view.pattern.variants.length > 1 && (
            <p className="muted small">
              Any of {view.pattern.variants.length} ways wins. The preview cycles through them.
            </p>
          )}
          {view.phase === "playing" && (
            <p className="muted small">Changing it mid-game is allowed, for multi-part games.</p>
          )}
        </div>
      </div>
      {editing && (
        <div className="editor-wrap">
          <p className="muted small">Tap squares to draw the pattern.</p>
          <PatternEditor mask={draft} onChange={setDraft} />
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={draft.filter((i) => i !== 12).length === 0}
              onClick={async () => {
                if (await act("setPattern", { patternId: CUSTOM_PATTERN_ID, customMask: draft })) setEditing(false);
              }}
            >
              Use this pattern
            </button>
            <button className="btn btn-ghost" onClick={() => setDraft([])}>
              Clear
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsPanel({ view, act }: { view: RoomView; act: Act }) {
  const locked = view.phase !== "lobby";
  const { min, max } = SETTINGS_LIMITS.cardsPerPlayer;
  return (
    <section className="panel">
      <h2>Settings</h2>
      {locked && <p className="muted small">These can be changed between games.</p>}
      <div className="setting">
        <span>Cards</span>
        <div className="segmented" role="radiogroup">
          {(["digital", "paper"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={view.settings.cardMode === m}
              className={view.settings.cardMode === m ? "on" : ""}
              disabled={locked}
              onClick={() => act("updateSettings", { cardMode: m })}
            >
              {m === "digital" ? "On phones" : "Paper cards"}
            </button>
          ))}
        </div>
      </div>
      {view.settings.cardMode === "paper" ? (
        <p className="muted small">
          Players use their own cards. Anyone who joins gets a screen that follows the numbers. No names, no phone
          cards, and you check wins yourself.
        </p>
      ) : (
        <>
          <div className="setting">
            <span>Marking numbers</span>
            <div className="segmented" role="radiogroup">
              {(["manual", "auto"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={view.settings.daubMode === m}
                  className={view.settings.daubMode === m ? "on" : ""}
                  disabled={locked}
                  onClick={() => act("updateSettings", { daubMode: m })}
                >
                  {m === "manual" ? "Players tap" : "Automatic"}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>Cards per player</span>
            <div className="segmented">
              {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
                <button
                  key={n}
                  className={view.settings.cardsPerPlayer === n ? "on" : ""}
                  disabled={locked}
                  onClick={() => act("updateSettings", { cardsPerPlayer: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {!locked && (
        <div className="setting">
          <label className="switch">
            <input
              type="checkbox"
              checked={view.settings.autoCall}
              onChange={(e) => act("updateSettings", { autoCall: e.target.checked })}
            />
            Auto-call balls
          </label>
          <SecondsInput view={view} act={act} />
        </div>
      )}
      {!locked && (
        <div className="setting">
          <SkipUnusedSwitch view={view} act={act} />
        </div>
      )}
    </section>
  );
}

function PlayersPanel({ view, act }: { view: RoomView; act: Act }) {
  if (view.settings.cardMode === "paper") {
    return (
      <section className="panel">
        <h2>Watching</h2>
        <p className="muted">
          📱 {view.viewerCount} phone{view.viewerCount === 1 ? "" : "s"} following the numbers
        </p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>
        Players <span className="muted">({view.players.length})</span>
      </h2>
      {view.players.length === 0 ? (
        <p className="muted">Nobody yet.</p>
      ) : (
        <ul className="players">
          {view.players.map((p) => (
            <li key={p.id}>
              <span className={`dot ${p.connected ? "on" : ""}`} title={p.connected ? "Connected" : "Disconnected"} />
              <span className="grow">{p.name}</span>
              <button
                className="btn btn-small btn-ghost"
                onClick={() => window.confirm(`Remove ${p.name} from the room?`) && act("kickPlayer", p.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitePanel({ code }: { code: string }) {
  const url = joinUrl(code, useVenue());
  return (
    <section className="panel invite">
      <h2>Invite players</h2>
      <div className="invite-row">
        <QrCode text={url} size={140} />
        <div>
          <div className="big-code">{code}</div>
          <p className="muted small break">{url}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * The main screen. A Table opened from the link here can run the game (call
 * balls, start, pause, confirm wins). One opened by typing the room code is
 * display-only until the host flips its switch.
 */
function TablesPanel({ view, act, onShowBoard }: { view: RoomView; act: Act; onShowBoard: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${basePath()}/join/${view.code}?as=table&key=${encodeURIComponent(view.tableKey ?? "")}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", link);
    }
  };
  return (
    <section className="panel">
      <h2>Main screen (the board)</h2>
      <p className="muted small">
        Casting this device to the TV? Show the board right here. It has the Call next ball button. Using a separate
        screen? Open it from these buttons and it gets the draw button too. Keep that link private: anyone with it can
        call numbers.
      </p>
      <div className="row">
        <button className="btn btn-primary" onClick={onShowBoard}>
          📺 Show the board on this screen
        </button>
        <button className="btn btn-secondary" onClick={() => window.open(link, "_blank")}>
          Open it in a new tab
        </button>
        <button className="btn btn-ghost" onClick={copy}>
          {copied ? "Copied!" : "Copy link for another device"}
        </button>
      </div>
      {view.tables.length > 0 && (
        <ul className="players">
          {view.tables.map((t, i) => (
            <li key={t.id}>
              <span className={`dot ${t.connected ? "on" : ""}`} title={t.connected ? "Connected" : "Disconnected"} />
              <span className="grow">Screen {i + 1}</span>
              <label className="switch small">
                <input
                  type="checkbox"
                  checked={t.canControl}
                  onChange={(e) => act("setTableControl", { memberId: t.id, canControl: e.target.checked })}
                />
                Can call numbers
              </label>
              <button
                className="btn btn-small btn-ghost"
                onClick={() => window.confirm("Disconnect this screen?") && act("kickPlayer", t.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="subhead">Layout and animation</h3>
      <RoomDisplayPicker view={view} act={act} />
    </section>
  );
}

/** End game / New game / Close room. */
function GamePanel({ view, act }: { view: RoomView; act: Act }) {
  const n = view.gameNumber;
  return (
    <section className="panel game-panel">
      <div className="row">
        {view.phase === "playing" && (
          <>
            <button
              className="btn btn-secondary"
              onClick={() =>
                window.confirm(`End game ${n} and start game ${n + 1} now? Players get new cards.`) &&
                act("newGame", { startNext: true })
              }
            >
              New game
            </button>
            <button
              className="btn btn-ghost"
              onClick={() =>
                window.confirm(
                  `End game ${n}? You can change the pattern and settings before starting the next one.`,
                ) && act("newGame", { startNext: false })
              }
            >
              End game
            </button>
          </>
        )}
        <button
          className="btn btn-danger"
          onClick={() =>
            window.confirm(
              "Close this room? Everyone is sent back to the home page and the room code stops working.",
            ) && act("closeRoom")
          }
        >
          Close room
        </button>
      </div>
    </section>
  );
}
