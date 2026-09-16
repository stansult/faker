# Testing

Faker has three local test layers. None of the standard commands call the deployed
site or other external APIs.

## Test suites

| Command | Coverage | Platform |
| --- | --- | --- |
| `npm test` | 10 game-logic tests, 4 room-store adapter tests, and 4 deployment-safety tests | Node.js built-in assertions and test runners |
| `npm run test:api` | 4 room lifecycle and complete gameplay workflows | Local `netlify dev --offline`, Netlify Functions and Blobs |
| `npm run test:ui` | Room creation through the real UI | Playwright Chromium: Desktop Chrome and emulated Pixel 7 |

Local runtime varies with Netlify cold startup. The API suite commonly takes
about 30–90 seconds; the two-project UI suite commonly takes about 15–30 seconds,
including one shared Netlify startup.

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
artifact can be built. A prepared deploy job remains local until the credential,
draft-deploy, and Netlify ownership gates are approved. See the
[deployment migration guide](../docs/deployment.md).

## Git hooks

Git uses the tracked hooks in `.githooks` through:

```bash
git config core.hooksPath .githooks
```

Pre-commit updates build metadata, runs syntax checks, and runs all logic and
deployment-safety tests through `npm test`.
Pre-push runs `npm run test:api`. The Playwright suite remains an explicit command.

## Structure

- `run.mjs` and `helpers/testHarness.mjs` provide the lightweight logic/API runner.
- `api.smoke.test.mjs` contains the local HTTP workflow tests.
- `api.remote.test.mjs` contains the explicitly enabled deployed workflow test.
- `blobConsistency.test.mjs` verifies local/deployed adapter selection, fail-closed credential
  handling, and adoption by every room Function.
- `helpers/netlifyDev.mjs` manages isolated offline Netlify processes.
- `helpers/uiServer.mjs` adapts that server lifecycle for Playwright.
- `ui/` contains browser tests configured by `../playwright.config.mjs`.

The API client rejects non-local hosts by default. Production verification should
use a separately designed, explicitly approved smoke test rather than repointing
these state-mutating workflows.

## Approved remote validation

Migration and release validation can target an explicitly approved HTTPS deploy.
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
