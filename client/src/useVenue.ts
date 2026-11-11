// Bar Games venue context for the React client (the game kit's useVenue, polling every
// 30 s so staff announcements show up quickly). Off a box it stays null and nothing
// changes: watchVenue() never fires standalone and applyTheme() ignores standalone.

import { useVenue as kitUseVenue } from "@bargames/gamekit/client";
import type { VenueContext } from "@bargames/sdk/client";
import { serverUrl } from "./socket";

export const useVenue = (): VenueContext | null => kitUseVenue(serverUrl || undefined);
