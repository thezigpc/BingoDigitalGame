// Bar Games box only: put this room on the venue's TVs from the host screen
// (BARGAMES.md, "Casting"). Renders nothing off a box, and nothing when the
// venue hasn't allowed casting from games, so standalone never shows it.

import { isOnBox } from "@bargames/sdk/client";
import { useEffect, useState } from "react";
import type { TvCastResult, TvTargets } from "@bingo/shared";
import { call } from "../socket";
import { useVenue } from "../useVenue";

export function TvsPanel({ code }: { code: string }) {
  const onBox = isOnBox(useVenue());
  const [targets, setTargets] = useState<TvTargets | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; lines: string[] } | null>(null);

  // One look on a box to learn whether casting is allowed at all; after that,
  // only when the host opens the control (never polled).
  const refresh = () =>
    call<{ tvs: TvTargets }>("listTvs")
      .then((r) => setTargets(r.tvs))
      .catch(() => setTargets(null));
  useEffect(() => {
    if (onBox) void refresh();
  }, [onBox]);

  if (!onBox || !targets?.enabled) return null;

  const toggle = () => {
    if (!open) {
      setNote(null);
      void refresh();
    }
    setOpen(!open);
  };

  const run = async (event: "castToTvs" | "stopTvs") => {
    setBusy(true);
    setNote(null);
    try {
      const { result } = await call<{ result: TvCastResult }>(event, {
        ids: picked,
        pin: targets.pinRequired ? pin : undefined,
      });
      setNote(describe(result, targets, event === "castToTvs"));
      if (result.ok) setPicked([]);
      await refresh();
    } catch (err) {
      setNote({ ok: false, lines: [err instanceof Error ? err.message : "That didn't work."] });
    } finally {
      setBusy(false);
    }
  };

  const shown = (id: string) => targets.displays.find((d) => d.id === id);
  const status = (d: TvTargets["displays"][number]) =>
    d.showingThisGame
      ? d.roomCode === code
        ? "Showing this room"
        : `Showing room ${d.roomCode ?? "?"}`
      : d.busy
        ? "Busy"
        : "Free";

  return (
    <section className="panel">
      <h2>Venue TVs</h2>
      <p className="muted small">Put this room's board on the bar's TVs.</p>
      <button className="btn btn-secondary" aria-expanded={open} onClick={toggle}>
        📡 {open ? "Hide TVs" : "TVs"}
      </button>
      {open && (
        <>
          {targets.displays.length === 0 ? (
            <p className="muted small">No TVs are set up. Ask the staff.</p>
          ) : (
            <ul className="players">
              {targets.displays.map((d) => (
                <li key={d.id}>
                  <label className="switch small grow">
                    <input
                      type="checkbox"
                      checked={picked.includes(d.id)}
                      onChange={(e) =>
                        setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))
                      }
                    />
                    {d.name}
                    {d.group ? ` (${d.group})` : ""}
                  </label>
                  <span className="tag">{status(d)}</span>
                </li>
              ))}
            </ul>
          )}
          {targets.pinRequired && (
            <label>
              TV PIN
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.slice(0, 32))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ask the staff"
              />
            </label>
          )}
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={busy || picked.length === 0 || (targets.pinRequired && !pin)}
              onClick={() => run("castToTvs")}
            >
              Show this room
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || picked.length === 0 || (targets.pinRequired && !pin) || !picked.some((id) => shown(id)?.showingThisGame)}
              onClick={() => run("stopTvs")}
            >
              Stop showing
            </button>
          </div>
          {note && (
            <div className={note.ok ? "muted small" : "error"} role="status">
              {note.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The box's own messages, as-is; an unpaired TV gets a pointer to the staff. */
function describe(r: TvCastResult, targets: TvTargets, cast: boolean): { ok: boolean; lines: string[] } {
  const name = (id: string) => targets.displays.find((d) => d.id === id)?.name ?? id;
  const lines: string[] = [];
  for (const [id, res] of Object.entries(r.results ?? {})) {
    if (res.ok) {
      lines.push(`${name(id)}: ${cast ? "showing this room." : "stopped."}`);
      continue;
    }
    lines.push(
      res.needsCode
        ? `${name(id)}: this TV isn't paired with the box yet. Ask the staff to pair it.`
        : `${name(id)}: ${res.message ?? "That didn't work."}`,
    );
  }
  if (!r.ok && r.message) lines.unshift(r.message);
  if (lines.length === 0) lines.push(r.ok ? (cast ? "On the TVs." : "Stopped.") : "That didn't work.");
  return { ok: r.ok && !Object.values(r.results ?? {}).some((x) => !x.ok), lines };
}
