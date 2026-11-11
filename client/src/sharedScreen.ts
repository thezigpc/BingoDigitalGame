// Whether this page is currently acting as a TV / shared screen (a Table, or the host's
// own big-screen board). Only the room page knows; the root's announcement strip reads it,
// because staff announcements belong on phones, never on a TV (the box puts them on idle
// TVs itself).

import { useSyncExternalStore } from "react";

let shared = false;
const subs = new Set<() => void>();

export function setSharedScreen(on: boolean): void {
  if (shared === on) return;
  shared = on;
  for (const fn of subs) fn();
}

export function useIsSharedScreen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => shared,
  );
}
