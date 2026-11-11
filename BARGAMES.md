# Bar Games integration: Bingo

**Level reached: 3** (hosted, branded, connected, controllable), plus `create_room` and
casting from the host screen (SDK 0.2.0), `confirm_claim` / `reject_claim` (SDK 0.2.1),
the Rooms-page status fields, `tableMode` and venue join links (SDK 0.3.0), and
"← All games", staff announcements and `joinPath` (SDK 0.4.0).

- **SDK:** 0.4.0, vendored at `vendor/bargames-sdk-0.4.0.tgz`.
- **Game kit:** 0.3.1, vendored at `vendor/bargames-gamekit-0.3.1.tgz` (release v0.3.1 of
  `thezigpc/gamekit`). See "Game kit" below.
- **Manifest:** [bargames.json](bargames.json), Bingo `0.3.0`.

```
$ npx bargames validate .
! image: not pinned by digest; releases should use image@sha256:…
✓ bingo@0.3.0 (sdk level 3)

$ npx bargames check --game http://127.0.0.1:3005
bingo@0.3.0 · level 3 · http://127.0.0.1:3005
✓ health /health → 200
✓ /__bargames/venue.json returns the box's branding ("Bingo (mock)")
✓ /__bargames/theme.css served
✓ "room_closed" declared (the box takes a closed room off the TVs at once)
✓ status refuses requests without the game token
✓ status → 0 room(s)
✓ unknown commands are rejected
✓ command "start" is wired (and refuses a missing room)
✓ command "pause" is wired (and refuses a missing room)
✓ command "resume" is wired (and refuses a missing room)
✓ command "next_round" is wired (and refuses a missing room)
✓ command "end" is wired (and refuses a missing room)
✓ command "confirm_claim" is wired (and refuses a missing room)
✓ command "reject_claim" is wired (and refuses a missing room)
✓ create_room → room CCFK (with hostUrl)
✓ status lists CCFK as a venue room
✓ table view /join/CCFK?as=table → 200
✓ end closes CCFK
✓ CCFK left status after "end"

all checks passed
```

The game ran on port 3005 for these checks because 3002 (the manifest port) is taken on
the dev PC by the live dev site. Inside the container it's 3002, as the manifest says.
The check was run with the version still at 0.2.1; only the version line changes.

## Where things live

| File | What |
|---|---|
| `server/src/bargames.ts` | `bg` (the SDK instance), `clientIp`, `displayName`, `tvs` (casting), and `registerBarGames`: the kit's `wireBarGames` with Bingo's commands, `create_room` and claims |
| `server/src/rooms/registry.ts` | The kit's `RoomRegistry` with Bingo's options (codes, cap, idle, close messages, `joinPath`), `createVenueRoom()`, `listRooms()` for /admin |
| `server/src/rooms/Room.ts` | Implements the kit's `KitRoom` (`playerCount`, `tableCount`, `round`, `hostConnected`, `hostName`, `maxPlayers`, `overviewExtra`), and emits the in-game events |
| `server/src/index.ts` | `app.use(bg.middleware())` before `/api` and the SPA catch-all; `/api/config` returns the venue's name on a box; the kit's `installShutdown` (flushes events) |
| `server/src/admin/` | The kit's admin auth and router (`routes.ts`) and setting store (`settings.ts`) |
| `server/src/socket/index.ts` | Host-only cast intents `listTvs`, `castToTvs`, `stopTvs` |
| `client/src/main.tsx` | The kit's `ErrorBoundary`; `<VenueAnnouncement>` once at the root (hidden on TVs) |
| `client/src/pages/HomePage.tsx` | `<BackToGames>` at the bottom of the landing page |
| `client/src/pages/RoomPage.tsx` | The kit's `useRoomConnection`; `tableMode` on a box TV; tells the root when the page is a shared screen (`sharedScreen.ts`) |
| `client/src/components/bits.tsx` | `joinUrl(code, venue)`: the SDK's `joinUrl`, so links and QR codes use the venue's address on a box |
| `client/src/components/TvsPanel.tsx` | The host's "Venue TVs" control (box only) |
| `client/src/index.css` | `--venue-*` mapped onto the chrome tokens (top); `.tv` padding takes `--bg-safe-x/y` |
| `test/specs/09-bargames.test.mjs` | Standalone, commands, `create_room`, casting, `joinPath`, venue-room idle, status, events and rate-limit tests (19 tests) |

## Events

Every event carries `roomCode` and `sessionKind` (`room.kind`). They are fire-and-forget,
and nothing is sent off a box.

| Event | Emitted at | `data` |
|---|---|---|
| `room_created` | The kit's `wireBarGames`, from the registry's `room_created` (`server/src/bargames.ts:80`) | `{ title }` when the box gave one, otherwise none |
| `room_closed` | The kit's `wireBarGames`, from **every** registry close: host, box `end`, admin, idle sweep, a room's crash, and shutdown or a server crash (`installShutdown`) | `{ reason: "host" \| "admin" \| "idle" \| "error" \| "shutdown" }` |
| `players_changed` | The kit's `wireBarGames`, from `rooms.notePlayers(room)`, which `Room` calls on joins, leaves, kicks and the paper-mode switch (never reconnects) | `{ players }`: seated players only, at most one per room per 2 s |
| `round_started` | `server/src/rooms/Room.ts:388` (`startGame`) | `{ round, pattern, cardMode }`, e.g. `{ round: 1, pattern: "Any Line", cardMode: "digital" }` |
| `round_ended` | `server/src/rooms/Room.ts:429` (`endGame`, from both "New game" and "End game") | `{ round, calls, winners: string[] }` |
| `claim_pending` | `server/src/rooms/Room.ts:485` (a **valid** BINGO waiting for the host; false claims send nothing) | `{ name }` |
| `winner` | `server/src/rooms/Room.ts:511` (host or box confirms a claim) | `{ name, round, calls, pattern }` |

**Closed means gone (SDK 0.3.0):** the registry deletes the room before it fires
`room_closed`, so the room has already left status when the box hears it. `npx bargames
check` confirms this for `end`.

**Not emitted:** `game_over`. A bingo session has no end state other than the room
closing, which `room_closed` already reports. Paper-card rooms have no in-app claims, so
they never send `claim_pending` or `winner`, because the host checks wins by hand.

**Privacy:** `data` holds only names that players typed. A test checks that no event
contains a token, socket id or IP.

## Commands

All commands are in `server/src/bargames.ts`, wired through the kit's `wireBarGames`,
which looks up the room, refuses an unknown one, and turns a throw into `{ ok: false,
message }`. Each Bingo command runs the same `Room` method as the host's socket intent,
then `room.broadcast()`, exactly like the socket `on(...)` wrapper.

| Command | Room method | Refused when |
|---|---|---|
| `start` | `room.startGame()` (the host's Start) | Unknown room. The game has already started. |
| `pause` | `room.setPaused(true)` | Unknown room. Not playing. Already paused. |
| `resume` | `room.setPaused(false)` | Unknown room. Not playing. Not paused. |
| `next_round` | `room.newGame(true)` (the host's **New game**: ends this game, deals and starts the next) | Unknown room. Not playing (use `start` from the lobby). |
| `end` | The kit closes the room with Bingo's `endReason`, "The host ended this room." (the host's **Close room** text), cause `"admin"` | Unknown room. |
| `confirm_claim` | `room.resolveClaim(id, true)` (the host's **Confirm winner**) | Unknown room. No claim waiting ("No claim is waiting in this room."). A `claimId` that isn't waiting: unknown, already decided (the host's phone may have got there first), or a false BINGO ("That claim isn't waiting any more."). |
| `reject_claim` | `room.resolveClaim(id, false, reason)` (the host's **Dismiss**) | Same as `confirm_claim`. |

**Claims (SDK 0.2.1).** `args` is `ClaimArgs { claimId?, reason? }`. With no `claimId`
the kit picks the room's oldest pending claim. Both go through the same
`room.resolveClaim` as the host's buttons, then the normal broadcast, so a confirm
emits `winner` and the game stays paused exactly as when the host confirms.
`reject_claim`'s optional `reason` (trimmed, at most 140 characters) is stored on that
claim, and the player's phone shows "Your BINGO wasn't accepted: <reason>". Only a box
can send a reason: the host's Dismiss sends none, and the player's screen is unchanged in
that case (a test checks the claim has no `reason` field).

`pause` also holds a pending claim. A valid BINGO pauses the game itself, so `resume`
restarts auto-calling while the host is still checking it. That's the same as the host
pressing Resume.

**Status:** the kit's `rooms.overviews()`, most recently active first. One entry per room:

| Field | Bingo's value |
|---|---|
| `code`, `kind` | the room code; `"patron"`, or what `create_room` asked for (`"venue"`) |
| `players` | seated players only (no tables or paper-mode viewers) |
| `phase`, `round` | `"lobby"` / `"playing"`; the game number |
| `title` | `"Game 2: Four Corners"`, or with a box title first: `"Friday Bingo · Game 1: Any Line"` |
| `hostConnected`, `hostName` | the host seat's connection and name ("Venue" in a box room) |
| `tables` | Table (TV) clients connected right now |
| `maxPlayers` | `MAX_PLAYERS_PER_ROOM` (100) |
| `createdAt`, `lastActivityAt` | ISO times |
| `joinPath` (SDK 0.4.0) | `/join/<code>`, Bingo's real join route, on venue and patron rooms. **Never** on a private room (the kit leaves it out; a test checks it). |
| `pendingClaims` | see below; left out when nothing is waiting |

**`pendingClaims`** (`Room.overviewExtra()`): valid BINGOs waiting for a decision,
oldest first:
`{ id: "<claim id>", player: "Ann", detail: "Any Line on card K7Q2MX, after 23 calls", at: "<ISO time>" }`.
`id` is the game's own claim id, the same one the host screen uses, so the box's
Confirm/Reject and the host's buttons act on the same claim. False BINGOs are never
pending (they're rejected on the spot), so they never appear. The claim time is kept in
a `WeakMap` inside `Room`, not on `ClaimView`, so the views sent to phones don't change.

## `create_room` (SDK 0.2.0)

The kit's `wireBarGames` registers it; Bingo's `createVenueRoom` option
(`server/src/bargames.ts:84`) calls `createVenueRoom(rooms, kind, title)` in
`server/src/rooms/registry.ts`. The room is fully set up inside the registry's `init`, so
`room_created` fires only once the host seat exists:

- **The room:** a normal room created with `kind: "venue"` (whatever `kind` the box
  sends, `"venue"` if none), the admin's default look, and an **empty host seat**
  named "Venue". There's no host phone. `room_created` goes out with
  `sessionKind: "venue"`.
- **Players** join by code exactly as in any room. **The TV** opens
  `/join/{code}?as=table` as a display-only table.
- **Commands:** `start`, `pause`, `resume`, `next_round` and `end` work on it unchanged,
  because they act on the room, not on a host connection.
- **Idle close:** the idle sweep skips a `venue` room while at least one table (TV)
  socket is connected (the kit's `RoomRegistry.closeIdle`, using `Room.tableCount()`).
  Once no TV is connected, the normal idle
  time applies again. `end` closes it at any time. The admin page's "close rooms idle
  for N minutes" bulk action is an explicit admin action, so it still closes venue rooms.
  Patron rooms idle-close exactly as before, even with a TV attached; a test checks this.
- **`hostUrl`:** `/join/{code}?host=<token of the empty host seat>`. Opening it on the
  staff iPad takes that host seat, with the full host controls (settings, pattern,
  checking claims, Close room, and the TVs control). It's the seat's own reconnect
  token, so keep it with staff. Several devices can open it at once; they share the seat.
- **Refusing:** at the server's room cap the handler throws `GameError("ROOM_FULL")`, and
  the SDK passes its message ("This room is full.") to staff.
- **Tested:** `create_room` with a title, then status (`kind: "venue"`, 0 players, no
  host connected), a TV and a player joining, `start`/`pause`/`resume`/`next_round`,
  `hostUrl` taking the host seat and calling a ball, and `end` closing the room for the
  TV. A third test server with a 0.6 s idle time checks that the room stays open while a
  TV is connected and idle-closes (`room_closed` `reason: "idle"`) once it leaves.

## Casting from the host screen (SDK 0.2.0)

- **Server:** three host-only socket intents (`server/src/socket/index.ts:134`) using
  `onHostAsync`. It checks the caller holds the room's host seat (`room.requireHost`, the
  same check as Settings and Close room), so players, tables and viewers get "Only the
  host can do that." and never reach the box.
  | Intent | Calls | Ack |
  |---|---|---|
  | `listTvs` | `bg.displays()` | `{ tvs: { enabled, pinRequired, displays } }` |
  | `castToTvs { ids, pin }` | `bg.cast(room.code, ids, { pin })` | `{ result: { ok, message, results } }` |
  | `stopTvs { ids, pin }` | `bg.stopCast(ids, { pin })` | same |

  Input is bounded (at most 50 ids of up to 200 characters, PIN up to 32), and empty or
  junk `ids` are refused without calling the box. The PIN is never logged. The log line
  records only the room and `ok`.
- **UI:** `TvsPanel` ("Venue TVs") in the host screen, under Players. It renders
  **nothing** unless `isOnBox(ctx)`, and **nothing** unless `displays().enabled`. So off a
  box it doesn't even send `listTvs`.
  - **Calls to the box:** one `listTvs` on a box to learn whether casting is allowed, then
    a fresh one each time the host opens the 📡 TVs control and after each cast. It never
    polls.
  - **The list:** TVs by `name` (plus `group`) with checkboxes, each tagged *Free*,
    *Busy*, *Showing this room* or *Showing room XYZW*.
  - **PIN:** a masked field appears only when `pinRequired`.
  - **Buttons:** **Show this room**, and **Stop showing**, which is enabled only if a
    picked TV is showing this game.
  - **Messages:** the box's `message` is shown as-is (e.g. "Wrong TV PIN"). Every TV gets
    a line: "Bar left: showing this room.", or "…this TV isn't paired with the box yet.
    Ask the staff to pair it." when `needsCode`.
- **Tested:**
  - **Standalone:** `listTvs` returns `enabled: false`, `castToTvs`/`stopTvs` return
    `ok: false`, and players are refused.
  - **On a fake box:** the host gets the TV list. A wrong PIN comes back as "Wrong TV
    PIN". A good PIN reaches the core as `{ roomCode, displayIds, pin }` and returns
    per-TV results with `needsCode`. Stop calls `/internal/cast/stop`. Junk input never
    reaches the core, and the PIN isn't in the server output.
  - **Browser (headless Chromium):** against a fake core with two TVs, the panel listed
    them, showed both messages, and sent the right cast. A standalone server showed no
    "Venue TVs" panel.
  - **Against the 0.2.1 mock box** (`npx bargames mock-box . --tv-pin 1234`), from a
    host page through the gateway on `:7080`:
    - the panel listed "Bar (fake TV) (Main room)" and "Patio (fake TV) (Patio)", both
      *Free*;
    - PIN `0000` showed the box's message as-is: "wrong TV PIN";
    - PIN `1234` showed "Bar (fake TV): showing this room.", and the mock printed
      `TV cast fake-bar → http://localhost:7080/join/BTMM?as=table`. The list then
      tagged that TV *Showing this room*;
    - **Stop showing** showed "Bar (fake TV): stopped.", the mock printed
      `TV off fake-bar`, and the TV went back to *Free*;
    - with `--no-cast`, the panel didn't appear at all;
    - no page errors.

    The wrong-PIN *lockout* (too many wrong PINs) wasn't driven to its limit. Its
    message would be shown as-is, like "wrong TV PIN".

## Table (TV) view

**Route:** `/join/{code}?as=table`

- [x] **The URL alone joins as a display.** `HomePage` auto-joins as a Table on load: no
      name, no gesture. Without the host's `?key=`, it's display-only, which is what the
      box needs. The game is controlled from the iPad (commands) or the host.
- [x] **No audio.** The game has no sound at all yet.
- [x] **Fills 1920×1080 with no scrolling.** Checked in headless Chromium through the mock
      gateway: no scroll in the lobby or while playing.
      - **Text size:** the board numbers, ball and code are very large. The smallest text
        is the small captions (about 2.3vh), such as "Join at …" under the QR code and the
        B-I-N-G-O letters over the pattern card. Main content is well above 3vh.
      - **Margins (SDK 0.3.0):** on a box TV, `tableMode` sets `--bg-safe-x/y` (5vw /
        5vh), and `.tv` pads by `max(<its own padding>, var(--bg-safe-*, 0px))`. So a box
        TV gets the 5% safe area (54px / 96px at 1920×1080), and everywhere else the
        variables are unset and the old padding applies unchanged. The layout is
        container-query based, so it simply fits the smaller area: checked at 1920×1080
        through the mock gateway with no scroll.
- [x] **Recovers by itself.** socket.io reconnects and the client re-sends `resume` on every
      connect (the kit's `useRoomConnection`). Rooms live in memory, so after a server
      restart the table shows a clear **"Room closed: That room code doesn't exist."**
      screen. Tested by hard-killing the server mid-game and starting it again.
      - **`tableMode` (SDK 0.3.0)**, on a display-only Table on a box only
        (`client/src/pages/RoomPage.tsx:84`): it hides the pointer (`cursor: none`), keeps
        the screen awake, and shows the SDK's standard banners. A dropped socket shows
        "Reconnecting…", and a closed room shows a full-screen closed banner with the
        game's reason. After the box's `end`, the mock-box TV showed
        "closed: The host ended this room." The game's own reconnect banner is hidden
        there so the two don't stack. Bingo's own wake lock still runs too (harmless).
        The host's own big-screen board and a controlling Table don't get `tableMode`:
        people use those with a pointer or touch.
- [x] **Light on animation.** Only a short animation on each newly drawn ball (fade by
      default; the host can pick "none").
      `prefers-reduced-motion` turns animations off.
- [x] **Nothing assumes a pointer.**
      - **No buttons on a box TV.** The display-only table the box opens (no host
        `?key=`) shows **no buttons at all**. Checked in headless Chromium at 1920×1080
        on a fake box: zero visible buttons, no scroll.
      - **⛶ Full screen:** that button was the only one before. It's now hidden when
        `isOnBox(ctx)` and the table can't control the game, since the kiosk is already
        full screen and nobody can press it. Standalone tables still show it, per the
        rule that ⛶ is on every screen; checked on a standalone server.
      - **The winner takeover** closes itself after 12 s.
      - **A pending BINGO claim** stays on screen as "The host is checking the card…"
        until someone resolves it: the host's phone, staff on the iPad through
        `hostUrl`, or the box's `confirm_claim` / `reject_claim` (SDK 0.2.1).
      - **Pattern-card button and ☰ menu:** both appear only on a table that can control
        the game. The box's table can't.
      - **Hover and "tap to" hints:** none show on a display-only table.

## The venue around the game (SDK 0.4.0)

All of it renders nothing off a box.

- **Staff announcements:** the kit's `<VenueAnnouncement>`, once at the root
  (`client/src/main.tsx:23`), so it's on **every phone page**: landing, join, the host's
  and players' room screens, paper-mode viewers, and `/admin`.
  - **Hidden** on a TV or shared screen, using the kit 0.3.1 `hidden` prop: a Table,
    the host's own big-screen board (they're the same URL as a phone room page, so
    `RoomPage` tells the root through `sharedScreen.ts`), and a `?as=table` link while it
    joins.
  - **Checked through the mock gateway** with `--announce "Last call at 1:30"`:
    - shown on the landing, join, host, player and admin pages;
    - **Dismiss** hides it;
    - not on the box TV, and not on the host's big-screen board;
    - back on the host controls when the host flips back to them.
- **"← All games" with "Also playing":** the kit's `<BackToGames>` at the very bottom of the
  landing page (`client/src/pages/HomePage.tsx:207`), which also serves `/join/{code}`
  before joining.
  - **Never shown** in a room, on the TV view, or while a `?as=table` / `?host=` link is
    opening the room.
  - **Checked:** "← All games" and "Also playing: Other Game (fake)" on the landing and
    join pages, and on no room page.
- **`joinPath`:** `/join/<code>` on venue and patron rooms, never on private ones (see
  Status). The mock's pretend games list at `/__bargames/dev/games` showed
  `Join → http://localhost:7080/join/<code>` for a live room.
- **Join links and QR codes (SDK 0.3.0):** the host's invite link and the TV's QR code use
  the SDK's `joinUrl(venue, "/join/<code>")`. That's the venue's public address on a box,
  which a TV opened on an internal address wouldn't otherwise know. Standalone it returns
  exactly `${location.origin}/join/<code>`, as before.

## Branding (level 1)

**Venue variables mapped onto the chrome** (each keeps its original value as the
fallback):

| Venue variable | Game token or property |
|---|---|
| `--venue-bg` | `--bg`, and `--bg-2` (the page gradient, so it's a flat venue color on a box) |
| `--venue-surface` | `--panel` |
| `--venue-text` | `--text` |
| `--venue-primary` | `--accent` (Bingo's gold: primary buttons, highlights, room code) |
| `--venue-radius` | `--radius` |
| `--venue-font` | the root `font-family` |

**Left alone:** the B-I-N-G-O column colors, daub color, ok/danger states, and the
uncalled-number ink.

**Room themes:** the picker's themes override these tokens, so a theme picked in the room
still wins. The venue look replaces only the default ("Midnight").

**Name:** comes from `/api/config` → `useGameName()`, so every screen and `document.title`
show the venue's name.

**Logo:** shown next to the name on the main screen when `isOnBox(ctx)` and the theme
has a `logoUrl`.

**brandable:** `["displayName", "tagline"]`. `accent` is **not** listed, because
Bingo's accent maps to the venue's *primary* color. A per-game accent override would
have nothing to change.

## Container

- **Image:** the `Dockerfile` copies `vendor/` before `npm ci`, and the final stage runs
  as `USER node` with `/data` owned by `node`.
- **Writes:** the server writes only to `DATA_DIR` (`/data`):
  - `admin.json`: the admin password hash, if set through the setup screen;
  - `settings.json`: admin settings;
  - their `*.tmp` files while saving.

  Logs go to stdout. Nothing else is written, and the server makes no outbound network
  calls.
- **Read-only test: not run.** Docker isn't installed on the dev PC, and I didn't build on
  the production VM. To run it:
  ```bash
  docker build -t ghcr.io/thezigpc/bingo:dev .
  docker run --rm --read-only --tmpfs /tmp --cap-drop ALL -v bgtest:/data -e PORT=3002 -p 3002:3002 ghcr.io/thezigpc/bingo:dev
  ```
- **Production side effect, handled:** because the image is non-root now,
  `scripts/deploy-prod.sh` does two things on its next run:
  - runs `sudo chown -R 1000:1000 ~/bingo/data` on the VM, because files the old
    root-run image wrote would otherwise block admin saves;
  - ships `vendor/`.

## Image

- **Name:** `ghcr.io/thezigpc/bingo:0.3.0`, bumped together with `version` 0.3.0.
  `npx bargames validate .` passes (`✓ bingo@0.3.0 (sdk level 3)`), with only the
  expected warning that the image isn't pinned by digest. 0.1.0 and 0.2.1 are published
  and left alone.
- **0.3.0: published.** The "Publish image" workflow
  ([run 43109672367](https://github.com/thezigpc/BingoDigitalGame/actions/runs/43109672367),
  2026-11-11) went green on the new action versions, with no Node 20 warning. That's the
  clean-checkout `docker build .` for `linux/amd64`. The step 10 anonymous pull check on
  `ghcr.io/v2/thezigpc/bingo/manifests/0.3.0` returns **200**.
- **Workflow:** `.github/workflows/publish-image.yml` is again a byte-identical copy of
  the integration snippet, which now uses `actions/checkout@v7`, `docker/login-action@v4`,
  `docker/setup-buildx-action@v4` and `docker/build-push-action@v7` (all four tags
  checked to exist). That clears GitHub's Node 20 deprecation warning.
- **Clean-checkout build:** Docker still isn't installed on the dev PC, so the CI run is
  the real test. Everything the image needs is committed, including
  `vendor/bargames-sdk-0.4.0.tgz` and `vendor/bargames-gamekit-0.3.1.tgz`. The kit
  tarball is the GitHub release asset, identical to the kit repo's own build. Neither
  build needs GitHub access.
- **0.2.1: published** ([run 42934222401](https://github.com/thezigpc/BingoDigitalGame/actions/runs/42934222401),
  2026-11-11); the anonymous pull check returned **200**.
- **Publishing:** `.github/workflows/publish-image.yml`, copied unchanged from the
  integration snippets. It builds `linux/amd64` with a plain `docker build .` and pushes
  to GHCR whenever `bargames.json` changes on `main`. It can also be started from the
  Actions tab.
- **0.1.0 clean-checkout build: passed in CI.** The "Publish image" workflow
  ([run 42907701722](https://github.com/thezigpc/BingoDigitalGame/actions/runs/42907701722),
  2026-11-10) ran a plain `docker build .` for `linux/amd64` from a fresh checkout and
  pushed it. Docker isn't installed on the dev PC, so before that push I checked a fresh
  `git clone` of the public repo by hand:
  - `npm ci`, `npm run build` and `npm prune --omit=dev` succeed. That's the Dockerfile's
    build, minus the container.
  - `node server/dist/index.js` serves `/health` and `/__bargames/venue.json`.
  - The committed `vendor/bargames-sdk-0.1.0.tgz` was present (now 0.2.0).
  - `package-lock.json` has the Linux x64 native builds (`@esbuild/linux-x64` and
    `@rollup/rollup-linux-x64-gnu`).
  - The Dockerfile takes no build args or secrets.
  - `.dockerignore` excludes `node_modules`, `dist`, `.env`, `data` and `cloudflared`.

- **0.1.0 workflow run and public package: done.** The workflow went green, and the step 10
  anonymous pull check (`ghcr.io/v2/thezigpc/bingo/manifests/0.1.0` with an anonymous
  token) returns **200**, so a box can pull it. The package came out public with no
  manual visibility change, presumably because it's linked to the public repo.
- **Read-only run: still not tested.** The `docker run --read-only` command above hasn't
  been run yet, because no Docker host was used for it.

## Standalone: what changed and how it was verified

**Code paths touched:**
- the `/api/config` handler (async, same value);
- the admin login and socket rate-limit IP (`clientIp()`, same expression off a box);
- `closeRoom` / `closeIdle` take a close cause (used only in the event);
- `Room` gained `kind` and event calls that are no-ops off a box (the `players_changed`
  debounce doesn't even start a timer);
- the CSS tokens now read `var(--venue-*, <old value>)`;
- `<VenueBranding />` is mounted at the root;
- the TableView logo renders only on a box.

**SDK 0.2.0 additions:**
- room creation takes an optional `kind` (default `"patron"`, as before; now the kit registry's `create(kind)`);
- the idle sweep's new skip applies only to `kind === "venue"` rooms, which only
  `create_room` makes;
- `HomePage` reads `?host=` on `/join/{code}`. No standalone link ever has it;
- the ⛶ button is hidden only when `isOnBox`;
- `TvsPanel` renders nothing off a box;
- the three cast intents exist standalone but only answer `enabled: false` / `ok: false`.

**SDK 0.2.1 additions:**
- `Room.resolveClaim` takes an optional `reason`. The host's socket intent never
  passes one;
- `ClaimView` gained an optional `reason`. It's never set standalone, so the JSON sent to
  phones is unchanged;
- `PlayerView` shows the rejection banner only when a `reason` exists;
- `Room` keeps claim times in a private `WeakMap`, which changes nothing in any view.

**Game kit and SDK 0.4.0 changes** (rule 1: verified below):
- **Server plumbing** is the kit's, configured to match Bingo:
  - **Room codes:** same 4-letter alphabet, and typed codes are only trimmed and
    uppercased, as before.
  - **Idle:** the same idle default and admin setting, and the same close messages.
  - **Logging:** the same log line format.
  - **Admin:** the same admin.json, read in Bingo's "bytes" salt format.
  - **Socket:** the same socket.io ping settings.
- **Admin login, changed on purpose:** standalone there's no per-IP lockout any more
  (`failsAllowed: Infinity`). Behind Cloudflare a whole venue's Wi-Fi shares one public
  IP, so one guest could lock the real admin out. The kit's global limit (2 checks at a
  time, a queue of 8) and capped delay (up to 2 s after 5 failures a minute) still slow
  guessing. On a box each device has its own address, so the kit's default lockout
  (10 failures / 15 min) stays on.
- **The admin status reply** has a few more fields (`configured`, `broken`, `trusted`,
  `minPasswordLength`). The page ignores them.
- **Server shutdown:** a crash now closes rooms with cause `error` (was `shutdown`), and
  the server closes socket.io before exiting. Players see the same messages.
- **`players_changed`:** the kit debounces it standalone too (a timer that emits
  nothing), and it no longer skips an event when a join and a leave cancel out
  (see Kit requests).
- **Client plumbing** is the kit's: session store (same storage keys), socket options,
  room connection, ErrorBoundary, game name and venue hooks.
- **New box-only pieces:** `tableMode`, `<VenueAnnouncement>`, `<BackToGames>`, venue join
  links, and `.tv`'s safe-margin padding (identical when the variables are unset).

**Verified:**
- **Tests:** 45 pass. The pre-Bar-Games tests are unchanged except one admin check,
  which now looks at the status fields Bingo uses instead of the whole reply. New admin
  tests: an `admin.json` written by Bingo's old code still logs in; and 11 wrong guesses
  from one IP don't stop the right password from that IP.
- **Old against new, in a browser:** the last pushed version (687abe3, before the kit)
  and this one, both standalone, put through the same flow and compared:
  - the screens: landing, host phone, join page, player, player after a reload, Table
    TV at 1920×1080, the host's big-screen board, and `/admin`;
  - on each: visible text, every button and link, `.tv` padding and size, board size,
    cursor, color tokens, `<html>` inline style, box-only elements, and localStorage
    keys.

  **The only differences were each player's randomly dealt card numbers.** Same storage
  keys means a phone mid-game keeps its seat across this update.
- **New standalone tests:**
  - the cast intents report disabled and refuse, and players are refused;
  - `/api/config` returns the old name;
  - `venue.json` has `standalone: true`;
  - `/__bargames/status` and `/__bargames/command` return 401 even with a token;
  - the rate limit still keys on `cf-connecting-ip`, and spoofed `x-bargames-*` headers
    are ignored.
- **Browser:** a server with no `BG_*` env, compared against the deployed dev site
  (old code). The computed `--bg`, `--bg-2`, `--panel`, `--text`, `--accent`,
  `--radius`, the font and the body gradient are identical, and there's no inline style
  on `<html>`.

**On the mock box:**
- the teal, pink and Georgia test branding and the name "Bingo (mock)" appeared on the
  home page, the phone and the TV;
- `bargames command start` started the game on every screen;
- `bargames status` listed the rooms;
- every event printed green (accepted and declared).

## SDK requests

1. **`bargames command` / `status` default to the manifest port**, which on a dev PC can
   be a different, live process (here the dev site). A `--game` default taken from the
   running `mock-box`, or a warning when the target doesn't serve `/__bargames/*`,
   would be safer.
2. **Derived theme tokens.** Games have more chrome shades than the five colors: Bingo has
   `--panel-2`, `--line` and `--muted`, which stay navy on a teal venue. Standalone-safe
   `--venue-surface-2`, `--venue-border` and `--venue-muted`, computed by the box from
   the venue colors, would let them follow.
3. **An "on-primary" text color** (`--venue-primary-ink`). Bingo's primary buttons use a
   fixed dark ink, so a dark venue primary would give poor button contrast. The kit's
   `<VenueAnnouncement>` has the same issue: it's fixed `#111` text on `--venue-primary`.
4. **Room persistence:** rooms are in memory, so a box-initiated container restart (an
   update, or the memory limit) closes every room, with `room_closed` `reason:
   "shutdown"` sent first. The box can re-create a venue room with `create_room`, but it
   gets a new code, so it would have to re-cast it and players would rejoin.
5. **`tableMode` and the game's own wake lock:** both run on a box TV. A note in step 7
   on whether games should drop theirs on a box would settle it.
6. **A shared-screen signal in the SDK.** Bingo needed a small module of its own so the
   root's announcement strip knows when a room page is acting as a TV. If
   `tableMode` (or a lighter `sharedScreen(true)`) told `<VenueAnnouncement>` directly,
   games wouldn't each have to wire it.

**Done since the last report (verified):** `create_room` (0.2.0), casting in the mock box
with an unpaired TV (`fake-unpaired`, 0.3.0), claim commands (0.2.1), `bargames help`
listing every command and the claim `--args`, and `check --room CODE` (0.3.0). That last
one now validates a live Bingo room with a waiting claim: "1 pending claim(s), shape ok".
`hostUrl` handling was answered (never logged or saved by the box).

## Game kit (0.3.1)

Bingo now uses the kit for its plumbing, adopted in the README's order (each step
committed separately with the tests green):

| Step | Bingo files replaced | Kit pieces |
|---|---|---|
| 1 | `util/logger.ts`, `admin/store.ts`, the settings file code | `log`, `createJsonStore`, `createSettingStore` |
| 2 | `admin/auth.ts`, the auth half of `admin/routes.ts` | `createAdminAuth` (`saltFormat: "bytes"`), `adminRouter` |
| 3-4 | `rooms/RoomManager.ts`, `rooms/ids.ts`, the box wiring | `RoomRegistry`, `wireBarGames`, `installShutdown`, ids |
| 5 | `useRoom.ts`, `ErrorBoundary.tsx`, most of `session.ts`, `socket.ts`, `useGameName.ts`, `useVenue.ts` | `createSessionStore`, `serverOrigin`, `SOCKET_OPTIONS`, `createCall`, `useRoomConnection`, `ErrorBoundary`, `useGameName`, `useVenue`, `VenueAnnouncement`, `BackToGames` |

Steps 3 and 4 went in together: the old `RoomManager` emitted the box events itself, so
moving the registry without `wireBarGames` would have dropped them in between.

**Kit requests** (where it didn't quite fit Bingo; nothing was worked around):
1. **Claim refusals lose detail.** `wireBarGames` answers an unknown, already-decided or
   false-BINGO `claimId` with one message, "That claim isn't waiting any more." Before
   the kit, Bingo told staff "already confirmed" / "already turned down" (the host's
   phone got there first). Passing a decided claim's id through to the game's own
   handler, or a `claimStatus(room, id)` hook, would keep that.
2. **`end` always uses cause `"admin"`.** Bingo's `end` is the host's Close room, which it
   reported as `"host"`. Harmless for the box, but an `endCause` option would let a
   game keep its meaning.
3. **`players_changed` reports unchanged counts.** Bingo's own debounce skipped the event
   when a join and a leave in the same 2 s cancelled out. `notePlayers` emits regardless,
   and it starts a timer standalone too, where the event goes nowhere.
4. **`useRoomConnection`'s `call` type** is `(event: string) => …`, so a game with typed
   event names (Bingo's `call(event: keyof ClientToServerEvents)`) can't pass its own
   `call`. Bingo passes the kit's untyped `createCall` result instead. A generic event
   type parameter would fix it.
5. **`SOCKET_OPTIONS.transports` is a readonly tuple**, which socket.io's
   `ManagerOptions` rejects, so Bingo spreads it into a new array. Exporting it as a
   plain `string[]` would make `io(url, SOCKET_OPTIONS)` work as the README shows.
