# Bingo Digital Game (working name)

## Status

**Live in two places:** a dev site (on the developer's Windows PC) and a production
site (a Linux Docker VM). **Their hostnames, hosts, tunnels and deploy details are in
`CLAUDE.local.md`** (git-ignored; Claude Code loads it automatically). The repo is
public on GitHub, so **never commit infrastructure details** (IPs, usernames, key
paths, tunnel IDs, hostnames, other sites on the same hosts): put them in
`CLAUDE.local.md` or the git-ignored `scripts/*.local.*` deploy config instead.

## Layout

An npm-workspaces monorepo, the same shape as CAHDigitalGame:
- `shared/src/bingo.ts`: the pure rules. Card generation (25 row-major cells, `0` is the
  free center at index 12), the pattern catalog (`PATTERNS`, each with `variants: Mask[]`
  where any one variant wins), `winningVariant()`, and the custom-mask sanitizer.
- `shared/src/protocol.ts`: socket events, `RoomView`, settings, and error strings.
- `server/src/rooms/Room.ts`: the server-authoritative state machine (`lobby` and
  `playing`). It handles dealing, calling, auto-call, daubing, claims, and per-member
  views. Every room timer goes through `safeTimeout`, which closes only that room if the
  timer throws. It implements the game kit's `KitRoom`. `rooms/registry.ts` builds the
  kit's `RoomRegistry` (room codes, the cap, the idle sweep with a default 2 h TTL, close
  causes) with Bingo's own options.
- `server/src/socket/index.ts` is the event wiring. Each intent is
  `on(event, (room, memberId, arg) => ...)`, followed by a broadcast and an ack. Failed
  joins are rate-limited per IP, using `cf-connecting-ip` behind the tunnel. Every
  rejected intent is logged with its event and error code.
- `client/`: React and Vite, with routes `/`, `/join/:code` (`?as=table` opens a Table
  display straight away), and `/room/:code`. `RoomPage` picks `HostView`, `PlayerView`,
  or `TableView` by role.
- `test/`: `npm test` runs node:test specs under `test/specs/`. Each spec file spawns its
  own server on a free port (`test/harness.mjs`). Run `npm run build` first, or use
  `npm run test:build`.

## Gameplay as built

- **Roles:** `host` (calls numbers and checks wins), `table` (big-screen board, no
  name), `player` (digital cards on a phone), and `viewer` (see paper-card mode below).
- **Digital cards (default):** players get 1-4 cards (host setting), and are re-dealt
  every game. Marking is per room: **Players tap** (the server rejects marks on uncalled
  numbers, and unmarked called numbers glow) or **Automatic**. **BINGO!** makes the
  server check all of the player's cards against the *called balls*, not the player's own
  marks. A valid claim pauses auto-calling and appears for the host, and as a takeover on
  the Table, until the host confirms or dismisses it. A false claim is shown to the host
  and starts a 3 s cooldown for that player.
- **Paper-card mode** (`settings.cardMode: "paper"`, requested by the user on
  2026-11-08): everyone plays on their own physical cards. The host still draws numbers
  and picks the pattern. Anyone who joins becomes a **nameless `viewer`** with a phone
  version of the Table screen: current ball, recent balls, pattern, full board. No names
  appear anywhere and there are no in-app claims; the host checks wins by hand. The join
  form calls `roomInfo` first so it can hide the name field. Switching a room to paper
  turns seated players into viewers. Switching back leaves viewers as viewers, so they
  have to rejoin with a name to get cards. Card mode is lobby-only.
- **The main screen can run the game** (requested 2026-11-08). The user's reasoning: a
  host may have **only an iPad that they cast to a TV**, so the draw button has to be on
  the board itself. There are two routes:
  1. **Host big-screen mode:** on the home page, "📺 Host on this screen", or the 📺
     button and "Show the board on this screen" in host controls. The host's own device
     renders `TableView` with controls, and "⚙ Host controls" flips back. The choice is
     remembered per room in localStorage (`bingo_bigscreen:<code>`).
  2. **A separate Table display opened from the host's link**, which carries
     `?key=<room.tableKey>`. That Table gets `canControl`. A Table joined by typing the
     code is display-only until the host turns on its "Can call numbers" switch
     (`setTableControl`).

  The server checks `requireCaller` (host, or a Table with control) for start, call,
  pause, resolving claims, the next game, `setDisplay` (layout and animation) and
  `setPattern`. Settings, removing people, and closing the room stay `requireHost`.
  - **Pattern from the board** (2026-11-09, requested by the user): on a controlling
    board, the pattern card is a button, captioned "✎ <name>". Tapping it grows it into
    `PatternPicker` (`client/src/components/PatternPicker.tsx`), a big box of pattern
    tiles plus "Draw your own". Picking one sets it and the box shrinks back. Esc, Done
    or tapping the backdrop closes it.
  - **Top-bar buttons:** ⚙ (host controls), ⛶ (full screen) and ☰ (menu) are icon-only,
    named by `aria-label` and `title`. The user found the labelled ones cramped. Keyboard and presentation-clicker shortcuts on a
  controlling board: Space / → / PageDown calls the next ball, and P pauses.
- **Main-screen layout (`.tv` in index.css):** it fills the viewport exactly and never
  scrolls. `.tv` is a size container and everything inside is sized in `cqw`/`cqh`. The
  board area is its own size container, sized `min(100cqw, 100cqh * var(--ratio))` so it
  fits whichever dimension runs out first. In portrait it stacks: ball, pattern and QR
  across the top, then info full width, with the board taking the rest. The title row
  never wraps (a long `GAME_NAME` gets an ellipsis), because a wrapped title pushes the
  info under the board. For the same reason the join box is capped at `16cqw`, so a long
  hostname wraps inside it. Re-test layouts on the **real** URL: the real dev hostname and
  "Bingo Night (dev)" broke layouts that passed on localhost. The phone `viewer` uses the same component without the join box
  or controls.
- **Board layouts and draw animation** (2026-11-09, modeled on the reference site's
  layouts): `settings.layout` and `settings.ballAnimation` are room-wide and display-only.
  They're changed with `setDisplay` (`requireCaller`, allowed mid-game) from the host's
  "Main screen" panel or the board's **☰ Menu**, which also holds Full screen and Close
  room. **⛶ Full screen is on every screen, whatever the
  browser** (user's rule; they confirmed it works on iPads and iPhones): it's in the board's top bar, the
  menu, and the phone header (players, host phone, paper viewers). The shared helper is
  `client/src/fullscreen.ts` (standard and webkit-prefixed APIs). Never hide it behind feature
  detection: a `document.fullscreenEnabled` check once hid it on iPads. The picker is `client/src/components/DisplayPicker.tsx`.
  - **Layouts** (a `.layout-<id>` class on `.tv`): `easy` (the default and the original
    layout: info on top, board below), `classic` and `classic-reversed` (hall flashboard:
    board plus a side column), `simple` (board in the middle, info on both sides),
    `stacked` (board on top), and `vertical` (B-I-N-G-O as columns, made by dissolving
    `.board-row` with `display: contents`).
  - The side-by-side layouts dissolve `.tv-top` (`display: contents`) and place pieces
    with `grid-template-areas` on `.tv`. They apply only in landscape. Portrait falls back
    to the stacked portrait layout, except `vertical`, which has its own portrait
    arrangement.
  - **Pattern card size and placement** (2026-11-09): `settings.patternScale` (0.5-2)
    and `settings.patternPlace` (`normal`, or swapped with the `ball` or the `join` QR box),
    both set through `setDisplay`. The user explicitly **rejected free drag-and-drop
    positioning**. The card must stay in the layout flow, with the layout resizing around
    it, controlled by presets and a scaler. Don't reintroduce floating or dragging.
    - **Placement swaps** exchange `grid-area` names (`.place-ball`, `.place-join`), so
      they work in every layout template.
    - **Size:** CSS `zoom` on `.tv-pattern`. The layout makes room for it:
      - Easy and Stacked switch to a content-sized info row (`.pattern-scaled`), so the
        board gets shorter.
      - The side-column layouts widen the pattern's column. TableView sets
        `--fr15`/`--fr22`/`--fr26`/`--fr30` to the normal share times the scale, so the
        board gets narrower.
    - **Display cap:** TableView steps the *shown* size down before paint until nothing
      collides or leaves the screen. While the card is enlarged, every piece and button
      is checked, not just the card. The saved size never changes, so a size picked on a
      big TV still fits a laptop. A window resize forces a re-render to re-measure (a
      resize alone doesn't render). Phone `viewer`s ignore both settings.
    - **Browser check:** the scratchpad script `e2e-pattern-flow.cjs` covers every layout
      x size x placement at 4 screen sizes (216 combinations).
  - **More display options and themes** (2026-11-09, requested by the user). All of
    these go through `setDisplay`, validated by `sanitizeDisplay()` in
    `shared/src/protocol.ts`, the single validator for rooms, device defaults, and admin
    defaults. `DISPLAY_KEYS` and `displayOf()` list and extract them.
    - `align` (`center` or `top`)
    - `boardFit` (`fit` or `fill`)
    - `showJoin` and `showRecent` (`showJoin: false` adds `.no-join`, the same join-less
      templates phone viewers use)
    - `theme`: `midnight`, `daylight`, `hall`, `neon`, `ocean`, `sunset`, or `contrast`.
      RoomPage sets `data-theme` on `<html>` while in a room, and `:root[data-theme=…]`
      only swaps tokens, including `--cell-ink`. Its hook must stay **above** RoomPage's
      early returns: React error #310 crashed the room page when it wasn't.
  - **Side-layout grids:** the side-column layouts (Classic, Classic reversed, Simple,
    Vertical) use a spacer row above and below the side pieces, sized by `--lead`.
    Center makes both spacers flex. Top sets the top spacer to 0. Spacing comes from
    `margin-block`, not `row-gap`, so top edges line up exactly with the board. Ball,
    pattern and QR box are `justify-self: center; align-self: start`; the QR box used to
    stretch to the bottom of the screen.
  - **Default look:**
    - **Device level:** "Save as my default" in the picker stores it in localStorage
      (`bingo_display_default`), and `createRoom { display }` sends it.
    - **Server level:** `AdminSettings.displayDefaults` is edited on `/admin`, where each
      room row has "Use as default look" (`AdminRoomSummary.display`).
    - **Order at createRoom:** built-in, then the admin default, then the device default.
      An invalid device default is ignored rather than rejected.
  - The picker (`DisplayPicker`) is controlled (`value`/`onChange`). `RoomDisplayPicker`
    wires it to a room. Browser check: the scratchpad script `e2e-options.cjs` (192
    combinations, themes, save-default).
  - **Animations:** `fade` (the default), `drop`, `zoom`, `roll`, `flip`, and `none`.
    `data-anim` on `.room` drives `.ball-new` (the just-drawn ball, on the TV and on
    phones) and `.board-cell.last`. `prefers-reduced-motion` turns them off.
  - **Verified** with no scroll, clipping, or overlap for every layout at 1920x1080,
    1366x768, 2560x1080, and iPad 1180x820 and 820x1180, using the scratchpad script
    `e2e-layouts.cjs`. Check overlaps as well as clipping: an overflowing top section
    slides *under* the board without ever leaving the viewport.
- **Game buttons** (2026-11-08): **New game** (`newGame { startNext: true }`) ends the
  current game and deals and starts the next one immediately. **End game**
  (`startNext: false`) goes back to setup so the pattern and settings can change.
  **Close room** ends the session for everyone. The host's phone view has all three in its
  Game panel. The board has New and End game for anyone who can control it, and Close
  room (in its ☰ Menu) only when the host is showing the board on their own screen.
- **Admin backend at `/admin`** (2026-11-08): plain HTTP under `/api/admin/*` with a
  bearer token (`server/src/admin/`).
  - **Password:** comes from the `ADMIN_PASSWORD` env var, or a one-time setup screen
    that writes a scrypt hash to `DATA_DIR/admin.json`. Whoever completes setup first
    becomes admin. It's the game kit's admin auth (`saltFormat: "bytes"`, matching every
    existing admin.json). Standalone there's no per-IP lockout (`failsAllowed: Infinity`:
    a venue's Wi-Fi shares one IP behind Cloudflare); the kit's global cap and capped
    delay slow guessing. On a Bar Games box the kit's per-IP lockout (10 per 15 min)
    applies.
  - **Live room list:** refreshes every 5 s, with a per-room Close and a bulk "close rooms
    idle for more than N minutes".
  - **Auto-close idle time:** `roomIdleMinutes`, 5 min to 7 days, default 120. Saved in
    `DATA_DIR/settings.json`. `RoomManager.sweepIdleRooms()` re-reads it every sweep
    (every 60 s), so changes take effect immediately.
  - **DATA_DIR:** defaults to `<repo>/data` (gitignored). `deploy-dev.ps1` excludes it
    from the robocopy mirror, so deploys never wipe the admin password.
- **Patterns:** 16 built-in patterns plus **Custom** (the host draws one by tapping
  squares). Patterns can be changed mid-game, for multi-part games. Multi-variant
  patterns cycle through their variants in the preview.
- **Calling:** manual "Call next ball", or auto-call every 3-60 s with pause/resume. The
  countdown corrects for clock skew between devices using `serverTime`. Draws use
  `crypto.randomInt`.
- **Skip unused numbers** (`settings.skipUnused`, **on by default**, 2026-11-09):
  - Only balls from B-I-N-G-O columns the current pattern uses are called.
    `usedColumns()` in `bingo.ts` decides which columns count; the free center doesn't
    count.
  - It's checked on **every** call: skipped balls stay in `drawOrder`, so a pattern change
    mid-game brings them back.
  - `RoomView.ballsLeft` is the callable count.
  - On the boards, the skipped rows are dimmed (`.skipped`).
  - It's a host setting, toggled in the lobby settings or next to Auto-call.
- **Reconnect:** a per-tab session in localStorage. The client re-sends `resume` on
  **every** socket `connect` (the game kit's `useRoomConnection`, used in `RoomPage`), which avoids the
  CAHDigitalGame reconnect-desync bug. There's a reconnect banner, plus the browser's
  `offline`/`online` events as an early warning. The header has a manual ⟳ button.
- **Not built yet** (only when asked): 90-ball, Wild Bingo, Hot ball, the audio caller,
  and the larger pattern library.

## Bar Games support (SDK level 3, 2026-11-10)

The game can also run on a Bar Games venue box. **[BARGAMES.md](BARGAMES.md) is the
report and reference**: it covers events, commands, the table route, branding and the
container. The guide is `C:\CodeProjects\GameBroker\integration\README.md`. Don't
edit anything under GameBroker.
- **Standalone must stay byte-for-byte the same.** Box-only behavior goes behind
  `bg.connected` (server) or `isOnBox(ctx)` (client). With no `BG_*` env, the SDK is a
  no-op.
- **`server/src/bargames.ts`** is the single connection to the SDK. Use its `clientIp()`
  for any IP; never read `cf-connecting-ip` directly. Commands must call the same `Room`
  method as the host's socket intent, then broadcast.
- **The SDK is vendored** as `vendor/bargames-sdk-<ver>.tgz`. A new SDK version arrives
  under a new file name; update both `package.json` entries. `deploy-prod.sh` ships
  `vendor/`.
- **The image runs as `USER node`** (uid 1000). `deploy-prod.sh` chowns `~/bingo/data`
  to 1000 on every deploy.
- **Mock box:** `npx bargames mock-box . --game http://127.0.0.1:<port>`. Pass `--game`
  to `check`, `status` and `command` too: without it they hit port 3002, which is the
  live dev site on this PC.
- **SDK 0.2.0** (2026-11-10):
  - **`create_room`** makes a `kind: "venue"` room with an empty host seat named
    "Venue" (`RoomManager.createVenueRoom`). Its `hostUrl` is
    `/join/{code}?host=<seat token>`, which `HomePage` turns into that host session.
  - **Idle sweep:** skips venue rooms while a table socket is connected.
  - **Casting:** the host-only `listTvs`/`castToTvs`/`stopTvs` intents drive the
    `TvsPanel`. It renders nothing off a box, or when the venue turned casting off.
  - **Box TVs:** a display-only table on a box shows no buttons (⛶ is hidden only
    there).
  - **Releases:** bump `version` and the image tag in `bargames.json` together. Never
    re-publish a tag.
- **SDK 0.2.1** (2026-11-10): `confirm_claim` / `reject_claim` go through
  `room.resolveClaim` (no `claimId` = oldest pending). `reject_claim`'s `reason` lands on
  `ClaimView.reason` and shows on that player's phone. Status lists `pendingClaims`
  (omitted when empty). Test casting with `npx bargames mock-box . --tv-pin 1234` (fake
  TVs) or `--no-cast`.
- **SDK 0.4.0 and game kit 0.3.1**, now SDK 0.8.0 and kit 0.5.1 (2026-11-11, requested by the user):
  - **The kit** (`vendor/bargames-gamekit-<ver>.tgz`, from the GitHub releases of
    `thezigpc/gamekit`, source in `C:\CodeProjects\GameKit`) owns Bingo's plumbing:
    logger, JSON and setting stores, admin auth and router, `RoomRegistry`,
    `wireBarGames`, `installShutdown`, and on the client the session store (same
    localStorage keys), socket options, `useRoomConnection` and `ErrorBoundary`. Don't
    edit the kit from this repo; report gaps to the kit's author (see BARGAMES.md, "Kit
    requests").
  - **Box events:** `wireBarGames` emits `room_created` / `room_closed` /
    `players_changed` from the registry. `Room` calls `onPlayersChanged` (the
    registry's `notePlayers`) on joins, leaves, kicks and the paper switch, never on
    reconnects. The box's `end` closes with cause `"host"` (`endCause`) and Bingo's host
    message; claim refusals use Bingo's words (`claimMessages`).
  - **Status** is the kit's `overviews()`: Rooms-page fields, `joinPath: /join/<code>`
    (never for private rooms), and `Room.overviewExtra()` for the title and
    `pendingClaims`.
  - **Phone pages** get the staff announcement (`<VenueAnnouncement>` in `main.tsx`),
    which hides itself on a page marked `data-bargames-screen="shared"` (SDK 0.5.0):
    `tableMode` marks a box TV, and `RoomPage` calls `markSharedScreen()` (box only) for
    a controlling Table or the host's big-screen board.
  - **"← All games"** (`<BackToGames>`) sits at the bottom of `HomePage` only.
  - **A box TV** (display-only Table on a box) runs `tableMode` (no pointer, 5% safe
    margins via `--bg-safe-x/y` on `.tv`, standard reconnecting/closed banner, wake
    lock). TableView's own wake lock is skipped there and runs everywhere else.
  - **SDK 0.5.0 and kit 0.3.2** (Bingo 0.3.1, 2026-11-11): `--accent-ink` follows
    `--venue-on-primary`. Use `npx bargames mock-box --port/--core-port` when another
    project's mock box holds 7080/7199.
  - **SDK 0.7.1 and kit 0.4.0** (Bingo 0.4.0, 2026-11-12):
    - **Staff sign-in:** `routes.admin: "/admin"`. The kit's `adminRouter` takes
      `trusted: bg.isStaff`, and `AdminPage` calls `staffSignIn()` when the status says
      `trusted`, so box staff skip the password.
    - **First joiner hosts:** `create_room` with `firstJoinerHosts` sets `room.hostOpen`.
      The first phone to `joinRoom` as a player takes the host seat
      (`Room.claimHostSeat`).
    - **Casting:** the Venue TVs cast and stop use `slowCall` (30 s).
  - **SDK 0.8.0 and kit 0.5.0** (Bingo 0.4.1, 2026-11-12): `createAdminAuth` takes
    `venuePassword: bg.checkVenuePassword`, so the box's admin password opens `/admin`.
    On a box with no Bingo password yet, `/admin` opens on Sign in, with a link to the
    setup form. Mock box password: "box-password".
    Kit 0.5.1 (Bingo 0.4.2) adds `onBox: bg.connected`: status gives `venueLogin` and
    `setupAllowed`, the page follows them, and only box-vouched staff may set a separate
    Bingo password on a box.
  - **Mock box cleanup:** stopping a backgrounded `npx bargames mock-box` can leave its
    node process holding the ports. Check `Get-NetTCPConnection -LocalPort <port>` and
    stop only processes whose command line is in this repo.
  - **Join links and QR codes** use the SDK's `joinUrl(venue, path)`; identical
    standalone.
  - **Verify standalone** by building the previous commit in a worktree and diffing a
    browser flow against it (scratchpad `e2e-standalone-diff.cjs`); the only expected
    difference is random card numbers.

## Lesson: socket.io transports through Cloudflare Tunnel (2026-11-08)

Events emitted right after page load were intermittently lost on the public URL but never
on localhost. The join form's ack timed out ("The server didn't respond"), and the server
logged nothing. The cause was socket.io's default of starting on HTTP long-polling and
upgrading to WebSocket later: emits sent over the polling transport sometimes vanished
through the tunnel. The fix is `transports: ["websocket", "polling"]` in
`client/src/socket.ts` (WebSocket first, polling only as a fallback). The node test
harness always uses WebSocket only, so it **can't** catch this class of bug. Re-test on
the real tunnel URL with a browser after any connection-layer change.

## Reference site: https://letsplaybingo.io/ (studied 2026-11-08)

Named by the user. The site is JS-rendered (webpack SPA, v4.16.1); its findings below
were extracted from its JS bundles and help/settings-guide/FAQ text. Copy **mechanics
and feature set**, not its name, branding, or exact visual design.

**What it is:** a single-device **bingo caller** for a host (shared to a TV/Zoom), plus
a printable card generator and a "Play Along" page. It has **no multiplayer**: Play Along
cards are "not connected or synced", and the FAQ says win verification is manual only
("would require a database and serialized bingo cards", planned for a Pro edition). Live
sync, digital cards, and server-verified wins are what this project adds on top.

- **Modes:** 75-ball (B-I-N-G-O, 5x5 with a free center) is the default; 90-ball (tickets
  in strips of 6) is a session setting. Both are generated with a crypto-secure RNG.
- **Caller controls:** Start Game / Pause-Resume, Call Next Number, Reset Board (with
  confirmation), and a "Shuffle" button that only plays a blower sound. Keyboard controls:
  Space/PageUp pauses, Right/PageDown calls next, R then Enter resets.
- **Calling:** manual or **Automatic calling** with a "Time between calls" setting. There
  is a "Show next call countdown". **Manual mode** turns the board into a display only:
  the host clicks balls drawn from a physical cage, and clicking again un-marks a ball.
  Other settings: "Pause after x number of calls" (for progressive jackpots) and
  "Skip unused numbers" (only calls numbers that matter for the current pattern).
- **Display:** a board of all numbers (called ones lit), the current ball, the previous
  1-5 balls, total calls, game number, and the pattern card with its title and prize.
  There are several layouts (Classic, Easy View, Simple, Stacked, Vertical, 90 Ball),
  color themes, "Colored Rows", and light/dark mode.
- **Patterns:** about 1,000 named patterns, shown as a 5x5 grid. The host can pick one
  from a list, search, or **draw a custom pattern by clicking squares** (minimum 3
  daubs). A "rotating patterns" display covers patterns that can be won multiple ways.
  Multi-part games work by switching the pattern mid-game.
- **Special modes:** **Wild Bingo**: the first ball's last digit is wild, so every number
  ending in that digit is daubed. Wild variants are double wilds, evens/odds, and a
  custom wild digit. **Hot ball**: one ball is designated hot, with a fire animation and
  its own prize.
- **Audio:** speech-synthesis or MP3 caller, optional letter prefix ("B12"), a "chatty
  caller" option, "Call numbers twice" ("N 34, N: 3, 4"), and a chime before each call.
- **Play Along page:** generates N digital cards and the player taps to daub them. It has
  card and dauber color options and saves settings locally. Nothing is synced.
- **Generator:** up to 500 printable cards (or 100 strips of 90-ball tickets), with an
  optional highlighted pattern and hidden unused numbers.

## Decisions made with the user (2026-11-08)

- **Roles:** a Host (caller controls on a phone or laptop), a Table (big-screen board),
  and Players (phones, synced digital cards), all joined by room code.
- **Wins:** a player taps BINGO and the server checks the claim against the called balls
  and the active pattern. The host sees the result and confirms the win or continues.
- **Daubing:** a per-room host setting toggles manual tap-to-daub (the server ignores
  daubs on uncalled numbers) and auto-daub.
- **First version: 75-ball core only.** It covers rooms and reconnect, card generation,
  manual and auto calling, the board with current and previous balls, a small set of
  common patterns plus custom pattern drawing, and verified wins. 90-ball, Wild Bingo,
  Hot ball, and the audio caller come later, and only when asked for.

## Concept

A digital bingo game, structurally modeled on the sibling project `CAHDigitalGame`
(`c:\CodeProjects\CAHDigitalGame`, dev tree — read that repo's own `CLAUDE.md` for the
full pattern this is borrowing from): a host server runs the game, players join a room
from their phones, and an optional shared "Table"/screen display (tablet/laptop/TV) shows
shared game state to the room. This is a **separate, independent codebase** — not a fork
and not sharing a deploy — but intentionally reusing the same architectural shape, since
that shape (room lifecycle, token-based reconnect, Socket.io authority model, deploy
pipeline) already works well in practice there.

## Confirmed decisions

- **Screen/room-based**, same pattern as CAHDigitalGame: a room code, players join via
  phone (enter code + name), an optional big-screen "Table" display for shared state.
  Exact role split (e.g. does bingo need a "caller" role analogous to CAH's Card Czar?)
  depends on the reference site's own mechanics — don't assume a Czar-shaped role exists
  here until that's checked against the actual site being duplicated.
- **Likely monorepo shape** (mirroring CAHDigitalGame, not yet set up in this folder):
  - `shared/` — protocol types shared between server and client.
  - `server/` — Node/Express/Socket.io, server-authoritative state machine, in-memory
    room state (no DB/Redis, same reasoning as CAHDigitalGame: private games, a handful
    of concurrent rooms, not public matchmaking — revisit if that assumption changes).
  - `client/` — React/Vite, one app, role-aware via route/query param rather than
    separate builds per role.
- **Server-authoritative**: clients render state and send intents only; the server
  resolves everything, same as CAHDigitalGame's round state machine. Don't trust
  client-side game logic for win detection, card generation, etc.
- **Reconnect should be first-class from the start**, not bolted on later — phones
  lock/background/drop wifi mid-game and need to resume the same seat/card automatically
  via a persistent client token (separate from the room code), exactly like
  CAHDigitalGame's join flow. CAHDigitalGame hit a real reconnect-desync bug after the
  fact (socket.io issuing a fresh anonymous socket on reconnect that never got rejoined
  to its room) — worth reading that project's "Reconnect desync" section before writing
  the join/reconnect flow here, so the same class of bug isn't reintroduced.
- **Deploy target**: decided on 2026-11-08. It reuses CAHDigitalGame's home-server and
  Cloudflare Tunnel setup. The details are in `CLAUDE.local.md`.

## Deploying (public summary)

- **Dev:** `.\scripts\deploy-dev.ps1` (elevated PowerShell; `-SkipTests` optional). It
  builds, runs the tests as a gate, mirrors the source into a separate deploy tree, runs
  `npm ci` and builds there, restarts the NSSM service, and health-checks.
- **Production:** `./scripts/deploy-prod.sh` (Git Bash; `--skip-tests` optional). It
  builds and tests, takes a rollback snapshot on the VM, streams the source over SSH,
  runs `docker compose up -d --build`, and health-checks.
- **Config:** both read their host-specific settings from git-ignored files,
  `scripts/deploy-dev.local.ps1` and `scripts/deploy-prod.local.sh`. Copy the
  `*.local.example.*` files next to them.
- **Image:** `node:22-slim`, run as `USER node`. The bind-mounted `./data` must be owned
  by uid 1000; `deploy-prod.sh` handles that.

## Open questions (don't guess — ask or check against the reference site)

- Which website is being duplicated, and what specifically should be copied: visual
  design, exact game mechanics, both?
- Single shared bingo pool/caller, or per-player independent cards with no caller?
- Win condition(s): line, full card, pattern-based (like many themed bingo sites), first
  to call it vs. auto-detected?
- Any real-money/prize angle, or purely a party-game clone like CAHDigitalGame?
- Does it need the same kind of house-rules/customization depth CAHDigitalGame grew
  (pluggable optional rules, presets, admin-configurable defaults), or should this start
  much simpler and only grow features as actually requested?

## Useful prior art from CAHDigitalGame (reuse patterns, not code, unless explicitly asked)

Read `c:\CodeProjects\CAHDigitalGame\CLAUDE.md` for the full detail on each of these
before reimplementing the equivalent here:

- Room code generation (short, alphanumeric, excludes ambiguous characters like 0/O, 1/I).
- Persistent client token issued at join, used for reconnect, separate from the room code.
- Server-side room inactivity sweep/TTL, since there's no login wall on the join URL and
  the room code is the real security boundary.
- Structured logging (`scope`, `message`, `key=value` fields) and a real test harness
  (per-spec throwaway server/port/data dir) — both paid off repeatedly in CAHDigitalGame
  and are worth setting up early rather than bolting on later.
- Top-level React error boundary, and a manual "reconnect" refresh affordance in the
  header — cheap insurance that CAHDigitalGame had to retrofit after hitting real bugs.

None of this should be copied wholesale — this is a different game with presumably
different mechanics once the reference site is named. Treat it as "here's what worked,"
not "here's what to build."
