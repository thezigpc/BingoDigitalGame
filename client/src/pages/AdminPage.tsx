import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ADMIN_SETTINGS_LIMITS,
  DEFAULT_SETTINGS,
  displayOf,
  type AdminOverview,
  type AdminRoomSummary,
  type DisplaySettings,
} from "@bingo/shared";
import { BoxAdminLink, staffSignIn } from "@bargames/gamekit/client";
import { useVenue } from "../useVenue";
import { DisplayPicker } from "../components/DisplayPicker";
import { serverUrl } from "../socket";

const TOKEN_KEY = "bingo_admin_token";
const loadToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveToken = (t: string) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

async function api<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${serverUrl}/api/admin${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status}).`), { status: res.status });
  return body as T;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} d ${h % 24} h ago`;
}

export function AdminPage() {
  const [token, setToken] = useState(loadToken);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState("");
  // After a manual Sign out, don't sign venue staff straight back in on this page.
  const [signedOut, setSignedOut] = useState(false);
  const venue = useVenue();

  const refreshStatus = useCallback(() => {
    api<AdminStatus>("/status", token)
      .then(async (s) => {
        // Venue staff (the box vouches for this browser, SDK 0.7.0): a session without the
        // password. Never true off a box, so standalone always shows the form.
        if (!s.authenticated && s.trusted && !signedOut) {
          const t = await staffSignIn(serverUrl);
          if (t) {
            saveToken(t);
            setToken(t);
            return;
          }
        }
        setStatus(s);
      })
      .catch((e: Error) => setError(e.message));
  }, [token, signedOut]);
  useEffect(refreshStatus, [refreshStatus]);

  const signedIn = (t: string) => {
    saveToken(t);
    setToken(t);
  };
  const signOut = async () => {
    await api("/logout", token, { method: "POST" }).catch(() => {});
    setSignedOut(true);
    signedIn("");
  };

  return (
    <main className="admin">
      {/* "← Box admin" for staff who came from the venue box (box 0.12.0+); nothing standalone. */}
      <BoxAdminLink ctx={venue} />
      <header className="admin-head">
        <h1>Admin</h1>
        <Link to="/" className="muted">
          ← Home
        </Link>
      </header>
      {error && <p className="error">{error}</p>}
      {!status ? (
        <p className="muted">Loading…</p>
      ) : status.authenticated ? (
        <Dashboard token={token} onSignOut={signOut} onExpired={() => signedIn("")} />
      ) : (
        <PasswordForm status={status} onToken={signedIn} />
      )}
    </main>
  );
}

/** The kit's /api/admin/status (venueLogin and setupAllowed: kit 0.5.1, true only on a box). */
interface AdminStatus {
  setupNeeded: boolean;
  authenticated: boolean;
  trusted?: boolean;
  venueLogin?: boolean;
  setupAllowed?: boolean;
}

function PasswordForm({ status, onToken }: { status: AdminStatus; onToken: (t: string) => void }) {
  const setupNeeded = status.setupNeeded;
  // On a venue box, the box's admin password signs in here too (SDK 0.8.0), even before
  // Bingo has a password of its own. So on a box the first screen is "Sign in", with a link
  // to set a separate Bingo password instead. Standalone this is always false.
  // venueLogin: the server is on a box, where its password opens this admin (kit 0.5.1).
  // Only staff the box vouches for may set a separate Bingo password there (setupAllowed).
  const onBox = status.venueLogin === true;
  const canSetOwn = onBox && setupNeeded && status.setupAllowed === true;
  const [ownPassword, setOwnPassword] = useState(false);
  const setup = setupNeeded && (!onBox || (canSetOwn && ownPassword));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (setup && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string }>(setup ? "/setup" : "/login", "", { method: "POST", body: { password } });
      onToken(r.token);
    } catch (err) {
      const msg = (err as Error).message;
      // On a box with no Bingo password yet, a wrong venue password comes back as "not set
      // up", which reads oddly next to "Use the venue's admin password."
      setError(onBox && setupNeeded && !setup && /set up/i.test(msg) ? "That isn't the venue's admin password." : msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel admin-login" onSubmit={submit}>
      <h2>{setup ? "Set the admin password" : "Sign in"}</h2>
      {onBox && !setup && (
        <p className="muted small">
          {setupNeeded
            ? "Use the venue's admin password."
            : "Use this game's admin password, or the venue's admin password."}
        </p>
      )}
      {setup && (
        <p className="warning">
          No admin password has been set yet. Whoever sets it first becomes the admin, so do this now. It can't be
          changed here later. Use the <code>ADMIN_PASSWORD</code> environment variable to override it.
        </p>
      )}
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={setup ? "new-password" : "current-password"}
          autoFocus
        />
      </label>
      {setup && (
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-big" disabled={busy || password.length === 0}>
        {setup ? "Set password" : "Sign in"}
      </button>
      {canSetOwn && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOwnPassword(!ownPassword);
            setError("");
          }}
        >
          {ownPassword ? "Sign in with the venue's password instead" : "Set a separate password for this game instead"}
        </button>
      )}
    </form>
  );
}

function Dashboard({ token, onSignOut, onExpired }: { token: string; onSignOut: () => void; onExpired: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [idle, setIdle] = useState("");
  const [bulk, setBulk] = useState("60");

  const load = useCallback(async () => {
    try {
      const d = await api<AdminOverview>("/overview", token);
      setData(d);
      setError("");
    } catch (err) {
      if ((err as { status?: number }).status === 401) onExpired();
      else setError((err as Error).message);
    }
  }, [token, onExpired]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (data && idle === "") setIdle(String(data.settings.roomIdleMinutes));
  }, [data, idle]);

  const run = async (fn: () => Promise<string | void>) => {
    setError("");
    setNote("");
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const adoptLook = (r: AdminRoomSummary) =>
    window.confirm(`Make room ${r.code}'s current look the default for every new room?`) &&
    run(async () => {
      await api("/settings", token, { method: "PUT", body: { displayDefaults: r.display } });
      setLook(null);
      return `Room ${r.code}'s look is now the default for new rooms.`;
    });

  // Server-wide default look: built-in defaults with the saved changes on top.
  const savedLook: DisplaySettings | null = data
    ? { ...displayOf(DEFAULT_SETTINGS), ...data.settings.displayDefaults }
    : null;
  const [look, setLook] = useState<DisplaySettings | null>(null);
  const shownLook = look ?? savedLook;
  const lookChanged = look !== null && JSON.stringify(look) !== JSON.stringify(savedLook);
  const saveLook = () =>
    run(async () => {
      await api("/settings", token, { method: "PUT", body: { displayDefaults: look } });
      setLook(null);
      return "Saved. New rooms start with this look.";
    });
  const resetLook = () =>
    window.confirm("Go back to the built-in look for new rooms?") &&
    run(async () => {
      await api("/settings", token, { method: "PUT", body: { displayDefaults: {} } });
      setLook(null);
      return "New rooms use the built-in look again.";
    });

  const close = (r: AdminRoomSummary) =>
    window.confirm(`Close room ${r.code}? Everyone in it will be sent back to the home page.`) &&
    run(async () => {
      await api(`/rooms/${r.code}/close`, token, { method: "POST" });
      return `Closed ${r.code}.`;
    });

  const saveIdle = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/settings", token, { method: "PUT", body: { roomIdleMinutes: Number(idle) } });
      return "Saved. Rooms idle longer than that are closed automatically.";
    });
  };

  const closeIdle = (e: FormEvent) => {
    e.preventDefault();
    const minutes = Number(bulk);
    if (!window.confirm(`Close every room with no activity for more than ${minutes} minutes?`)) return;
    run(async () => {
      const r = await api<{ closed: string[] }>("/rooms/close-idle", token, { method: "POST", body: { minutes } });
      return r.closed.length ? `Closed ${r.closed.length}: ${r.closed.join(", ")}` : "No rooms were that idle.";
    });
  };

  const { min, max } = ADMIN_SETTINGS_LIMITS.roomIdleMinutes;
  const skew = data ? data.serverTime - Date.now() : 0;

  return (
    <>
      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <section className="panel">
        <div className="admin-row">
          <h2>
            Rooms <span className="muted">({data?.rooms.length ?? "…"})</span>
          </h2>
          <button className="btn btn-small btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>
        {data && data.rooms.length === 0 && <p className="muted">No open rooms.</p>}
        {data && data.rooms.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Status</th>
                  <th>People</th>
                  <th>Last activity</th>
                  <th>Opened</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((r) => (
                  <tr key={r.code}>
                    <td className="admin-code">{r.code}</td>
                    <td>
                      Game {r.gameNumber} · {r.phase === "playing" ? `playing, ${r.calls} called` : "setting up"}
                      <div className="muted small">{r.cardMode === "paper" ? "Paper cards" : "Phone cards"}</div>
                    </td>
                    <td>
                      <span className={`dot ${r.hostConnected ? "on" : ""}`} /> host
                      <div className="muted small">
                        {r.cardMode === "paper"
                          ? `${r.viewers} watching`
                          : `${r.playersConnected}/${r.players} players online`}
                        {r.tables > 0 && ` · ${r.tables} screen${r.tables === 1 ? "" : "s"}`}
                      </div>
                    </td>
                    <td>{ago(Date.now() + skew - r.lastActivityAt)}</td>
                    <td className="muted">{ago(Date.now() + skew - r.createdAt)}</td>
                    <td className="admin-actions">
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() => adoptLook(r)}
                        title="Make this room's theme, layout and other display options the default for new rooms"
                      >
                        Use as default look
                      </button>
                      <button className="btn btn-small btn-danger" onClick={() => close(r)}>
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Auto-close idle rooms</h2>
        <form className="admin-form" onSubmit={saveIdle}>
          <label>
            Close a room automatically after this many minutes with no activity
            <input type="number" min={min} max={max} value={idle} onChange={(e) => setIdle(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!data || Number(idle) === data.settings.roomIdleMinutes}>
            Save
          </button>
        </form>
        <p className="muted small">
          Between {min} minutes and {max / 1440} days. "Activity" means anything happening in the room, like a ball
          called, someone joining, or a setting changed. The server checks every minute.
        </p>
      </section>

      <section className="panel">
        <h2>Default look for new rooms</h2>
        <p className="muted small">
          Every new room starts with this theme, layout and display options. Easiest: set a room up the way you like
          it, then press "Use as default look" on it above. A host can also save their own default on their device,
          which wins for rooms they create.
        </p>
        {shownLook && (
          <DisplayPicker value={shownLook} onChange={(patch) => setLook({ ...shownLook, ...patch })} />
        )}
        <div className="row">
          <button className="btn btn-primary" disabled={!lookChanged} onClick={saveLook}>
            Save default look
          </button>
          {lookChanged && (
            <button className="btn btn-ghost" onClick={() => setLook(null)}>
              Undo changes
            </button>
          )}
          <button
            className="btn btn-ghost"
            disabled={!data || Object.keys(data.settings.displayDefaults).length === 0}
            onClick={resetLook}
          >
            Back to built-in look
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Close old rooms now</h2>
        <form className="admin-form" onSubmit={closeIdle}>
          <label>
            Close every room idle for more than (minutes)
            <input type="number" min={0} value={bulk} onChange={(e) => setBulk(e.target.value)} />
          </label>
          <button className="btn btn-danger" disabled={bulk === "" || Number(bulk) < 0}>
            Close idle rooms
          </button>
        </form>
      </section>

      <button className="btn btn-ghost" onClick={onSignOut}>
        Sign out
      </button>
    </>
  );
}
