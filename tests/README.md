# Testing

Faker has three local test layers. None of the standard commands call the deployed
site or other external APIs.

## Test suites

| Command | Coverage | Platform |
| --- | --- | --- |
| `npm test` | 10 room-code, expiration, and voting logic tests | Node.js, `node:assert`, dependency-free runner |
| `npm run test:api` | 4 room lifecycle and complete gameplay workflows | Local `netlify dev --offline`, Netlify Functions and Blobs |
| `npm run test:ui` | Room creation through the real UI | Playwright Chromium: Desktop Chrome and emulated Pixel 7 |

The API suite takes about 30 seconds. The two-project UI suite takes about 15
seconds, including one shared Netlify startup.

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
node --check app.js
node --check playwright.config.mjs
for f in netlify/functions/*.js scripts/*.mjs tests/*.mjs tests/helpers/*.mjs tests/ui/*.mjs; do node --check "$f"; done
```

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
