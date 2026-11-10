/**
 * Full screen on / off. Always offered on every screen, whatever the browser:
 * the user confirmed it works on iPads and iPhones. iOS Safari only has the
 * webkit-prefixed API, so try both, and never hide the button behind feature
 * detection (a `document.fullscreenEnabled` check once hid it on iPads).
 * Where it's truly unsupported, the tap does nothing.
 */
export function toggleFullscreen(): void {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      if (d.exitFullscreen) d.exitFullscreen().catch(() => {});
      else d.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not allowed here: nothing to do */
  }
}
