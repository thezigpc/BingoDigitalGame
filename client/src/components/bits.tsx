import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { VenueContext } from "@bargames/sdk/client";
import { basePath } from "@bargames/gamekit/client";
import { FREE_INDEX, LETTERS, letterFor, usedColumns, type Mask, type PatternView, type RoomView } from "@bingo/shared";

/** isNew: the ball just drawn, which plays the room's draw animation. */
export function Ball({ n, size = "md", isNew = false }: { n: number; size?: "sm" | "md" | "lg" | "xl"; isNew?: boolean }) {
  const letter = letterFor(n);
  return (
    <span className={`ball ball-${size} col-${letter} ${isNew ? "ball-new" : ""}`} aria-label={`${letter} ${n}`}>
      <span className="ball-face">
        <span className="ball-letter">{letter}</span>
        <span className="ball-num">{n}</span>
      </span>
    </span>
  );
}

/** Current ball large, then the most recent previous calls. */
export function RecentBalls({ called, count = 5, size = "lg" }: { called: number[]; count?: number; size?: "md" | "lg" | "xl" }) {
  const current = called[called.length - 1];
  const previous = called.slice(-1 - count, -1).reverse();
  return (
    <div className="recent">
      <div className="recent-current">
        {current ? <Ball key={current} n={current} size={size} isNew /> : <span className={`ball ball-${size} ball-empty`} />}
      </div>
      <div className="recent-prev" aria-label="Previous calls">
        {previous.map((n) => (
          <Ball key={n} n={n} size="sm" />
        ))}
      </div>
    </div>
  );
}

/**
 * All 75 numbers, five rows (B-I-N-G-O), called ones lit. skip: rows the
 * caller won't draw from ("Skip unused numbers"), shown dimmed.
 */
/** Board rows to dim: columns the pattern doesn't use, while skipping them. */
export function skippedRows(view: RoomView): boolean[] | undefined {
  if (view.phase !== "playing" || !view.settings.skipUnused) return undefined;
  return usedColumns(view.pattern).map((u) => !u);
}

export function BallBoard({
  called,
  compact = false,
  skip,
}: {
  called: number[];
  compact?: boolean;
  skip?: boolean[];
}) {
  const set = new Set(called);
  const last = called[called.length - 1];
  return (
    <div className={`board ${compact ? "board-compact" : ""}`}>
      {LETTERS.map((letter, row) => (
        <div className="board-row" key={letter}>
          <div className={`board-letter col-${letter} ${skip?.[row] ? "skipped" : ""}`}>{letter}</div>
          {Array.from({ length: 15 }, (_, i) => {
            const n = row * 15 + i + 1;
            return (
              <div key={n} className={`board-cell ${set.has(n) ? `lit col-${letter}` : ""} ${n === last ? "last" : ""} ${skip?.[row] && !set.has(n) ? "skipped" : ""}`}>
                {n}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A 5x5 grid showing which squares a pattern needs. Rotates through variants. */
export function PatternCard({
  pattern,
  size = "md",
  showName = true,
  editable = false,
}: {
  pattern: PatternView;
  size?: "sm" | "md" | "lg" | "tv";
  showName?: boolean;
  /** Shows a pencil before the name (the board's tap-to-change card). */
  editable?: boolean;
}) {
  const [i, setI] = useState(0);
  const variants = pattern.variants;
  useEffect(() => {
    setI(0);
    if (variants.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % variants.length), 1200);
    return () => clearInterval(t);
  }, [pattern.id, variants]);
  const mask = new Set(variants[i % variants.length] ?? []);
  return (
    <figure className={`pattern pattern-${size}`}>
      <div className="mini-grid">
        {LETTERS.map((l) => (
          <div key={l} className={`mini-head col-${l}`}>
            {l}
          </div>
        ))}
        {Array.from({ length: 25 }, (_, idx) => (
          <div key={idx} className={`mini-cell ${mask.has(idx) ? "on" : ""} ${idx === FREE_INDEX ? "free" : ""}`} />
        ))}
      </div>
      {showName && (
        <figcaption>
          {editable && (
            <span className="pattern-pencil" aria-hidden="true">
              ✎{" "}
            </span>
          )}
          {pattern.name}
        </figcaption>
      )}
    </figure>
  );
}

/** Clickable 5x5 for the host to draw a custom pattern. */
export function PatternEditor({ mask, onChange }: { mask: Mask; onChange: (m: Mask) => void }) {
  const set = new Set(mask);
  const toggle = (i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div className="mini-grid editor">
      {LETTERS.map((l) => (
        <div key={l} className={`mini-head col-${l}`}>
          {l}
        </div>
      ))}
      {Array.from({ length: 25 }, (_, i) => (
        <button
          type="button"
          key={i}
          className={`mini-cell ${set.has(i) ? "on" : ""} ${i === FREE_INDEX ? "free" : ""}`}
          onClick={() => toggle(i)}
          aria-pressed={set.has(i)}
          aria-label={`Square ${Math.floor(i / 5) + 1}, ${(i % 5) + 1}`}
        />
      ))}
    </div>
  );
}

/** A full bingo card. `marked` cells show a daub; `highlight` outlines a winning mask. */
export function CardGrid({
  cells,
  marked,
  called,
  highlight,
  onTap,
  serial,
}: {
  cells: number[];
  marked: Set<number>;
  called?: Set<number>;
  highlight?: Set<number>;
  onTap?: (index: number) => void;
  serial?: string;
}) {
  return (
    <div className="card">
      <div className="card-grid">
        {LETTERS.map((l) => (
          <div key={l} className={`card-head col-${l}`}>
            {l}
          </div>
        ))}
        {cells.map((n, i) => {
          const free = i === FREE_INDEX;
          const isMarked = free || marked.has(i);
          const cls = [
            "card-cell",
            isMarked ? "daubed" : "",
            free ? "free" : "",
            highlight?.has(i) ? "win" : "",
            !isMarked && called?.has(n) ? "missed" : "",
          ].join(" ");
          const content = free ? "FREE" : n;
          return onTap && !free ? (
            <button type="button" key={i} className={cls} onClick={() => onTap(i)} aria-pressed={isMarked}>
              {content}
            </button>
          ) : (
            <div key={i} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
      {serial && <div className="card-serial">Card {serial}</div>}
    </div>
  );
}

export function Countdown({ at, skew }: { at: number | null; skew: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [at]);
  if (!at) return null;
  const secs = Math.max(0, Math.ceil((at - (now + skew)) / 1000));
  return <span className="countdown">Next ball in {secs}s</span>;
}

export function QrCode({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${text}`} /> : null;
}

/**
 * A room's join link (and QR code). On a Bar Games box it's on the venue's public
 * address, which a TV opened on an internal address wouldn't know; standalone it's
 * `${location.origin}${basePath()}/join/${code}`, which at the root is exactly as before.
 * Built here rather than with the SDK's client joinUrl(), which (0.10.0) uses
 * new URL(path, base) and so drops a path prefix like /bingo.
 */
export const joinUrl = (code: string, venue: VenueContext | null = null) =>
  `${(venue?.game.publicUrl ?? `${location.origin}${basePath()}`).replace(/\/+$/, "")}/join/${code}`;
