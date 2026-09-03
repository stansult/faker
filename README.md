# Faker

Faker is a browser party word game for 3-20 players. Legit players share a secret word and give one-word clues without revealing it; one faker does not know the word and has to bluff. After the clue rounds, players vote. Legit players win only if every legit player votes out the faker; otherwise the faker wins.

Live site: https://play-faker.us

## Current State

- Single-page frontend in `index.html`, `app.js`, and `styles.css`.
- Netlify Functions backend in `netlify/functions`.
- Room state is stored in Netlify Blobs.
- Debug tools and request logs are available with `?debug=1`.
- Languages: English and Russian word validation.
- Match flow: create/join room, submit words, host starts game, players submit moves in turn order, voting resolves the game, scores persist across the match.
- Host can short-start game 1 with current players if at least 3 players are ready.
- Match-ended rooms are read-only result pages by room code.
- Active non-ended rooms expire after 24 hours without meaningful updates and return `410 Room expired`.

## Architecture

Frontend:
- `index.html` defines the lobby, room, game, voting, overlay, and debug views.
- `app.js` owns client state, localStorage identity, polling, rendering, validation, and all API calls.
- `styles.css` owns layout and responsive table behavior.
- `validationConstants.js` is generated for browser use.
- `uiErrors.js` contains shared client-only error strings.

Backend:
- `netlify/functions/*.js` are ES modules.
- `netlify/functions/package.json` sets `"type": "module"`.
- `shared/validationConstants.cjs` is the source for shared validation and timing constants. It is CommonJS because Netlify bundling previously had issues requiring a shared ESM constants file.
- `netlify/functions/roomExpiry.js` enforces active-room expiry.
- `netlify/functions/_vote.js` contains shared voting helpers and voting timer configuration.

Storage:
- Netlify Blobs store room records in `faker-rooms`.
- Room writes update `updatedAt`; polling/status reads do not.
- Expiry is an access rule, not physical deletion. Cleanup can be added separately later.

## Key Rules

- Room codes are 6 characters.
- Names are capped at 24 characters.
- Submitted words and moves are capped at 50 characters.
- Active non-ended rooms expire after 24 hours from `updatedAt || createdAt`.
- Rooms without timestamps are treated as expired unless `matchEnded` is true.
- Match-ended rooms remain readable by room code.
- Mutating endpoints reject match-ended rooms.
- Local saved room identity and draft words expire after the same 24-hour active room TTL.
- Leaving a match-ended room only clears local active identity; it does not mutate backend results.

## API Surface

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

## Local Dev

Install dependencies:

```bash
npm install
```

Run the site and Netlify Functions locally:

```bash
npm run dev
```

Open:

```text
http://localhost:8888
```

For other devices on the same Wi-Fi:

```bash
npm run dev:lan
```

It prints:

```text
http://<your-mac-ip>:8888
```

For mobile HTTPS testing through Cloudflare Tunnel:

```bash
npm run dev:live
```

Open:

```text
https://dev.play-faker.us
```

This assumes a named Cloudflare tunnel `faker-dev` mapped to `dev.play-faker.us`:

```bash
cloudflared tunnel route dns faker-dev dev.play-faker.us
```

Or a Cloudflare DNS CNAME:

```text
dev -> <tunnel-id>.cfargotunnel.com
```

Use a different local tunnel name with:

```bash
FAKER_TUNNEL_NAME=your-tunnel npm run dev:live
```

## Dev Overrides

Local dev uses longer voting timers by default:

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

## Build Constants

Generate browser constants:

```bash
npm run build:constants
```

This writes `validationConstants.js` from `shared/validationConstants.cjs`, applying environment overrides for values that should differ in dev, such as voting timers.

## Build Version

The footer badge fetches `build.txt` and displays:

```text
v1.0 • build <timestamp> <short-sha>
```

`scripts/update_build.sh` updates `build.txt` and refreshes cache-buster query strings in `index.html` for changed frontend assets.

This repo uses a pre-commit hook:

```text
.githooks/pre-commit
```

The hook runs:

```bash
sh ./scripts/update_build.sh
node --check app.js
for f in netlify/functions/*.js scripts/*.mjs tests/*.mjs tests/helpers/*.mjs; do node --check "$f"; done
npm test
```

The build update script stages generated changes to `build.txt` and, when frontend
assets changed, the cache-buster updates in `index.html`.

The pre-push hook runs the local API regression suite:

```bash
npm run test:api
```

This starts `netlify dev --offline` on localhost and requires local `netlify` and
`python3` commands. It does not call the deployed site or other external APIs.

The repo is configured with:

```bash
git config core.hooksPath .githooks
```

## Production Deployment

Production is hosted on Netlify:

```text
https://faker-game.netlify.app/
```

The public domain is:

```text
https://play-faker.us
```

Cloudflare DNS for `play-faker.us`:

```text
@   CNAME   faker-game.netlify.app   DNS only
www CNAME   faker-game.netlify.app   DNS only
```

Keep these DNS records unproxied unless Cloudflare proxying is intentionally configured and tested with Netlify SSL.

## Itch.io Build

Generate a static itch.io build that points to the production backend:

```bash
npm run build:itch
```

This creates `./itch/` with frontend-only files and rewrites API calls to:

```text
https://play-faker.us/.netlify/functions/
```

`itch/` is generated output and is gitignored.

## Validation

Run the fast regression tests:

```bash
npm test
```

Lightweight syntax checks:

```bash
node --check app.js
for f in netlify/functions/*.js scripts/*.mjs tests/*.mjs tests/helpers/*.mjs; do node --check "$f"; done
```

Run the local API smoke test:

```bash
npm run test:api
```

`test:api` starts `netlify dev --offline` on localhost-only test ports. It covers room validation, join/rejoin and roster locking, turn and clue rules, voting through match completion, ended-room mutation rejection, result viewing by room code, and an HTTP-level expired-room check.

The smoke test refuses non-local API hosts unless `ALLOW_NON_LOCAL_TEST_API=1` is set.

The test runner is dependency-free and lives in `tests/run.mjs`.

## Generated / Local Files

Gitignored:

- `.netlify/`
- `node_modules/`
- `screenshots/`
- `notes/`
- `itch/`

`notes/` contains local handoff/testing notes and is not intended for public repo documentation.
