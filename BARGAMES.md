# Bar Games integration: Bingo

**Level reached: 3** (hosted, branded, connected, controllable), plus SDK 0.2.0's
`create_room` and casting from the host screen. SDK 0.2.0, vendored at
`vendor/bargames-sdk-0.2.0.tgz`; manifest at [bargames.json](bargames.json).

```
$ npx bargames validate .
! image: not pinned by digest; releases should use image@sha256:…
✓ bingo@0.2.0 (sdk level 3)

$ npx bargames check --game http://127.0.0.1:3005
bingo@0.2.0 · level 3 · http://127.0.0.1:3005
✓ health /health → 200
✓ /__bargames/venue.json returns the box's branding ("Bingo (mock)")
✓ /__bargames/theme.css served
✓ status refuses requests without the game token
✓ status → 0 room(s)
✓ unknown commands are rejected
✓ command "start" is wired (and refuses a missing room)
✓ command "pause" is wired (and refuses a missing room)
✓ command "resume" is wired (and refuses a missing room)
✓ command "next_round" is wired (and refuses a missing room)
✓ command "end" is wired (and refuses a missing room)
✓ create_room → room XKXH (with hostUrl)
✓ status lists XKXH as a venue room
✓ table view /join/XKXH?as=table → 200
✓ end closes XKXH

all checks passed
```

The game ran on port 3005 for these checks because 3002 (the manifest port) is taken on
the dev PC by the live dev site. Inside the container it's 3002, as the manifest says.

## Where things live

| File | What |
|---|---|
| `server/src/bargames.ts` | `bg` (the SDK instance), `clientIp`, `displayName`, `tvs` (casting), `registerBarGames` (commands, `create_room` and status) |
| `server/src/index.ts:35` | `app.use(bg.middleware())`, before `/api` and the SPA catch-all; `/api/config` returns the venue's name on a box; `bg.flush()` on shutdown |
| `server/src/rooms/Room.ts` | `kind: SessionKind` (`"patron"`, or `"venue"` from `create_room`), `title`, `hasConnectedTable()`, and the in-game events |
| `server/src/rooms/RoomManager.ts` | `room_created` / `room_closed`, `all()`, a `CloseCause` on `closeRoom`, `createVenueRoom()`, and the venue-room idle exception |
| `server/src/socket/index.ts:134` | Host-only cast intents `listTvs`, `castToTvs`, `stopTvs` |
| `client/src/useVenue.ts` | `useVenue()` and `<VenueBranding />` (mounted once in `main.tsx`) |
| `client/src/components/TvsPanel.tsx` | The host's "Venue TVs" control (box only) |
| `client/src/index.css` (top) | `--venue-*` mapped onto the chrome tokens |
| `test/specs/09-bargames.test.mjs` | Standalone, commands, `create_room`, casting, venue-room idle, status, events and rate-limit tests (16 tests) |

## Events

Every event carries `roomCode` and `sessionKind` (`room.kind`). They are fire-and-forget,
and nothing is sent off a box.

| Event | Emitted at | `data` |
|---|---|---|
| `room_created` | `server/src/rooms/RoomManager.ts:37` | none |
| `room_closed` | `server/src/rooms/RoomManager.ts:72` | `{ reason: "host" \| "admin" \| "idle" \| "error" \| "shutdown" }` |
| `players_changed` | `server/src/rooms/Room.ts:184` (debounced from joins, leaves, kicks and the paper-mode switch) | `{ players }`: seated players only. At most one per room per 2 s, only when the count actually changed, never for reconnects. |
| `round_started` | `server/src/rooms/Room.ts:347` (`startGame`) | `{ round, pattern, cardMode }`, e.g. `{ round: 1, pattern: "Any Line", cardMode: "digital" }` |
| `round_ended` | `server/src/rooms/Room.ts:388` (`endGame`, from both "New game" and "End game") | `{ round, calls, winners: string[] }` |
| `claim_pending` | `server/src/rooms/Room.ts:444` (a **valid** BINGO waiting for the host; false claims send nothing) | `{ name }` |
| `winner` | `server/src/rooms/Room.ts:468` (host confirms a claim) | `{ name, round, calls, pattern }` |

**Not emitted:** `game_over`. A bingo session has no end state other than the room
closing, which `room_closed` already reports. Paper-card rooms have no in-app claims, so
they never send `claim_pending` or `winner`, because the host checks wins by hand.

**Privacy:** `data` holds only names that players typed. A test checks that no event
contains a token, socket id or IP.

## Commands

All commands are in `server/src/bargames.ts`. Each one runs the same `Room` method as
the host's socket intent, then `room.broadcast()`, which is exactly what the socket
`on(...)` wrapper does. They never throw: an unknown room or a refusal returns
`{ ok: false, message }`.

| Command | Room method | Refused when |
|---|---|---|
| `start` | `room.startGame()` (the host's Start) | Unknown room. The game has already started. |
| `pause` | `room.setPaused(true)` | Unknown room. Not playing. Already paused. |
| `resume` | `room.setPaused(false)` | Unknown room. Not playing. Not paused. |
| `next_round` | `room.newGame(true)` (the host's **New game**: ends this game, deals and starts the next) | Unknown room. Not playing (use `start` from the lobby). |
| `end` | `rooms.closeRoom(code, "The host ended this room.", "host")` (the host's **Close room**) | Unknown room. |

`pause` also holds a pending claim. A valid BINGO pauses the game itself, so `resume`
restarts auto-calling while the host is still checking it. That's the same as the host
pressing Resume.

**Status** (`registerBarGames`): one entry per room:
`{ code, kind, players, phase: "lobby" | "playing", title: "Game 2: Four Corners", hostConnected }`.
`players` counts seated players only (no tables or paper-mode viewers). A room created
with a title shows it first: `"Friday Bingo · Game 1: Any Line"`.

## `create_room` (SDK 0.2.0)

`bg.onCreateRoom` in `server/src/bargames.ts:114` calls `rooms.createVenueRoom({ kind, title })`:

- **The room:** a normal room created with `kind: "venue"` (whatever `kind` the box
  sends, `"venue"` if none), the admin's default look, and an **empty host seat**
  named "Venue". There's no host phone. `room_created` goes out with
  `sessionKind: "venue"`.
- **Players** join by code exactly as in any room. **The TV** opens
  `/join/{code}?as=table` as a display-only table.
- **Commands:** `start`, `pause`, `resume`, `next_round` and `end` work on it unchanged,
  because they act on the room, not on a host connection.
- **Idle close:** the idle sweep skips a `venue` room while at least one table (TV)
  socket is connected (`RoomManager.ts:86`). Once no TV is connected, the normal idle
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
  - **Not tested:** casting on the mock box. `npx bargames mock-box` doesn't serve
    `/internal/displays`, so `displays()` reports `enabled: false` there and the panel
    stays hidden. That's correct behavior, but it means the real core's cast flow is
    untested here (see SDK requests).

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
      - **Margins:** about 1–2% at the screen edges, not 4–5%. The layout is container-query
        based and tuned to fill the screen, and I didn't change the margins, to keep
        standalone identical. Tell me if the box needs the 4–5% safe area.
- [x] **Recovers by itself.** socket.io reconnects and the client re-sends `resume` on every
      connect. Rooms live in memory, so after a server restart the table shows a clear
      **"Room closed: That room code doesn't exist."** screen. Tested by hard-killing the
      server mid-game and starting it again.
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
        until someone resolves it, either the host's phone or staff on the iPad through
        `hostUrl`. There's no box command for it.
      - **Pattern-card button and ☰ menu:** both appear only on a table that can control
        the game. The box's table can't.
      - **Hover and "tap to" hints:** none show on a display-only table.

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

- **Name:** `ghcr.io/thezigpc/bingo:0.2.0` (0.1.0 is published and left alone). The
  version and tag were bumped together in one commit. `npx bargames validate .` passes
  (`✓ bingo@0.2.0 (sdk level 3)`), with only the expected warning that the image isn't
  pinned by digest.
- **0.2.0: not published yet.** It publishes when `main` is pushed. The workflow file is
  unchanged and still byte-identical to the snippet. Docker still isn't installed on the
  dev PC, so the CI run is the clean-checkout build test again. A fresh `git clone` of
  the 0.2.0 commit was checked by hand (`npm ci`, `npm run build`, the vendored
  `bargames-sdk-0.2.0.tgz` present).
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
- `RoomManager.create()` takes an optional `kind` (default `"patron"`, as before);
- the idle sweep's new skip applies only to `kind === "venue"` rooms, which only
  `create_room` makes;
- `HomePage` reads `?host=` on `/join/{code}`. No standalone link ever has it;
- the ⛶ button is hidden only when `isOnBox`;
- `TvsPanel` renders nothing off a box;
- the three cast intents exist standalone but only answer `enabled: false` / `ok: false`.

**Verified:**
- **Tests:** all 24 pre-Bar-Games tests pass unchanged (40 in total).
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
   be a different, live process (here the dev site). It got a harmless 404, but a
   `--game` default taken from the running `mock-box`, or a warning when the target
   doesn't serve `/__bargames/*`, would be safer.
2. **Derived theme tokens.** Games have more chrome shades than the five colors: Bingo has
   `--panel-2`, `--line` and `--muted`, which stay navy on a teal venue. Standalone-safe
   `--venue-surface-2`, `--venue-border` and `--venue-muted`, computed by the box from
   the venue colors, would let them follow.
3. **An "on-primary" text color** (`--venue-primary-ink`). Bingo's primary buttons use a
   fixed dark ink, so a dark venue primary would give poor button contrast.
4. **Room persistence:** rooms are in memory, so a box-initiated container restart (an
   update, or the memory limit) closes every room. A `room_closed` with
   `reason: "shutdown"` is sent first. With `create_room`, the box can now re-create a
   venue room after a restart, but it gets a new code. The box would need to re-cast it,
   and players would have to rejoin.
5. ~~A `create` command~~: done in SDK 0.2.0 (`create_room`); implemented above.
6. **Casting in `mock-box`.** The mock core returns 404 for `/internal/displays`, so
   `displays()` is `enabled: false` and a game's casting UI can't be seen or exercised
   against it. Fake TVs (one free, one busy, one that `needsCode`), a fixed PIN, and an
   `npx bargames check` step that calls the game's cast path would close that gap.
7. **A command to resolve claims**, or a documented answer. A valid BINGO pauses Bingo
   until a host confirms or dismisses it. With a venue room run only from the iPad's box
   UI (without opening `hostUrl`), nothing can resolve it. `resume` restarts calling but
   leaves the claim on the TV. A generic `resolve`/`dismiss` command, or the box UI
   pointing staff to `hostUrl` when a `claim_pending` event arrives, would cover it.
8. **`hostUrl` is a bearer link.** Bingo's carries the venue room's host-seat token. Please
   confirm the box shows it only to admins and never logs or exports it (the SDK
   comment says so; worth stating in the guide's security notes).
