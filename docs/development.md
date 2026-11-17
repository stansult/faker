# Development Guide

This guide contains the implementation and local-development details for
Faker. For the player-facing overview and game rules, see the
[main README](../README.md).

## Project structure

Faker is a single-page frontend backed by Netlify Functions and Netlify Blobs.

Frontend:

- `index.html` defines the lobby, room, game, voting, overlay, and debug views.
- `app.js` owns client state, localStorage identity, polling, rendering,
  validation, and API calls.
- `styles.css` owns layout and responsive table behavior.
- `validationConstants.js` is ignored generated output for browser use.
- `uiErrors.js` contains shared client-only error strings.
- Debug tools and request logs are available with `?debug=1`.

Backend:

- `netlify/functions/*.js` are ES modules.
- `netlify/functions/package.json` sets `"type": "module"`.
- `shared/validationConstants.cjs` is the source for shared validation and
  timing constants. It remains CommonJS because Netlify bundling previously
  had issues requiring a shared ESM constants file.
- `netlify/functions/roomExpiry.js` enforces active-room expiry.
- `netlify/functions/_vote.js` contains shared voting helpers and voting timer
  configuration.
- `netlify/functions/_roomStore.js` centralizes room-store access.

Storage:

- Netlify Blobs store room records in `faker-rooms`.
- Deployed room reads use strong consistency because each player action depends
  on the immediately preceding write. Netlify Dev uses its local sandbox.
- Room writes update `updatedAt`; polling and status reads do not.
- Expiry is an access rule, not physical deletion. Scheduled abandoned-room
  cleanup is a separate maintenance task, described below.

## Abandoned-room cleanup

`cleanupRooms` is a scheduled Netlify Function. Its daily heartbeat runs at
04:00 UTC; the persisted due date determines whether it actually scans rooms.
No scan is performed on a not-due invocation. The initial invocation is due
immediately, with a monthly starting cadence.

The cleanup policy is separate from the 24-hour play expiry:

- Only non-ended rooms with more than seven days of inactivity are eligible.
- Activity uses `updatedAt`, falling back to `createdAt` when absent.
- Completed matches are never deleted, including old results without timestamps.
- Malformed JSON, invalid room keys, mismatched room codes, unknown match status,
  and missing, invalid, future, or conflicting timestamps are skipped and counted.
- The room is reread immediately before deletion. Missing ETags, a different
  ETag, changed content, or changed eligibility cause it to be skipped.

The installed Blob SDK does not provide conditional deletion. Rereading reduces
but does not eliminate a race with an in-flight write or administrative edit.
Ordinary gameplay is already rejected for these rooms by the 24-hour expiry.
This is a conservative safeguard, not an atomic deletion guarantee.

### Adaptive cadence and measurements

Intervals are elapsed UTC durations, not calendar boundaries: weekly is seven
days, monthly is 30 days, and quarterly is 90 days. The next date is calculated
from successful scan completion.

| Complete scan outcome | Next cadence |
| --- | --- |
| More than 1,000,000 eligible bytes | Weekly; reset low-volume streaks |
| Two consecutive weekly scans at or below that threshold | Monthly; start a fresh empty-scan streak |
| Two consecutive empty monthly scans | Quarterly |
| Quarterly scan with any eligible rooms, at or below the threshold | Monthly |
| Empty quarterly scan | Remain quarterly |

All other outcomes retain the current cadence. Completed-result storage does not
accelerate cleanup. Changed candidates skipped before deletion do not count as
eligible data. Bytes are UTF-8 JSON payload bytes, not provider billing totals.

Maintenance state lives under `room-cleanup-v1` in the separate
`faker-maintenance` Blob store. It holds cadence, streaks, due date, aggregate
statistics, and any unfinished scan's processed room keys. Conditional writes
acquire a five-minute lease to avoid overlapping deletion runs. An expired lease
can be recovered; invalid maintenance state fails closed.

Scans use SDK pagination and a 20-second cooperative time budget, leaving room
under Netlify's scheduled-function limit for a checkpoint. An unfinished scan
restarts listing on the next daily invocation, skips already processed keys, and
uses its original eligibility cutoff. Failed reads or deletes remain retryable.
Neither partial scans nor failures advance the cadence or empty-scan streak.
The budget is checked between storage calls; a slow individual call or a hard
platform timeout can still interrupt a run. A lost checkpoint can cause some
records or counts to be revisited, but completed results remain protected.

Aggregate logs contain scanned/eligible/deleted counts and bytes, retained,
completed, invalid, changed, missing and failed counts, cadence, and next due date.
They do not include room keys, player names, words, or credentials. The remaining
measured bytes describe only records scanned, not an atomic storage-wide total.

### Dry-run and local invocation

Deletion is disabled unless `ROOM_CLEANUP_DELETE_ENABLED` is exactly `1`.
Without it, due invocations scan and log candidates but change neither rooms nor
maintenance state. With no saved due date, this means daily dry-run previews
until deletion is explicitly activated; previews do not establish cadence streaks.

For a local dry-run:

```bash
npm run dev
# In another terminal, while that server is running:
netlify functions:invoke cleanupRooms
```

To exercise deletion locally, start a separate sandbox with
`ROOM_CLEANUP_DELETE_ENABLED=1 npm run dev`, then invoke the same function.
Local Netlify does not execute cron schedules automatically. In local HTTP tests,
Netlify replaces a scheduled function's response with explanatory text; the
structured summary is in the function logs, not its HTTP body.

Production activation and verification require separate explicit approval; see
the [deployment guide](deployment.md). Retention and cadence are Faker product
policies, not a shared cross-project engineering workflow.

## Technical room rules

- Room codes are 6 characters.
- Names are capped at 24 characters.
- Submitted words and moves are capped at 50 characters.
- Active non-ended rooms expire after 24 hours from
  `updatedAt || createdAt`.
- Rooms without timestamps are treated as expired unless `matchEnded` is true.
- Match-ended rooms remain readable by room code.
- Mutating endpoints reject match-ended rooms.
- Before the first game, the host can lock the roster and start with the
  currently joined players when at least three players are ready.
- Local saved room identity and draft words expire after the same 24-hour
  active-room TTL.
- Leaving a match-ended room only clears local active identity; it does not
  mutate backend results.

## API surface

Main room endpoints:

- `createRoom`
- `joinRoom`
- `roomStatus`
- `leaveRoom`
- `kickPlayer`

Word setup:

- `submitWords`
- `updateWords`
- `markWordsDone`

Gameplay:

- `startGame`
- `getRole`
- `gameState`
- `submitMove`

Voting:

- `triggerVote`
- `castVote`

Debug/helper:

- `claimPlayer`

All endpoints are under:

```text
/.netlify/functions/<name>
```

## Local development

Install dependencies:

```bash
npm install
```

Run the site and Netlify Functions locally:

```bash
npm run dev
```

Open `http://localhost:8888`.

### Other devices on the same network

```bash
npm run dev:lan
```

The command prints `http://<your-mac-ip>:8888`.

### Mobile HTTPS through Cloudflare Tunnel

```bash
npm run dev:live
```

Open `https://dev.play-faker.us`.

This assumes a named Cloudflare tunnel `faker-dev` mapped to
`dev.play-faker.us`:

```bash
cloudflared tunnel route dns faker-dev dev.play-faker.us
```

Alternatively, use a Cloudflare DNS CNAME:

```text
dev -> <tunnel-id>.cfargotunnel.com
```

Use a different local tunnel name with:

```bash
FAKER_TUNNEL_NAME=your-tunnel npm run dev:live
```

## Development overrides

Local development uses longer voting timers by default:

- `VOTE_TOTAL_SECONDS=300`
- `VOTE_FINAL_SECONDS=10`

Production defaults from `shared/validationConstants.cjs` are:

- `VOTE_TOTAL_SECONDS=30`
- `VOTE_FINAL_SECONDS=5`

Override room expiry locally:

```bash
ROOM_ACTIVE_TTL_HOURS=0.01 npm run dev
```

`0.01` hours is about 36 seconds.

## Generated browser constants

```bash
npm run build:constants
```

This writes the ignored local `validationConstants.js` from
`shared/validationConstants.cjs`, applying environment overrides for values
that should differ in development, such as voting timers. The supported
`npm run dev`, `npm run dev:lan`, and `npm run dev:live` entry points generate
it automatically.

Production and Itch builds generate their own production copy directly inside
the output artifact. Playwright and local API workflows generate an isolated
copy for each temporary Netlify project using that server's configured timers.
None of those paths requires or modifies the working-tree file.

## Build version

The footer badge fetches `build.txt` and displays:

```text
v1.0 • build <UTC timestamp> <deployed-short-sha>
```

`build.txt` is ignored generated output. During deployment,
`scripts/write_build_info.sh` requires the workflow's exact `github.sha` and
writes the UTC timestamp and short commit SHA before the production artifact is
built. Local development shows the `(local)` fallback when the file is absent.

The pre-commit hook separately runs `scripts/update_cache_busters.sh` and stages
updated query strings in `index.html` when `app.js`, `styles.css`, `uiErrors.js`,
or the shared validation constants change. Cache busting does not determine the
footer's deployed commit identity.

## Production artifact

Build the allowlisted Netlify production artifact with:

```bash
npm run build:netlify
```

See the [deployment guide](deployment.md) for its structure and the test-gated
production workflow.

## Itch.io build

Generate an upload-ready itch.io ZIP that points to the production backend:

```bash
npm run build:itch
```

This creates `./dist/faker-itch.zip` with `index.html` at the archive root and
rewrites API calls to:

```text
https://play-faker.us/.netlify/functions/
```

The command uses temporary staging and removes it after packaging. `dist/` is
generated output and is gitignored. Packaging requires the standard `zip`
command available in the local environment.

## Generated and local files

These paths are gitignored:

- `.netlify/`
- `node_modules/`
- `screenshots/`
- `notes/`
- `validationConstants.js`
- `dist/`

`notes/` contains local handoff and testing notes; it is not public repository
documentation.
