import { useEffect } from "react";

/**
 * Bar Games (SDK 0.11.0): makes room for the staff announcement strip.
 *
 * The kit's <VenueAnnouncement> is a sticky strip at the top or a fixed one at the bottom,
 * and it hides itself with CSS where it doesn't belong (phones-only on a TV, TVs-only on a
 * phone). Bingo's main screen fills the viewport exactly and the BINGO button is pinned to
 * the bottom, so this keeps `--bg-ann-top` / `--bg-ann-bottom` on <html> equal to the
 * visible strip's height (unset when none shows). index.css subtracts them from `.tv` and
 * moves the pinned pieces clear of the strip.
 *
 * Only runs on a box (`on`); standalone the variables stay unset, so nothing changes.
 */
export function useAnnouncementSpace(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const set = (name: string, px: number) =>
      px > 0 ? root.style.setProperty(name, `${Math.ceil(px)}px`) : root.style.removeProperty(name);
    let raf = 0;
    const measure = () => {
      raf = 0;
      let top = 0;
      let bottom = 0;
      for (const el of document.querySelectorAll<HTMLElement>(".bargames-announcement")) {
        const h = el.getBoundingClientRect().height; // 0 while its CSS hides it
        if (el.dataset.position === "bottom") bottom = Math.max(bottom, h);
        else top = Math.max(top, h);
      }
      set("--bg-ann-top", top);
      set("--bg-ann-bottom", bottom);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    // The strip mounting, changing or unmounting; the page becoming (or ceasing to be) a
    // shared screen, which shows or hides it; and resizes, which rewrap its text.
    const mo = new MutationObserver(schedule);
    mo.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true, characterData: true });
    mo.observe(root, { attributes: true, attributeFilter: ["data-bargames-screen"] });
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    schedule();
    return () => {
      mo.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--bg-ann-top");
      root.style.removeProperty("--bg-ann-bottom");
    };
  }, [on]);
}
