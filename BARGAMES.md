# Bar Games integration: Bingo

**Level reached: 3** (hosted, branded, connected, controllable). SDK 0.1.0, vendored at
`vendor/bargames-sdk-0.1.0.tgz`; manifest at [bargames.json](bargames.json).

```
$ npx bargames validate .
! image: not pinned by digest; releases should use image@sha256:…
✓ bingo@0.1.0 (sdk level 3)

$ npx bargames check . --game http://127.0.0.1:3005
bingo@0.1.0 · level 3 · http://127.0.0.1:3005
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

all checks passed
```

The game ran on port 3005 for these checks because 3002 (the manifest port) is taken on
the dev PC by the live dev site. Inside the container it's 3002, as the manifest says.

## Where things live

| File | What |
|---|---|
| `server/src/bargames.ts` | `bg` (the SDK instance), `clientIp`, `displayName`, `registerBarGames` (commands and status) |
| `server/src/index.ts:35` | `app.use(bg.middleware())`, before `/api` and the SPA catch-all; `/api/config` returns the venue's name on a box; `bg.flush()` on shutdown |
| `server/src/rooms/Room.ts` | `kind: SessionKind` (always `"patron"` today) and the in-game events |
| `server/src/rooms/RoomManager.ts` | `room_created` / `room_closed`, `all()`, and a `CloseCause` on `closeRoom` |
| `client/src/useVenue.ts` | `useVenue()` and `<VenueBranding />` (mounted once in `main.tsx`) |
| `client/src/index.css` (top) | `--venue-*` mapped onto the chrome tokens |
| `test/specs/09-bargames.test.mjs` | Standalone, commands, status, events and rate-limit tests (11 tests) |

## Events

Every event carries `roomCode` and `sessionKind` (`room.kind`). They are fire-and-forget,
and nothing is sent off a box.

| Event | Emitted at | `data` |
|---|---|---|
| `room_created` | `server/src/rooms/RoomManager.ts:35` | none |
| `room_closed` | `server/src/rooms/RoomManager.ts:57` | `{ reason: "host" \| "admin" \| "idle" \| "error" \| "shutdown" }` |
| `players_changed` | `server/src/rooms/Room.ts:176` (debounced from joins, leaves, kicks and the paper-mode switch) | `{ players }`: seated players only. At most one per room per 2 s, only when the count actually changed, never for reconnects. |
| `round_started` | `server/src/rooms/Room.ts:339` (`startGame`) | `{ round, pattern, cardMode }`, e.g. `{ round: 1, pattern: "Any Line", cardMode: "digital" }` |
| `round_ended` | `server/src/rooms/Room.ts:380` (`endGame`, from both "New game" and "End game") | `{ round, calls, winners: string[] }` |
| `claim_pending` | `server/src/rooms/Room.ts:436` (a **valid** BINGO waiting for the host; false claims send nothing) | `{ name }` |
| `winner` | `server/src/rooms/Room.ts:460` (host confirms a claim) | `{ name, round, calls, pattern }` |

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
`players` counts seated players only (no tables or paper-mode viewers).

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
  docker build -t bargames/bingo:dev .
  docker run --rm --read-only --tmpfs /tmp --cap-drop ALL -v bgtest:/data -e PORT=3002 -p 3002:3002 bargames/bingo:dev
  ```
- **Production side effect, handled:** because the image is non-root now,
  `scripts/deploy-prod.sh` does two things on its next run:
  - runs `sudo chown -R 1000:1000 ~/bingo/data` on the VM, because files the old
    root-run image wrote would otherwise block admin saves;
  - ships `vendor/`.

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

**Verified:**
- **Tests:** all 24 existing tests pass unchanged (35 in total).
- **New standalone tests:**
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
   `reason: "shutdown"` is sent first. If the box wants to restore `venue` rooms, the
   protocol would need a "create room" command.
5. **A `create` command** in general: `start` needs an existing room code, and nothing
   on the box can create a Bingo room yet. `kind` is ready for `"venue"` rooms when it
   exists.
