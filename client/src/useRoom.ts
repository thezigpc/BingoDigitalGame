import { useEffect, useRef, useState } from "react";
import type { JoinResult, RoomView } from "@bingo/shared";
import { call, socket } from "./socket";
import { clearSession, loadSession, saveSession } from "./session";

export type ConnStatus = "connecting" | "online" | "offline";

export interface RoomHook {
  view: RoomView | null;
  status: ConnStatus;
  closedReason: string | null;
  /** Clock offset (server - local) in ms, for countdowns. */
  skew: number;
  reconnect: () => void;
}

/**
 * Keeps this tab bound to its seat. Re-sends `resume` on EVERY socket
 * connect: socket.io's automatic reconnect gives the server a brand-new
 * socket with no room binding, so without this a phone that dropped wifi
 * would sit on stale state forever.
 */
export function useRoom(code: string): RoomHook {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>(socket.connected ? "online" : "connecting");
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const closedRef = useRef(false);

  useEffect(() => {
    const session = loadSession();
    if (!session || session.roomCode !== code) {
      setClosedReason("You're not in this room on this device. Join it from the home page.");
      return;
    }

    const resume = () => {
      call<JoinResult>("resume", { code: session.roomCode, token: session.token })
        .then((r) => {
          saveSession({ ...session, name: r.name });
          setStatus("online");
        })
        .catch((err: Error) => {
          // Room gone or seat expired: stop retrying.
          closedRef.current = true;
          clearSession();
          setClosedReason(err.message);
        });
    };

    const onConnect = () => resume();
    const onDisconnect = () => !closedRef.current && setStatus("offline");
    const onState = (v: RoomView) => {
      setSkew(v.serverTime - Date.now());
      setView(v);
    };
    const onClosed = ({ reason }: { reason: string }) => {
      closedRef.current = true;
      clearSession();
      setClosedReason(reason);
    };
    // The browser's offline event is an instant early warning; socket.io
    // can take ~15s to notice. `online` must check socket.connected itself,
    // since no connect event comes if the socket never actually dropped.
    const onOffline = () => setStatus("offline");
    const onOnline = () => {
      if (socket.connected) setStatus("online");
      else socket.connect();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    socket.on("closed", onClosed);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    if (socket.connected) resume();
    else socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
      socket.off("closed", onClosed);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [code]);

  const reconnect = () => {
    socket.disconnect();
    setStatus("connecting");
    socket.connect();
  };

  return { view, status, closedReason, skew, reconnect };
}
