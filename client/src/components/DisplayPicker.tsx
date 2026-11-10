import { useEffect, useState, type ReactNode } from "react";
import {
  BALL_ANIMATIONS,
  BOARD_LAYOUTS,
  PATTERN_PLACES,
  SETTINGS_LIMITS,
  THEMES,
  displayOf,
  type BoardLayout,
  type DisplaySettings,
  type RoomView,
} from "@bingo/shared";
import type { Act } from "../pages/RoomPage";
import { getDisplayDefault, setDisplayDefault } from "../session";

type R = [x: number, y: number, w: number, h: number];
/** Thumbnail boxes on a 16x9 screen: [board, ...info]. */
const SHAPES: Record<BoardLayout, { board: R; info: R[] }> = {
  easy: { board: [0, 4.2, 16, 4.8], info: [[0, 0, 16, 3.6]] },
  stacked: { board: [0, 0, 16, 4.8], info: [[0, 5.4, 16, 3.6]] },
  classic: { board: [0, 0, 11, 9], info: [[11.6, 0, 4.4, 9]] },
  "classic-reversed": { board: [5, 0, 11, 9], info: [[0, 0, 4.4, 9]] },
  simple: { board: [4, 0, 8, 9], info: [[0, 0, 3.4, 9], [12.6, 0, 3.4, 9]] },
  vertical: { board: [9.6, 0, 6.4, 9], info: [[0, 0, 9, 9]] },
};

function Thumb({ layout }: { layout: BoardLayout }) {
  const { board, info } = SHAPES[layout];
  return (
    <svg viewBox="-0.3 -0.3 16.6 9.6" className="layout-thumb" aria-hidden="true">
      {info.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={0.5} className="lt-info" />
      ))}
      <rect x={board[0]} y={board[1]} width={board[2]} height={board[3]} rx={0.5} className="lt-board" />
    </svg>
  );
}

const SIZE_PRESETS = [0.75, 1, 1.25, 1.5, 2];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; name: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="picker-field">
      <span className="picker-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            className={value === o.id ? "on" : ""}
            onClick={() => onChange(o.id)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The big-screen look: theme, layout, alignment, what to show, the draw
 * animation and the pattern card. Controlled: used for a live room (every
 * change applies to all its screens at once) and for the admin's
 * server-wide default.
 */
export function DisplayPicker({
  value,
  onChange,
  compact = false,
  footer,
}: {
  value: DisplaySettings;
  onChange: (patch: Partial<DisplaySettings>) => void;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const { layout, ballAnimation, patternScale, patternPlace, align, boardFit, showJoin, showRecent, theme } = value;
  // The slider moves locally and saves when let go (not on every step).
  const [size, setSize] = useState(patternScale);
  useEffect(() => setSize(patternScale), [patternScale]);
  const saveSize = (v: number) => v !== patternScale && onChange({ patternScale: v });
  const { min, max } = SETTINGS_LIMITS.patternScale;
  const hint = BOARD_LAYOUTS.find((l) => l.id === layout)?.hint;
  return (
    <div className={`display-picker ${compact ? "compact" : ""}`}>
      <span className="picker-label">Theme</span>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === t.id}
            className={`theme-tile ${theme === t.id ? "on" : ""}`}
            onClick={() => onChange({ theme: t.id })}
          >
            <span className="theme-swatch" aria-hidden="true">
              {t.swatch.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      <span className="picker-label">Layout</span>
      <div className="layout-grid" role="radiogroup" aria-label="Board layout">
        {BOARD_LAYOUTS.map((l) => (
          <button
            key={l.id}
            role="radio"
            aria-checked={layout === l.id}
            className={`layout-tile ${layout === l.id ? "on" : ""}`}
            title={l.hint}
            onClick={() => onChange({ layout: l.id })}
          >
            <Thumb layout={l.id} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      {hint && <p className="muted small">{hint}</p>}

      <div className="picker-row">
        <Segmented
          label="Alignment"
          value={align}
          options={[
            { id: "center", name: "Center" },
            { id: "top", name: "Top" },
          ]}
          onChange={(v) => onChange({ align: v })}
        />
        <Segmented
          label="Board shape"
          value={boardFit}
          options={[
            { id: "fit", name: "Square cells" },
            { id: "fill", name: "Fill the space" },
          ]}
          onChange={(v) => onChange({ boardFit: v })}
        />
      </div>

      <div className="picker-field">
        <span className="picker-label">Show</span>
        <div className="picker-checks">
          <label className="switch">
            <input type="checkbox" checked={showJoin} onChange={(e) => onChange({ showJoin: e.target.checked })} />
            QR code and room code
          </label>
          <label className="switch">
            <input type="checkbox" checked={showRecent} onChange={(e) => onChange({ showRecent: e.target.checked })} />
            Previous balls
          </label>
        </div>
      </div>

      <label className="picker-field">
        <span className="picker-label">When a ball is drawn</span>
        <select
          value={ballAnimation}
          onChange={(e) => onChange({ ballAnimation: e.target.value as DisplaySettings["ballAnimation"] })}
        >
          {BALL_ANIMATIONS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <div className="pattern-size">
        <label htmlFor="pattern-size" className="picker-label">
          Pattern size <strong>{Math.round(size * 100)}%</strong>
        </label>
        <input
          id="pattern-size"
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          onPointerUp={() => saveSize(size)}
          onKeyUp={() => saveSize(size)}
          onBlur={() => saveSize(size)}
        />
        <div className="segmented" role="radiogroup" aria-label="Pattern size presets">
          {SIZE_PRESETS.map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={patternScale === v}
              className={patternScale === v ? "on" : ""}
              onClick={() => saveSize(v)}
            >
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>
      </div>
      <Segmented
        label="Pattern placement"
        value={patternPlace}
        options={PATTERN_PLACES.filter((p) => showJoin || p.id !== "join")}
        onChange={(v) => onChange({ patternPlace: v })}
      />
      <p className="muted small">
        The board shrinks to make room for a bigger pattern. If there isn't room on a screen, the pattern is shown as big
        as fits there.
      </p>
      {footer}
    </div>
  );
}

/** "Save as my default": new rooms hosted from this device start with this look. */
function SaveDefault({ current }: { current: DisplaySettings }) {
  const [saved, setSaved] = useState(getDisplayDefault);
  const same = saved !== null && JSON.stringify(saved) === JSON.stringify(current);
  return (
    <div className="save-default">
      <div className="row">
        <button
          className="btn btn-secondary btn-small"
          disabled={same}
          onClick={() => {
            setDisplayDefault(current);
            setSaved(current);
          }}
        >
          {same ? "✓ Saved as my default" : "Save as my default"}
        </button>
        {saved && (
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              setDisplayDefault(null);
              setSaved(null);
            }}
          >
            Forget my default
          </button>
        )}
      </div>
      <p className="muted small">
        New rooms you host from this device start with this look. The admin page can also set a default for every new
        room.
      </p>
    </div>
  );
}

/** The picker wired to a live room. */
export function RoomDisplayPicker({ view, act, compact }: { view: RoomView; act: Act; compact?: boolean }) {
  const current = displayOf(view.settings);
  return (
    <DisplayPicker
      value={current}
      onChange={(patch) => act("setDisplay", patch)}
      compact={compact}
      footer={<SaveDefault current={current} />}
    />
  );
}
