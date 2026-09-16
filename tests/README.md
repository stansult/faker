# Testing

Faker has three local test layers. None of the standard commands call the deployed
site or other external APIs.

## Test suites

| Command | Coverage | Platform |
| --- | --- | --- |
| `npm test` | 10 room-code, expiration, and voting logic tests | Node.js, `node:assert`, dependency-free runner |
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

`.github/workflows/test.yml` runs syntax, logic, API, and UI tests on pushes and
pull requests to `main`, then verifies the allowlisted Netlify artifact can be
built. The workflow is currently test-only and has no production credentials.
See the [deployment migration guide](../docs/deployment.md).

## Git hooks

Git uses the tracked hooks in `.githooks` through:

```bash
git config core.hooksPath .githooks
```

Pre-commit updates build metadata, runs syntax checks, and runs `npm test`.
Pre-push runs `npm run test:api`. The Playwright suite remains an explicit command.

## Structure

- `run.mjs` and `helpers/testHarness.mjs` provide the lightweight logic/API runner.
- `api.smoke.test.mjs` contains the local HTTP workflow tests.
- `helpers/netlifyDev.mjs` manages isolated offline Netlify processes.
- `helpers/uiServer.mjs` adapts that server lifecycle for Playwright.
- `ui/` contains browser tests configured by `../playwright.config.mjs`.

The API client rejects non-local hosts by default. Production verification should
use a separately designed, explicitly approved smoke test rather than repointing
these state-mutating workflows.
