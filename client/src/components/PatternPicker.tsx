import { useEffect, useState } from "react";
import { CUSTOM_PATTERN_ID, FREE_INDEX, PATTERNS, type Mask, type RoomView } from "@bingo/shared";
import type { Act } from "../pages/RoomPage";
import { PatternCard, PatternEditor } from "./bits";

/**
 * The board's pattern card, opened up: tap the card on the main screen and it
 * grows into this box. Tap a pattern to use it (the box shrinks back), or draw
 * your own. Works mid-game too, for multi-part games.
 */
export function PatternPicker({ view, act, onClose }: { view: RoomView; act: Act; onClose: () => void }) {
  const isCustom = view.pattern.id === CUSTOM_PATTERN_ID;
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Mask>(isCustom ? view.pattern.variants[0] : []);
  const [closing, setClosing] = useState(false);

  // Play the shrink animation, then unmount.
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 160);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const choose = async (id: string) => {
    if (id === view.pattern.id) return close();
    if (await act("setPattern", { patternId: id })) close();
  };
  const useDrawn = async () => {
    if (await act("setPattern", { patternId: CUSTOM_PATTERN_ID, customMask: draft })) close();
  };
  const real = draft.filter((i) => i !== FREE_INDEX).length;

  return (
    <div className={`pp-backdrop ${closing ? "closing" : ""}`} onClick={close}>
      <div
        className="pp-box panel"
        role="dialog"
        aria-label="Choose the pattern"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-row">
          <h2>{drawing ? "Draw your pattern" : "Pattern"}</h2>
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>

        {drawing ? (
          <div className="pp-draw">
            <p className="muted">Tap squares to turn them on or off. The middle square is the free space.</p>
            <PatternEditor mask={draft} onChange={setDraft} />
            <div className="row">
              <button className="btn btn-primary" disabled={real === 0} onClick={useDrawn}>
                Use this pattern
              </button>
              <button className="btn btn-ghost" onClick={() => setDraft([])}>
                Clear
              </button>
              <button className="btn btn-ghost" onClick={() => setDrawing(false)}>
                ← Back to the list
              </button>
            </div>
          </div>
        ) : (
          <>
            {view.phase === "playing" && (
              <p className="muted small">Changing it mid-game is fine, for multi-part games.</p>
            )}
            <div className="pp-grid" role="radiogroup" aria-label="Patterns">
              {PATTERNS.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={view.pattern.id === p.id}
                  className={`pp-tile ${view.pattern.id === p.id ? "on" : ""}`}
                  onClick={() => choose(p.id)}
                >
                  <PatternCard pattern={p} size="sm" showName={false} />
                  <span>{p.name}</span>
                </button>
              ))}
              <button
                role="radio"
                aria-checked={isCustom}
                className={`pp-tile pp-custom ${isCustom ? "on" : ""}`}
                onClick={() => setDrawing(true)}
              >
                {isCustom ? (
                  <PatternCard pattern={view.pattern} size="sm" showName={false} />
                ) : (
                  <span className="pp-pencil" aria-hidden="true">
                    ✎
                  </span>
                )}
                <span>{isCustom ? "Custom (edit)" : "Draw your own"}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
