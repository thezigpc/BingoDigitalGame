import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BackToGames } from "@bargames/gamekit/client";
import type { CardMode, JoinResult } from "@bingo/shared";
import { call } from "../socket";
import { lastName, loadSession, rememberName, saveSession, setBigScreen, getDisplayDefault } from "../session";
import { useGameName } from "../useGameName";
import { useVenue } from "../useVenue";

export function HomePage() {
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const gameName = useGameName();
  const venue = useVenue();
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [name, setName] = useState(lastName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const autoTable = useRef(false);
  // Paper-card rooms don't take names, so ask the room before showing the field.
  const [cardMode, setCardMode] = useState<CardMode | null>(null);
  useEffect(() => {
    setCardMode(null);
    if (code.length !== 4) return;
    let live = true;
    call<{ cardMode: CardMode }>("roomInfo", { code })
      .then((r) => live && setCardMode(r.cardMode))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [code]);
  const paper = cardMode === "paper";

  const enter = (r: JoinResult) => {
    saveSession({ roomCode: r.code, token: r.token, name: r.name, role: r.role });
    navigate(`/room/${r.code}`, { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  // onBoard: this device IS the main screen (an iPad/laptop cast to a TV), so
  // open straight into the full-screen board with its draw button.
  const host = (onBoard: boolean) =>
    run(async () => {
      const r = await call<JoinResult>("createRoom", { display: getDisplayDefault() ?? undefined });
      if (onBoard) setBigScreen(r.code, true);
      enter(r);
    });

  const join = (role: "player" | "table") =>
    run(async () => {
      const roomCode = code.trim().toUpperCase();
      if (roomCode.length !== 4) throw new Error("Room codes are 4 letters.");
      const existing = loadSession();
      // "player" covers viewer too: a paper-card room seats a joining player as a viewer.
      const sameRole =
        role === "table" ? existing?.role === "table" : existing?.role === "player" || existing?.role === "viewer";
      const token = existing?.roomCode === roomCode && sameRole ? existing.token : undefined;
      if (role === "player" && !paper) rememberName(name.trim());
      // The host's "Open Table display" link carries ?key=..., which gives that
      // Table the game controls.
      const tableKey = role === "table" ? (search.get("key") ?? undefined) : undefined;
      enter(
        await call<JoinResult>("joinRoom", {
          code: roomCode,
          role,
          name: paper ? undefined : name.trim(),
          token,
          tableKey,
        }),
      );
    });

  // /join/ABCD?as=table opens straight into the Table display (the host's
  // "Open Table display" button uses this).
  // /join/ABCD?host=<seat token>: a Bar Games box's "Open the host controls"
  // link for a venue room it created (no host phone). It takes that room's host
  // seat; the room page resumes it like any reload.
  useEffect(() => {
    const hostToken = search.get("host");
    if (hostToken && code.length === 4) {
      saveSession({ roomCode: code, token: hostToken, name: "Venue", role: "host" });
      navigate(`/room/${code}`, { replace: true });
      return;
    }
    if (search.get("as") === "table" && code.length === 4 && !autoTable.current) {
      autoTable.current = true;
      join("table");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    join("player");
  };

  return (
    <main className="home">
      <header className="home-hero">
        <div className="hero-balls" aria-hidden>
          {["B", "I", "N", "G", "O"].map((l) => (
            <span key={l} className={`ball ball-md col-${l}`}>
              <span className="ball-face">
                <span className="ball-num">{l}</span>
              </span>
            </span>
          ))}
        </div>
        <h1>{gameName}</h1>
        <p className="muted">
          Play bingo together. One person calls the numbers, everyone plays on their phone, and the board can go up on a
          TV.
        </p>
      </header>

      <form className="panel join-panel" onSubmit={onJoin}>
        <h2>Join a game</h2>
        <label>
          Room code
          <input
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, "")
                  .slice(0, 4),
              )
            }
            placeholder="ABCD"
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            className="code-input"
          />
        </label>
        {paper ? (
          <p className="muted small">
            This game uses paper cards. Join to follow the numbers on your phone. No name needed.
          </p>
        ) : (
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              placeholder="Name"
              autoComplete="nickname"
            />
          </label>
        )}
        <button className="btn btn-primary btn-big" disabled={busy || code.length !== 4 || (!paper && !name.trim())}>
          {paper ? "Watch the numbers" : "Join"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || code.length !== 4}
          onClick={() => join("table")}
        >
          Open as the Table display (TV / big screen)
        </button>
      </form>

      <section className="panel">
        <h2>Host a game</h2>
        <p className="muted">You'll call the numbers and check the wins. Players join with the room code.</p>
        <button className="btn btn-secondary btn-big" disabled={busy} onClick={() => host(true)}>
          📺 Host on this screen
        </button>
        <p className="muted small host-hint">
          For an iPad or laptop that's casting to a TV. Draw numbers right on the board.
        </p>
        <button className="btn btn-ghost btn-big" disabled={busy} onClick={() => host(false)}>
          📱 Host from my phone
        </button>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <footer className="home-foot">
        <Link to="/admin" className="muted small">
          Admin
        </Link>
      </footer>

      {/* Bar Games: back to the venue's games list. Landing page only (never in a room
          or on a TV, so not while a ?as=table / ?host= link is about to open the room).
          Renders nothing off a box. */}
      {!search.get("as") && !search.get("host") && <BackToGames ctx={venue} />}
    </main>
  );
}
