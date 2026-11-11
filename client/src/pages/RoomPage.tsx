import { useCallback, useEffect, useRef, useState } from "react";
import { useRoomConnection } from "@bargames/gamekit/client";
import { isOnBox, tableMode, type TableModeController } from "@bargames/sdk/client";
import type { RoomView } from "@bingo/shared";
import { toggleFullscreen } from "../fullscreen";
import { Link, useNavigate, useParams } from "react-router-dom";
import { call, rawCall, socket } from "../socket";
import { clearSession, getBigScreen, sessions, setBigScreen, type StoredSession } from "../session";
import { setSharedScreen } from "../sharedScreen";
import { useVenue } from "../useVenue";
import { HostView } from "./HostView";
import { PlayerView } from "./PlayerView";
import { TableView } from "./TableView";

/** Runs a server intent, surfacing a rejection as a short-lived toast. */
export function useAction() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const act = useCallback(async <T = object,>(event: Parameters<typeof call>[0], ...args: unknown[]) => {
    try {
      return await call<T>(event, ...args);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    }
  }, []);
  return { act, toast, setToast };
}

export function RoomPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const upper = code.toUpperCase();
  // The kit's room connection: re-sends `resume` on EVERY socket connect, because
  // socket.io's automatic reconnect gives the server a brand-new socket with no room
  // binding (the CAHDigitalGame reconnect-desync bug).
  const { view, status, closedReason, skew, reconnect } = useRoomConnection<RoomView, StoredSession>(upper, {
    socket: socket as unknown as Parameters<typeof useRoomConnection>[1]["socket"],
    call: rawCall,
    sessions,
  });
  const { act, toast, setToast } = useAction();
  const [bigScreen, setBig] = useState(() => getBigScreen(upper));
  const showBoard = (on: boolean) => {
    setBigScreen(upper, on);
    setBig(on);
    window.scrollTo(0, 0);
  };

  // The room's theme recolors the whole page (body background included)
  // while you're in it; leaving puts the default back. (Above the early
  // returns: hooks must run on every render.)
  const theme = view?.settings.theme;
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  // A TV / shared screen (a Table, or the host's own big-screen board): no staff
  // announcement strip there.
  const role = view?.you.role;
  const sharedScreen = role === "table" || (role === "host" && bigScreen);
  useEffect(() => {
    setSharedScreen(sharedScreen);
    return () => setSharedScreen(false);
  }, [sharedScreen]);

  // Bar Games box TV (a display-only Table on a box): the SDK's tableMode hides the
  // pointer, keeps the screen awake, sets the 5% safe margins (--bg-safe-x/y, used by
  // .tv) and shows the standard "Reconnecting…" / "Room closed" banner. Off a box, or
  // on any screen that can run the game, nothing changes.
  const venue = useVenue();
  const boxTv = isOnBox(venue) && role === "table" && !view?.you.canControl;
  const tm = useRef<TableModeController | null>(null);
  useEffect(() => {
    if (!boxTv) return;
    tm.current = tableMode(venue);
    return () => {
      tm.current?.stop();
      tm.current = null;
    };
    // The venue context refreshes every 30 s; tableMode only needs it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxTv]);
  useEffect(() => {
    tm.current?.setState(closedReason ? "closed" : status === "offline" ? "reconnecting" : "connected", closedReason ?? undefined);
  }, [boxTv, status, closedReason]);

  if (closedReason) {
    return (
      <main className="center-page">
        <div className="panel">
          <h2>Room closed</h2>
          <p>{closedReason}</p>
          <Link className="btn btn-primary" to="/">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="center-page">
        <p className="muted">Connecting to room {code}…</p>
      </main>
    );
  }

  // Host showing the board on their own screen (iPad/laptop cast to a TV).
  const hostBoard = role === "host" && bigScreen;
  const fullScreenBoard = role === "table" || hostBoard;
  const leave = async () => {
    const msg = role === "host" ? "End this room for everyone?" : "Leave this room?";
    if (!window.confirm(msg)) return;
    await call("leaveRoom").catch(() => {});
    clearSession();
    navigate("/");
  };


  return (
    <div className={`room role-${role}`} data-anim={view.settings.ballAnimation}>
      {status !== "online" && !boxTv && (
        <div className={`banner ${fullScreenBoard ? "banner-float" : ""}`} role="status">
          {status === "offline" ? "Connection lost. Reconnecting…" : "Connecting…"}
        </div>
      )}
      {!fullScreenBoard && (
        <header className="room-header">
          <div className="room-id">
            <span className="room-code">{view.code}</span>
            <span className="muted">
              {role === "host" ? "Host" : role === "viewer" ? "Paper cards" : view.you.name} · Game {view.gameNumber}
            </span>
          </div>
          <div className="header-actions">
            {role === "host" && (
              <button
                className="icon-btn"
                onClick={() => showBoard(true)}
                title="Show the big-screen board here"
                aria-label="Show the big-screen board here"
              >
                📺
              </button>
            )}
            <button className="icon-btn" onClick={toggleFullscreen} title="Full screen" aria-label="Full screen">
              ⛶
            </button>
            <button className="icon-btn" onClick={reconnect} title="Reconnect" aria-label="Reconnect">
              ⟳
            </button>
            <button
              className="icon-btn"
              onClick={leave}
              title={role === "host" ? "End room" : "Leave"}
              aria-label="Leave"
            >
              ✕
            </button>
          </div>
        </header>
      )}
      {role === "host" && !bigScreen && (
        <HostView view={view} skew={skew} act={act} onShowBoard={() => showBoard(true)} />
      )}
      {hostBoard && <TableView view={view} skew={skew} act={act} onHostControls={() => showBoard(false)} />}
      {role === "player" && <PlayerView view={view} skew={skew} act={act} setToast={setToast} />}
      {role === "table" && <TableView view={view} skew={skew} act={act} />}
      {role === "viewer" && <TableView view={view} skew={skew} act={act} viewer />}
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

export type Act = ReturnType<typeof useAction>["act"];
