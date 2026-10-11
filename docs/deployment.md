# Test-Gated Netlify Deployment

Faker deploys to Netlify through a GitHub Actions test gate. GitHub environment
secrets identify and authorize the production project; Netlify's independent Git
builds remain disabled so the tested workflow is the only normal deployment path.

## Production endpoints

Production is hosted on Netlify at `https://faker-game.netlify.app/`. The public
site is `https://play-faker.us`.

Cloudflare DNS for `play-faker.us`:

```text
@   CNAME   faker-game.netlify.app   DNS only
www CNAME   faker-game.netlify.app   DNS only
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
