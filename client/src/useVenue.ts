// Bar Games venue branding for the React client. useVenue() runs once at the
// root (VenueBranding in main.tsx); screens that need the context call it too.
//
// Off a box this never changes anything: watchVenue() doesn't fire for standalone
// games and applyTheme() ignores standalone contexts, so the CSS fallbacks apply.

import { applyTheme, watchVenue, type VenueContext } from "@bargames/sdk/client";
import { useEffect, useState } from "react";
import { serverUrl } from "./socket";

let current: VenueContext | null = null;

export function useVenue(): VenueContext | null {
  const [ctx, setCtx] = useState<VenueContext | null>(current);
  useEffect(
    () =>
      watchVenue(
        (c) => {
          current = c;
          applyTheme(c); // sets --venue-* on <html>
          setCtx(c);
        },
        { base: serverUrl || undefined }, // the Vite dev server runs on another port
      ),
    [],
  );
  return ctx;
}

/** Renders nothing; keeps the venue theme applied for the whole app. */
export function VenueBranding(): null {
  useVenue();
  return null;
}
