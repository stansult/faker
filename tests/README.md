# Testing

Faker has three primary local test commands. None of them call the deployed site
or other external APIs. Individual test types within those commands are described
below.

## Primary test commands

| Command | Coverage | Platform |
| --- | --- | --- |
| `npm test` | 10 game-logic tests, 4 room-store adapter tests, 9 change-scope tests, and 4 deployment-safety tests | Node.js built-in assertions and test runners |
| `npm run test:api` | 6 room lifecycle and complete gameplay workflows | Local `netlify dev --offline`, Netlify Functions and Blobs |
| `npm run test:ui` | 13 browser scenarios producing 20 profile-specific executions across room setup, gameplay, voting, and match results | Playwright Chromium: Desktop Chrome and emulated Pixel 7 |

Local runtime varies with Netlify cold startup. The API suite commonly takes
about 30–90 seconds; the two-project UI suite commonly takes about 70–90 seconds,
including one shared Netlify startup.

## How each test type works

### Pure game-logic tests

`roomCode.test.mjs`, `roomExpiry.test.mjs`, and `vote.test.mjs` call exported
helpers directly with Node.js strict assertions. The dependency-free `run.mjs`
loader imports each requested file, executes its registered tests sequentially,
and runs per-test cleanup callbacks. These tests need no browser, server, Blob
store, or network access and run through `npm run test:logic`.

### Room-store adapter contract tests

`blobConsistency.test.mjs` exercises the room-store adapter with injected fake
Netlify dependencies. It verifies local sandbox selection, strongly consistent
deployed access, and fail-closed credential handling. It also scans every room
Function to ensure all storage access goes through the central adapter. These
tests use the same lightweight runner and are included in `npm run test:logic`.

### Change-scope tests

`scripts/change-scope.test.cjs` verifies the conservative Markdown-only classifier,
its NUL-delimited command-line interface, the hook configuration, and the hosted
workflow contract. Temporary Git repositories execute both hooks to prove that
documentation changes skip tests while mixed and multi-ref changes do not. These
tests use Node.js's built-in `node:test` runner and run through
`npm run test:deployment` as part of the fast tooling suite.

### Deployment-safety tests

`scripts/deployment-safety.test.cjs` uses Node.js's built-in `node:test` runner
and a fake GitHub API client. It verifies that only the current tested `main` tip
can deploy, lookup failures stop deployment, and the workflow is bound to the
environment that owns the Netlify secrets. Run them with
`npm run test:deployment`; `npm test` combines them with the logic tests.

### Local API integration tests

`api.smoke.test.mjs` sends real HTTP requests through local Netlify Functions and
the local Blob sandbox. For each workflow, `helpers/netlifyDev.mjs` creates an
isolated temporary project, reserves ports, starts `netlify dev --offline`, and
removes the project after the test. The workflows cover validation, room
lifecycle, lobby edits and membership permissions, gameplay rules, single-game and
multi-game completion, score and starter continuity, post-match immutability across
every mutating room endpoint, and expiration through `npm run test:api`.

Playwright's API client is intentionally not used for these API-only workflows.
They do not need browser state, cookies, or coordination with a UI action, so
running them through Playwright would add runner coupling without increasing the
behavior covered. The direct Node.js HTTP client keeps this suite independent of
browser installation and focused on Functions, Blob persistence, and response
contracts. Playwright API requests are reserved for hybrid tests, where they make
otherwise expensive browser setup faster while the user action remains in the UI.

### Browser UI tests

Playwright launches Chromium against the real app served by one shared local
Netlify process from `helpers/uiServer.mjs`. Tests run serially so they can share
that server without sharing browser state. Every scenario runs in Desktop Chrome;
tests tagged `@mobile` also run with the Pixel 7 profile. Run the suite with
`npm run test:ui`.

### Hybrid browser/API tests

Hybrid tests use Playwright's `request` fixture against the same base URL as the
browser. API calls prepare supporting multiplayer state quickly, the browser
performs the user action under test, and a final API read verifies the persisted
backend transition. Shared setup in `helpers/playwrightGame.mjs` creates and starts
a three-player game through public Functions, discovers randomized roles and turn
order, and restores one prepared player's normal browser identity. It never writes
directly to Blob storage. `start-game.spec.mjs` uses the hybrid pattern to create
the host in the UI, prepare two supporting players and all word submissions through
APIs, start the game in the UI, and confirm the resulting `gameState`. This scenario
is desktop-only because it tests workflow integration rather than responsive layout.
`join-room.spec.mjs` reverses the boundary: APIs create the room and two supporting
players, then the desktop/mobile UI joins the third player and an API read confirms
that the browser action was persisted. `gameplay.spec.mjs` prepares an active game,
then submits a clue or casts a vote in the desktop/mobile UI and verifies the
persisted action through `gameState`. `game-results.spec.mjs` exercises immediate
faker victory, correct and incorrect voting outcomes, role-specific game-over
messaging, and the completed-match summary and leave action.
`lobby-membership.spec.mjs` prepares complete lobbies through APIs, then verifies
host kick controls, roster renumbering, player leave behavior, and local identity
cleanup through the browser.

### Opt-in deployed smoke tests

`api.remote.test.mjs` can exercise an explicitly approved HTTPS deployment, and
the Playwright suite can be pointed at the same kind of target. Both paths require
an allow flag as well as a target URL, mutate the target by creating rooms, and
are never used by the default local commands. The exact commands and safety
boundary are documented under [Approved remote validation](#approved-remote-validation).

## Browser coverage strategy

Every UI test runs in Desktop Chrome. Tests tagged `@mobile` also run in the
emulated Pixel 7 Mobile Chrome project. This is a deliberate balance: browser
workflows receive a consistent desktop baseline, while mobile execution is
reserved for behavior where viewport, touch, responsive layout, or constrained
space can materially change the result.

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| Create or join a room | Yes | Yes |
| Submit a move | Yes | Yes |
| Voting controls and layout | Yes | Yes |
| Overlays, tables, and overflow-sensitive UI | Yes | Yes |
| Multiplayer setup performed mainly through APIs | Yes | No |
| Backend persistence verification | Yes | No |
| Expiration or API error response logic | Yes | Only when presentation differs |

Add `{ tag: "@mobile" }` to a Playwright test when it belongs in the mobile
subset. Mobile runs are emulated Chromium tests, not physical-device tests.

### Current browser coverage

This table is an inventory of implemented, passing browser tests. Planned
coverage belongs in the issue tracker, not here. Update the table whenever a
browser scenario is added, removed, or materially changed.

| # | Scenario | Browser action | API role | Profiles |
| ---: | --- | --- | --- | --- |
| 1 | Host creates a room and reaches the lobby | Enters the host name and room settings, creates the room, and verifies the lobby | None | Desktop, Mobile |
| 2 | Player joins a prepared three-player room | Enters a name and room code, joins, and verifies the lobby | Creates the room and two supporting players, then verifies room state | Desktop, Mobile |
| 3 | Host kicks a player from the lobby | Confirms a kick, verifies host-only controls, and observes roster renumbering | Prepares the lobby and verifies persisted membership | Desktop |
| 4 | Player leaves the lobby | Confirms leaving, returns to the entry screen, and verifies local identity cleanup | Prepares the lobby and verifies persisted membership | Desktop, Mobile |
| 5 | Host starts a prepared three-player game | Verifies ready players and starts the game | Joins players, prepares words, and verifies game state | Desktop |
| 6 | Player submits and locks their words | Enters the required words, confirms the lock, and verifies ready status | None | Desktop, Mobile |
| 7 | Active player submits a clue | Verifies role information and submits the current turn's clue | Prepares the game and verifies the persisted move | Desktop, Mobile |
| 8 | Player casts a vote | Selects another player and verifies the selected-vote UI | Prepares active voting and verifies the persisted vote | Desktop, Mobile |
| 9 | Voting countdown resolves promptly | Verifies the voting alert starts, reaches zero, stops pulsing, and shows the result | Starts voting and relies on the timer-driven state refresh to resolve it | Desktop |
| 10 | Faker says the secret word | Submits the secret word on the faker's turn and verifies the immediate-win message | Prepares the game, discovers the faker, advances the turn, and verifies the result | Desktop |
| 11 | Legit players win the vote | Casts a correct vote and verifies the role-specific winning message | Prepares voting, supplies the supporting votes, and verifies resolution | Desktop |
| 12 | Faker wins after an incorrect vote | Casts an incorrect vote and verifies the role-specific losing message | Prepares voting, supplies the supporting votes, and verifies resolution | Desktop |
| 13 | Player reviews and leaves a completed match | Verifies scores, placement, self-row, and leaves from the match summary | Completes the match and verifies persisted scores | Desktop, Mobile |

- **Desktop:** Playwright's Desktop Chrome profile.
- **Mobile:** Playwright's emulated Pixel 7 Mobile Chrome profile.

## Setup and commands

Install project dependencies and the Playwright Chromium binary:

```bash
npm install
npx playwright install chromium
```

Run each suite independently:

```bash
npm test
npm run test:api
npm run test:ui
```

The API and UI suites require local `netlify` and `python3` commands. They create
temporary project directories, allocate or reserve localhost ports, start isolated
Netlify servers, and clean them up after each suite.

Run syntax checks with:

```bash
npm run check:syntax
```

## Hosted checks

`.github/workflows/test.yml` runs syntax, logic, deployment-safety, API, and UI
tests on pushes and pull requests to `main`, then verifies the allowlisted Netlify
artifact can be built. Markdown-only pushes are ignored, so they neither run CI nor
deploy. Mixed pushes always follow the normal workflow. On eligible pushes to
`main`, the deploy job runs only after the test job passes, publishes to the
production Netlify project, and records the production deployment in GitHub. Pull
requests never receive deployment secrets or deploy. See the
[deployment guide](../docs/deployment.md).

## Git hooks

Git uses the tracked hooks in `.githooks` through:

```bash
git config core.hooksPath .githooks
```

For Markdown-only changes, pre-commit runs `git diff --cached --check` and pre-push
performs no tests. A change is Markdown-only only when the detected file list is
non-empty and every path ends in `.md`; uncertainty and mixed changes fail closed
to the normal test path. For all other changes, pre-commit updates build metadata,
runs syntax checks, and runs all logic and deployment-safety tests through
`npm test`; pre-push runs `npm run test:api`. The Playwright suite remains an
explicit command.

## Structure

- `run.mjs` and `helpers/testHarness.mjs` provide the lightweight logic/API runner.
- `api.smoke.test.mjs` contains the local HTTP workflow tests.
- `api.remote.test.mjs` contains the explicitly enabled deployed workflow test.
- `blobConsistency.test.mjs` verifies local/deployed adapter selection, fail-closed credential
  handling, and adoption by every room Function.
- `helpers/netlifyDev.mjs` manages isolated offline Netlify processes.
- `helpers/uiServer.mjs` adapts that server lifecycle for Playwright.
- `helpers/playwrightGame.mjs` prepares reusable multiplayer game state for hybrid tests.
- `ui/` contains browser tests configured by `../playwright.config.mjs`.
- `../scripts/change-scope.cjs` is the shared fail-closed classifier used by Git hooks.

The API client rejects non-local hosts by default. Production verification should
use a separately designed, explicitly approved smoke test rather than repointing
these state-mutating workflows.

## Approved remote validation

Release validation can target an explicitly approved HTTPS deploy.
These commands mutate the target by creating test rooms, so neither is part of the
default test commands:

```bash
ALLOW_NON_LOCAL_TEST_API=1 \
FAKER_TEST_BASE_URL=https://approved-deploy.example \
npm run test:api:remote

ALLOW_NON_LOCAL_TEST_UI=1 \
FAKER_UI_BASE_URL=https://approved-deploy.example \
npm run test:ui
```

The remote API smoke test validates static delivery, input validation, room setup,
Blob-backed state, role assignment, turn progression, immediate match resolution,
result reads by room code, and ended-room mutation rejection. Timing-dependent
expiration and voting-resolution coverage remains in the isolated local suite,
where each test can safely use its own clock-related environment overrides.
