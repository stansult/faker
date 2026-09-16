# Test-Gated Netlify Deployment

Faker is migrating from Netlify's independent Git deployment to a GitHub Actions
test gate. The repository contains the tested workflow, production artifact
builder, and a prepared deploy job. GitHub Actions does not yet have deployment
credentials, and the deploy job must not be pushed until the account migration
gates below are approved and coordinated.

## Intended flow

Pushes and pull requests to `main` run syntax checks, logic and deployment-safety
tests, local API workflows, Playwright UI tests, and the production artifact
build. Pull requests never deploy. On an eligible `main` run, the deploy job waits
for every test, confirms the tested commit is still the branch tip, rebuilds the
allowlisted artifact from that commit, publishes through the pinned Netlify CLI,
and records the production deployment in GitHub.

The production artifact is built in `dist/netlify-deploy/`:

- `site/` contains an explicit allowlist of public static files.
- `netlify/functions/` contains the function sources.
- `shared/` preserves the shared constants path required while bundling functions.

Build it locally with:

```bash
npm run build:netlify
```

Generated artifacts are ignored by Git.

Room Functions use `netlify/functions/_roomStore.js` for storage access. Netlify Dev
uses its sandboxed Blob endpoint. Deployed Functions use the runtime-provided site ID
and token through Netlify's strongly consistent API path. This prevents a successful
write from being followed by a stale room read. Runtime credentials must never be
returned or logged. See [issue #16](https://github.com/stansult/faker/issues/16).

## Migration gates

Complete these gates in order. Do not disable the current Netlify deployment
until the replacement path has been verified.

1. Confirm the test-only hosted workflow passes. Completed by Actions run
   `35072568857` on September 16, 2026.
2. Create and verify the replacement project in the legacy team. Completed with
   project `faker-game-legacy`, ID `16b3daa3-6675-46b3-9f49-0afe6373c1b8`.
3. Create a non-production draft from the allowlisted artifact and verify the static
   app, complete remote API workflow, and desktop/mobile UI. Completed with deploy
   `6aaa6e53b83fb8e9c6d502de` on September 16, 2026.
4. Add `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` as GitHub environment secrets only
   after reviewing the token's account authority and storage boundary.
5. Stop the credit-based project's independent Git builds while leaving its current
   production deploy live for rollback.
6. Push the prepared deploy job to `main`.
7. Run the first test-gated production deployment to the legacy project and verify
   its Netlify URL.
8. Move `play-faker.us` only after the legacy production deploy passes verification,
   then verify the public domain, core API flow, and GitHub deployment record.

Each account or production change requires explicit approval immediately before
it is performed.

## Recovery

Until migration is complete, Netlify's existing Git integration remains the
production owner. After migration, a failed test or deploy must leave the last
successful production deployment live. Recovery options must include rerunning a
failed workflow after correction and restoring a previously verified Netlify
deployment. Manual production uploads should not be mixed with workflow-owned
deployment records except during an explicitly documented recovery.

The deploy job uses `NETLIFY_AUTH_TOKEN` only in secret validation and the publish
step. It uses `NETLIFY_SITE_ID` only to select the existing site. Workflow source
must never print either value, and pull-request jobs receive neither secret.
