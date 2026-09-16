# Test-Gated Netlify Deployment

Faker is migrating from Netlify's independent Git deployment to a GitHub Actions
test gate. The repository currently contains the test workflow and production
artifact builder, but GitHub Actions does not yet have deployment credentials and
does not deploy production.

## Intended flow

Pushes and pull requests to `main` run syntax checks, logic tests, local API
workflows, Playwright UI tests, and the production artifact build. Pull requests
never deploy. After the hosted test workflow is proven stable, a separate deploy
job will be allowed to publish a tested `main` commit only when it is still the
branch tip.

The production artifact is built in `dist/netlify-deploy/`:

- `site/` contains an explicit allowlist of public static files.
- `netlify/functions/` contains the function sources.
- `shared/` preserves the shared constants path required while bundling functions.

Build it locally with:

```bash
npm run build:netlify
```

Generated artifacts are ignored by Git.

## Migration gates

Complete these gates in order. Do not disable the current Netlify deployment
until the replacement path has been verified.

1. Push the test-only workflow and confirm all hosted checks pass.
2. Add repository secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` only after
   reviewing the token's account authority and storage boundary.
3. Add a deploy job that depends on the complete test job, serializes production
   deployments, and confirms the tested commit is still the tip of `main`.
4. Create a non-production draft deploy from the allowlisted artifact and verify
   the static app and functions.
5. Stop Netlify's independent Git builds while leaving CLI publishing enabled.
6. Run the first test-gated production deployment and verify the public domain,
   core API flow, and GitHub deployment record.

Each account or production change requires explicit approval immediately before
it is performed.

## Recovery

Until migration is complete, Netlify's existing Git integration remains the
production owner. After migration, a failed test or deploy must leave the last
successful production deployment live. Recovery options must include rerunning a
failed workflow after correction and restoring a previously verified Netlify
deployment. Manual production uploads should not be mixed with workflow-owned
deployment records except during an explicitly documented recovery.
