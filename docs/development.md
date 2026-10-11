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
- Expiry is an access rule, not physical deletion. Cleanup can be added
  separately later.

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
