# Test-Gated Netlify Deployment

Faker deploys to Netlify through a GitHub Actions test gate. GitHub environment
secrets identify and authorize the production project. That project is not
Git-connected, so the tested workflow is the only normal deployment path.

## Netlify account ownership

The active production target is the legacy-account project `faker-game-legacy`
(site ID `16b3daa3-6675-46b3-9f49-0afe6373c1b8`). The protected GitHub
environment `netlify-production` deploys to this project, whose public Netlify
hostname is `faker-game-legacy.netlify.app`.

The former project in the credit-based Netlify account is retained only as a
rollback option at `faker-game.netlify.app`; its independent Git builds are
stopped and it is not a normal deployment target. Changing either account, the
deployment target, credentials, or DNS requires explicit approval.

## Production endpoints

Production is hosted on Netlify at `https://faker-game-legacy.netlify.app/`.
The public site is `https://play-faker.us`.

Cloudflare DNS for `play-faker.us`:

```text
@   CNAME   faker-game-legacy.netlify.app   DNS only
www CNAME   faker-game-legacy.netlify.app   DNS only
```

Keep these DNS records unproxied unless Cloudflare proxying is intentionally
configured and tested with Netlify SSL.

## Intended flow

Non-documentation pushes and all pull requests to `main` run syntax checks, logic
and deployment-safety tests, local API workflows, Playwright UI tests, and the
production artifact build. Documentation-only pushes are ignored and do not deploy;
this includes Markdown anywhere in the repository and supported image assets under
`docs/`. Mixed or unrecognized changes always use the full gate. Pull requests never
deploy. On an eligible
`main` run, the deploy job waits for every test, confirms the tested commit is still
the branch tip, generates build metadata from that exact commit, rebuilds the
allowlisted artifact, and publishes through the pinned Netlify CLI. A dedicated
Playwright check then verifies that the live `build.txt` and visible footer show
the deployed commit SHA and a UTC timestamp before the workflow records a successful
production deployment in GitHub.

The production artifact is built in `dist/netlify-deploy/`:

- `site/` contains an explicit allowlist of public static files.
- `netlify/functions/` contains the function sources.
- `shared/` preserves the shared constants path required while bundling functions.

The build generates the browser's production `validationConstants.js` directly
inside `site/` from `shared/validationConstants.cjs`; it does not depend on or
modify a working-tree copy.

Build it locally with:

```bash
npm run build:netlify
```

Generated artifacts are ignored by Git.

`scripts/write_build_info.sh` requires `COMMIT_REF`; the workflow supplies
`${{ github.sha }}` rather than deriving a commit during pre-commit. This ensures
the footer identifies the deployed commit instead of its parent. Run the read-only
live verification explicitly with:

```bash
PRODUCTION_URL=https://play-faker.us \
DEPLOY_SHA=<full-deployed-commit-sha> \
npm run verify:deploy
```

Room Functions use `netlify/functions/_roomStore.js` for storage access. Netlify Dev
uses its sandboxed Blob endpoint. Deployed Functions use the runtime-provided site ID
and token through Netlify's strongly consistent API path. This prevents a successful
write from being followed by a stale room read. Runtime credentials must never be
returned or logged. See [issue #16](https://github.com/stansult/faker/issues/16).

Account, credential, billing, and production configuration changes require explicit
approval immediately before they are performed.

## Scheduled cleanup activation

The deployment includes `cleanupRooms`, scheduled in `netlify.toml` at 04:00 UTC
daily. Netlify runs scheduled functions only on published deploys, not
automatically on previews or local development. The daily invocation reads a due
date; room scanning follows the adaptive policy in the
[development guide](development.md#abandoned-room-cleanup).

1. Publish through the normal tested workflow only after deployment approval.
   With no opt-in, the function performs dry-run scans and never deletes rooms.
2. With approval, use the Netlify Functions dashboard's **Run now** action and
   inspect the aggregate summary. Review eligible, invalid, and failed counts.
   Do not enable deletion while the scan is incomplete or there are unexplained
   failures or skipped records.
3. Obtain separate explicit approval to set `ROOM_CLEANUP_DELETE_ENABLED=1` in the
   production Function environment, applying the environment change according
   to Netlify's deployment requirements.
4. Invoke the activated function only with approval, inspect the deletion summary,
   and confirm that completed results remain readable and the due date was saved.

On the legacy account's current plan, function-only variable scopes are not
available. Use **All scopes** with a value of `1` only in the **Production**
deploy context; leave other contexts unset. This non-secret flag is read only
by cleanup. Do not upgrade the plan to obtain narrower scopes. Verify the saved
value in the dashboard or CLI before starting the test-gated redeployment;
a CLI command completing without an error is not sufficient proof it persisted.

Removing the opt-in stops future deletes; it cannot restore deleted rooms. A run
already in progress retains its initial mode. Keep maintenance state in the
`faker-maintenance` store; do not reset it casually to force a run. Production
triggers are Netlify's scheduler and dashboard invocation, not a public HTTP
cleanup endpoint. Never point local cleanup tests at production.

Reference: [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/).

## Recovery

GitHub Actions is the production deployment owner. A failed test or pre-publish
step leaves the last successful production deployment live. If post-publish
verification fails, the new deploy may already be live but is not recorded as a
successful GitHub deployment; investigate it and either rerun verification after
correction or restore a previously verified production deploy. Manual production
uploads should not be mixed with workflow-owned deployment records except during
an explicitly documented recovery.

The deploy job uses `NETLIFY_AUTH_TOKEN` only in secret validation and the publish
step. It uses `NETLIFY_SITE_ID` only to select the existing site. Workflow source
must never print either value, and pull-request jobs receive neither secret.
