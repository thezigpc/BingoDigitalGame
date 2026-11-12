# Bar Games integration: Bingo

**Level reached: 3** (hosted, branded, connected, controllable), plus `create_room` and
casting from the host screen (SDK 0.2.0), `confirm_claim` / `reject_claim` (SDK 0.2.1),
the Rooms-page status fields, `tableMode` and venue join links (SDK 0.3.0), and
"← All games", staff announcements and `joinPath` (SDK 0.4.0), and the shared-screen
marker, `--venue-on-primary` and tableMode's wake lock (SDK 0.5.0), and staff sign-in
and "first joiner hosts" (SDK 0.7.x), the venue's admin password (SDK 0.8.0), and
running under a path prefix such as `https://<venue>/bingo/` (SDK 0.10.0).

- **SDK:** 0.10.0, vendored at `vendor/bargames-sdk-0.10.0.tgz`.
- **Game kit:** 0.6.0, vendored at `vendor/bargames-gamekit-0.6.0.tgz` (the kit repo's
  `dist-pack` build; no v0.6.0 GitHub release existed yet on 2026-11-12). See "Game kit"
  below.
- **Manifest:** [bargames.json](bargames.json), Bingo `0.5.0`, with
  `"routing": { "basePath": true }`.

```
$ npx bargames validate .
! image: not pinned by digest; releases should use image@sha256:…
✓ bingo@0.5.0 (sdk level 3)

$ npx bargames check --game http://127.0.0.1:3005
bingo@0.5.0 · level 3 · http://127.0.0.1:3005
✓ health /health → 200
✓ /__bargames/venue.json returns the box's branding ("Bingo (mock)")
✓ /__bargames/theme.css served
✓ "room_closed" declared (the box takes a closed room off the TVs at once)
✓ status refuses requests without the game token
✓ status → 2 room(s)
✓ unknown commands are rejected
✓ command "start" is wired (and refuses a missing room)
✓ command "pause" is wired (and refuses a missing room)
✓ command "resume" is wired (and refuses a missing room)
✓ command "next_round" is wired (and refuses a missing room)
✓ command "end" is wired (and refuses a missing room)
✓ command "confirm_claim" is wired (and refuses a missing room)
✓ command "reject_claim" is wired (and refuses a missing room)
✓ create_room → room HACG (with hostUrl)
✓ status lists HACG as a venue room
✓ table view /join/HACG?as=table → 200
✓ end closes HACG
✓ HACG left status after "end"

all checks passed
```

The game ran on port 3005 for these checks because 3002 (the manifest port) is taken on
the dev PC by the live dev site. Inside the container it's 3002, as the manifest says.
Run on 2026-11-12 with SDK 0.10.0 and kit 0.6.0, with the game under `/bingo`
(`BG_BASE_PATH=/bingo`). The mock box ran with `--base /bingo --port 7082 --core-port
7197`, because other projects' mock boxes held 7080/7199 and 7081/7198. Start it from
PowerShell: Git Bash rewrites `--base /bingo` into a Windows path
(`C:/Program Files/Git/bingo`).

## Under a path prefix (SDK 0.10.0, kit 0.6.0)

The box is moving to one hostname per venue, with each game at `/<game>/`. The proxy
(the box's gateway, or your own nginx) strips the prefix, so the server's routes don't
change. Bingo learns the prefix from `BG_BASE_PATH` (box) or `BASE_PATH` (self-hosted).
Unset, it runs at the root exactly as before.

- **Server:** `serveSpa(app, { dist })` (kit) replaces the static files plus the
  `index.html` catch-all. Under a prefix it injects `<meta name="bargames-base">` and
  `<base href="/bingo/">`; at the root the HTML is unchanged.
- **Build:** Vite `base: "./"`, so asset URLs are relative. `client/index.html` also
  carries `<base href="/" />`, so a reload of a deep link at the root (`/room/ABCD`)
  still finds `/assets/…`. The kit's injector adds nothing at the root, and without
  that tag the browser would ask for `/room/assets/…`. Under a prefix the injected
  `<base>` comes first, and the first one wins. The favicon link is relative too.
- **Client:**
  - `serverUrl` is `serverBase(dev)`, so every fetch (`/api/config`, `/api/admin/*`,
    staff sign-in, venue context) carries the prefix.
  - socket.io: `io(serverOrigin(dev), { ...SOCKET_OPTIONS, path: socketPath() })`.
  - The router has `basename={basePath()}`.
  - Join links and QR codes (`joinUrl` in `components/bits.tsx`) are built as
    `<publicUrl or origin + basePath()>/join/<code>`. They don't use the SDK's client
    `joinUrl()`, which drops the prefix (see SDK requests). The host's table link
    adds `basePath()` too.
- **One origin shared by every game:** every Bingo storage key starts with `bingo_`
  (the kit's session store, plus `bingo_admin_token`). Bingo sets no cookies and has no
  service worker.
- **Server-built links:** `create_room`'s `hostUrl` and the status `joinPath` stay
  game-relative paths (`/join/<code>…`), which the box puts under the game's address.
- **Verified** (scratchpad `e2e-basepath.cjs`): the browser walk-through runs through
  the mock gateway at `http://localhost:7082/bingo/`, and the same script runs at the
  root with no prefix:
  - Host from a phone, the invite link and QR, the host's table link (opens with
    controls), and a player joining.
  - Start, a call reaching the player, a deep-link reload keeping the seat, and
    offline/online.
  - `/admin` (Sign in), staff sign-in landing on the dashboard, and an unknown route
    falling back to the home page.

  Every WebSocket is `/bingo/socket.io/`. Not one request left the prefix, there were
  no 4xx/5xx responses, and there were no page errors. A bare `/api/config` on the
  gateway 404s, as it should.

## Where things live

| File | What |
|---|---|
| `server/src/bargames.ts` | `bg` (the SDK instance), `clientIp`, `displayName`, `tvs` (casting), and `registerBarGames`: the kit's `wireBarGames` with Bingo's commands, `create_room` and claims |
| `server/src/rooms/registry.ts` | The kit's `RoomRegistry` with Bingo's options (codes, cap, idle, close messages, `joinPath`), `createVenueRoom()`, `listRooms()` for /admin |
| `server/src/rooms/Room.ts` | Implements the kit's `KitRoom` (`playerCount`, `tableCount`, `round`, `hostConnected`, `hostName`, `maxPlayers`, `overviewExtra`), and emits the in-game events |
| `server/src/index.ts` | `app.use(bg.middleware())` before `/api` and the SPA catch-all; `/api/config` returns the venue's name on a box; the kit's `installShutdown` (flushes events) |
| `server/src/admin/` | The kit's admin auth and router (`routes.ts`) and setting store (`settings.ts`) |
| `server/src/socket/index.ts` | Host-only cast intents `listTvs`, `castToTvs`, `stopTvs` |
| `client/src/main.tsx` | The kit's `ErrorBoundary`; `<VenueAnnouncement>` once at the root (it hides itself on shared screens) |
| `client/src/pages/HomePage.tsx` | `<BackToGames>` at the bottom of the landing page |
| `client/src/pages/RoomPage.tsx` | The kit's `useRoomConnection`; `tableMode` on a box TV; the SDK's `markSharedScreen()` on any other TV screen on a box |
| `client/src/components/bits.tsx` | `joinUrl(code, venue)`: the SDK's `joinUrl`, so links and QR codes use the venue's address on a box |
| `client/src/components/TvsPanel.tsx` | The host's "Venue TVs" control (box only) |
| `client/src/index.css` | `--venue-*` mapped onto the chrome tokens (top); `.tv` padding takes `--bg-safe-x/y` |
| `test/specs/09-bargames.test.mjs` | Standalone, commands, `create_room`, casting, `joinPath`, venue-room idle, status, events and rate-limit tests (25 tests) |

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
| `end` | The kit closes the room with Bingo's `endReason`, "The host ended this room." (the host's **Close room** text), cause `"host"` (`endCause`, kit 0.3.2) | Unknown room. |
| `confirm_claim` | `room.resolveClaim(id, true)` (the host's **Confirm winner**) | Unknown room. No claim waiting: "No BINGO claim is waiting in this room." A `claimId` that isn't waiting: "That BINGO claim isn't waiting any more: it was already confirmed or turned down (the host's phone may have got there first), or it wasn't a valid BINGO." Both are Bingo's own words (`claimMessages`, kit 0.3.2); a test checks them. |
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

## Staff sign-in (SDK 0.7.0)

Staff signed in to the box's admin open Bingo's settings (`routes.admin: "/admin"`)
without Bingo's admin password.
- **Server:** the kit's `adminRouter` with `trusted: (req) => bg.isStaff(req)`
  (`server/src/admin/routes.ts`). `isStaff` is true only on a box, for a request through
  its gateway that carries the box's staff mark. Standalone it is always false.
- **Client:** `AdminPage` reads `/api/admin/status`. When it says `trusted` and nobody is
  signed in, it calls the kit's `staffSignIn(serverUrl)` and uses that token instead of
  showing the password form. After **Sign out** on that page, it shows the form and
  doesn't sign staff straight back in; a reload does (they're still box staff).
- **Tests:** on a box, the gateway mark plus the staff mark gets a session that works on
  `/overview`. The gateway mark alone, the staff mark alone, or neither gets `trusted:
  false` and a 403. Standalone, both marks together are ignored.
- **Mock box, in a browser:** a guest gets the password form. After
  `/__bargames/staff?next=/admin` the dashboard opens without it. Sign out shows the
  form. `?off=1` brings the form back for good.

## The venue's admin password (SDK 0.8.0)

The box's own admin password also opens Bingo's `/admin`, even before Bingo has a password
of its own. Signing in to the box also sets a venue-wide staff cookie, so the staff sign-in
above covers direct visits too.
- **Server:** `createAdminAuth({ ..., venuePassword: (pw, ip) => bg.checkVenuePassword(pw, ip) })`
  (`server/src/admin/routes.ts`). The kit asks the box only when Bingo's own password
  doesn't match, or when Bingo has none. The box limits guesses itself, using the client
  IP it's given. Standalone `checkVenuePassword` is always false.
- **The box's password takes over (kit 0.5.1):** `createAdminAuth` also gets
  `onBox: bg.connected`. On a box, `/api/admin/status` says `venueLogin: true`, and
  `setupAllowed` is true only for staff the box vouches for. `/api/admin/setup` refuses
  everyone else, so a guest on the venue Wi-Fi can't claim Bingo's admin.
- **Client** (driven by those two fields, not by `isOnBox`): with `venueLogin`, `/admin`
  opens on **Sign in** ("Use the venue's admin password.") instead of "Set the admin
  password". The "Set a separate password for this game instead" link shows only when
  `setupAllowed` (staff who signed out of the automatic staff session). With Bingo's own
  password set, the hint reads "Use this game's admin password, or the venue's admin
  password." A wrong password before setup says "That isn't the venue's admin password."
  (the kit's message there is "Admin isn't set up yet."). Standalone the page is unchanged.
- **Tests:** on a box with no Bingo password, status says `venueLogin: true` and
  `setupAllowed: false`. The box password signs in and the session works on `/overview`,
  a wrong one doesn't, and the box receives the client IP. A guest's setup is refused and
  the admin stays unclaimed; staff see `setupAllowed: true` and can set Bingo's own
  password. That password then signs in without asking the box, the box password still
  works, and a wrong one doesn't. Standalone, "box-password" is refused, `venueLogin` is
  false, and setup is allowed as before.
- **Mock box, in a browser** (box password "box-password"): a guest gets Sign in with no
  "separate password" link; a wrong password shows the message above; the box password
  opens the dashboard. Staff land on the dashboard; after Sign out they see the link; after
  the box's staff sign-out it's gone again. The mock printed "box password refused", then
  "box password accepted".

## First joiner hosts (SDK 0.7.0, fixed in 0.7.1)

The box's TVs page ("Show on this TV") sends `create_room` with
`firstJoinerHosts: true`. Nobody hosts that room yet, so **the first phone to join, from
the TV's QR code, becomes the host**.
- `createVenueRoom` marks the room `hostOpen`. The first `joinRoom` as a player then takes
  the room's existing host seat (`Room.claimHostSeat`) under the name they typed, and gets
  the host session and view. That's the same seat, token and powers as a phone host who
  created the room, and it survives a reload. Everyone after that joins as a player. The
  host isn't counted as a player, as usual.
- `hostUrl` still opens the same seat on the staff iPad.
- **Without the flag**, a venue room works exactly as before: the first phone is a player.
- **Tests:** the first joiner is host (start and call work, status shows `hostName` and
  `hostConnected`, players 0). The second is a player, and `resume` keeps the host seat.
  A venue room without the flag seats the first phone as a player.
- SDK 0.7.0 dropped the flag before it reached the game. Bingo's test caught it, and 0.7.1
  fixes it.

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
        there so the two don't stack. **Wake lock (SDK 0.5.0):** `tableMode` holds it, so
        Bingo's own wake lock is off on a box TV and runs everywhere else, standalone
        included. Checked with a stubbed `navigator.wakeLock`: one request on the box TV
        (the SDK's), and one from Bingo when the host lets that TV call numbers.
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
  - **Hidden** on a TV or shared screen (SDK 0.5.0). The page is marked
    `<html data-bargames-screen="shared">`, and the strip hides itself there:
    - a box TV: `tableMode` marks it;
    - a Table that can call numbers, or the host's own big-screen board (the same URL as
      a phone room page): `RoomPage` calls `markSharedScreen()`, on a box only;
    - a `?as=table` link while it joins: still the `hidden` prop, until the room page
      takes over.

    Bingo's own `sharedScreen.ts` is gone.
  - **Checked through the mock gateway** with `--announce "Last call at 1:30"`:
    - shown on the landing, join, host, player and admin pages;
    - **Dismiss** hides it;
    - not on the box TV, and not on the host's big-screen board;
    - still hidden when the host lets the box TV call numbers (tableMode stops and the
      plain marker takes over), and again when that's turned off;
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
| `--venue-on-primary` (SDK 0.5.0) | `--accent-ink`, the text on `--accent` (primary buttons). The mock box's `#111111` reached the buttons. |
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

- **Name:** `ghcr.io/thezigpc/bingo:0.4.0`, bumped together with `version` 0.4.0.
  `npx bargames validate .` passes (`✓ bingo@0.4.0 (sdk level 3)`), with only the
  expected warning that the image isn't pinned by digest. 0.1.0, 0.2.1, 0.3.0 and 0.3.1
  are published and left alone.
- **0.5.0: committed, not pushed.** Pushing to `main` runs the workflow and publishes it.
- **0.4.2: published** ([run 43143298645](https://github.com/thezigpc/BingoDigitalGame/actions/runs/43143298645),
  2026-11-12); the anonymous pull of `ghcr.io/v2/thezigpc/bingo/manifests/0.4.2` returns **200**.
- **0.4.1: published** ([run 43141690950](https://github.com/thezigpc/BingoDigitalGame/actions/runs/43141690950),
  2026-11-12); the anonymous pull of `ghcr.io/v2/thezigpc/bingo/manifests/0.4.1` returns **200**.
- **0.4.0: published** ([run 43138773971](https://github.com/thezigpc/BingoDigitalGame/actions/runs/43138773971),
  2026-11-12); the anonymous pull of `ghcr.io/v2/thezigpc/bingo/manifests/0.4.0` returns **200**.
- **0.3.1: published** ([run 43126969457](https://github.com/thezigpc/BingoDigitalGame/actions/runs/43126969457),
  2026-11-11); the anonymous pull returned **200**, and it was installed on the box.
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
  `vendor/bargames-sdk-0.10.0.tgz` and `vendor/bargames-gamekit-0.6.0.tgz`. The kit
  tarball is the kit repo's `dist-pack` build (no v0.6.0 GitHub release yet). Neither
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

**Kit 0.3.2 and SDK 0.5.0 changes (Bingo 0.3.1):**
- `players_changed` no longer fires when a join and a leave cancel out, and no timer runs
  standalone (the kit listens only when `bg.connected`);
- `end` reports cause `"host"` again, and the claim refusals use Bingo's words;
- `io(url, SOCKET_OPTIONS)` and Bingo's typed `call` go straight to the kit, with no
  copies or casts;
- standalone, nothing is marked as a shared screen, and Bingo's wake lock runs as before;
- `--accent-ink` reads `var(--venue-on-primary, <old value>)`.

**Kit 0.6.0 and SDK 0.10.0 changes (Bingo 0.5.0):**
- The static files and `index.html` now come from the kit's `serveSpa`:
  - Hashed `/assets/*` files are cached for a year (`immutable`), and `index.html` is
    sent with `no-cache`.
  - Unknown `/api/*`, `/socket.io/*`, `/__bargames/*` and non-HTML requests now 404
    instead of getting `index.html`.
  - Pages a user sees are unchanged.
- Asset and favicon URLs are relative, under `<base href="/">`.

**Verified for 0.5.0:** 50 tests pass, `bargames check` passes under `/bingo`, the
path-prefix walk-through passes both under the prefix and at the root, and the
old-against-new browser flow against 0.4.2 (5ed28e8) differed **only in the random card
numbers**.

**Kit 0.5.1 changes (Bingo 0.4.2):** the admin status reply has `venueLogin` (false
standalone) and `setupAllowed` (equal to `setupNeeded` standalone), and setup is refused
only when `venueLogin` is true. So standalone, first-run setup works exactly as before.

**Verified for 0.4.2:** 50 tests pass, `bargames check` passes, the staff and venue
password browser checks pass, and the old-against-new browser flow against 0.4.1
(3ff4cef) differed **only in the random card numbers**.

**Kit 0.5.0 and SDK 0.8.0 changes (Bingo 0.4.1):**
- admin login asks the box's password check only after Bingo's own check fails; off a box
  that check is always false, so a wrong password fails exactly as before;
- the admin page's venue-password wording and the Sign in / setup toggle exist only when
  `isOnBox`.

**Verified for 0.4.1:** 50 tests pass (the 48 plus two new ones), `bargames check` passes,
the staff sign-in browser check still passes, and the old-against-new browser flow against
0.4.0 (bde8645) differed **only in the random card numbers**.

**Kit 0.4.0 and SDK 0.7.1 changes (Bingo 0.4.0):**
- the admin status reply carries `trusted` (always false standalone), and the admin page
  only acts on it when true;
- `joinRoom` checks `room.hostOpen`, which only a box's `create_room` with the flag sets;
- the host's Venue TVs cast and stop wait up to 30 s (`call.withTimeout(30_000)`), since
  AirPlay can be slow; that panel exists only on a box.

**Verified for 0.4.0:**
- 48 tests pass (the 45 plus three new ones), and `bargames check` passes.
- The old-against-new browser flow, run against 0.3.1 (e72b179), differed **only in the
  random card numbers**.

**Verified for 0.3.1:**
- 45 tests pass, and `bargames check` passes.
- The same old-against-new browser flow, run against the pushed 0.3.0 (e7a02c7), with
  wake-lock requests and the shared-screen attribute added to the comparison. It again
  differed **only in the random card numbers**.

**Verified (0.3.0):**
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
3. **Done in 0.5.0.** An "on-primary" text color (`--venue-primary-ink`). Bingo's primary buttons use a
   fixed dark ink, so a dark venue primary would give poor button contrast. The kit's
   `<VenueAnnouncement>` has the same issue: it's fixed `#111` text on `--venue-primary`.
4. **Room persistence:** rooms are in memory, so a box-initiated container restart (an
   update, or the memory limit) closes every room, with `room_closed` `reason:
   "shutdown"` sent first. The box can re-create a venue room with `create_room`, but it
   gets a new code, so it would have to re-cast it and players would rejoin.
5. **Done in 0.5.0.** `tableMode` and the game's own wake lock: both run on a box TV. A note in step 7
   on whether games should drop theirs on a box would settle it.
6. **Done in 0.5.0.** A shared-screen signal in the SDK. Bingo needed a small module of its own so the
   root's announcement strip knows when a room page is acting as a TV. If
   `tableMode` (or a lighter `sharedScreen(true)`) told `<VenueAnnouncement>` directly,
   games wouldn't each have to wire it.

7. **The client `joinUrl(ctx, path)` drops a path prefix** (0.10.0, `dist/client.js`):
   it still does `new URL(path, ctx.game.publicUrl ?? location.origin)`. With
   `publicUrl` `http://localhost:7082/bingo`, a join link comes out as
   `http://localhost:7082/join/ABCD`; standalone under `BASE_PATH` it loses the prefix
   too. The server's `publicUrl()` and base.ts's `joinUrl(base, path)` keep it. Bingo
   builds its links itself for now.

**Done since the last report (verified):** `create_room` (0.2.0), casting in the mock box
with an unpaired TV (`fake-unpaired`, 0.3.0), claim commands (0.2.1), `bargames help`
listing every command and the claim `--args`, and `check --room CODE` (0.3.0). That last
one now validates a live Bingo room with a waiting claim: "1 pending claim(s), shape ok".
`hostUrl` handling was answered (never logged or saved by the box).

## Game kit (0.6.0)

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

**Kit request 6 (0.6.0), open:** `injectBasePath` leaves the HTML untouched at the
root. A client built with Vite `base: "./"` (as the README says) then breaks on a reload
of any deep link at the root (`/room/ABCD` asks for `/room/assets/…`), unless the game
adds its own `<base href="/">` (Bingo does). Injecting `<base href="/">` at the root
too, or a README note, would save every game the trap.

**Kit requests 1-5:** all five are done in kit 0.3.2 and in use (see "Kit 0.3.2 and SDK
0.5.0 changes" above). The original requests:
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
