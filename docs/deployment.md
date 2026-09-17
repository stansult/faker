# Test-Gated Netlify Deployment

Faker deploys to Netlify through a GitHub Actions test gate. GitHub environment
secrets identify and authorize the production project; Netlify's independent Git
builds remain disabled so the tested workflow is the only normal deployment path.

## Intended flow

Non-documentation pushes and all pull requests to `main` run syntax checks, logic
and deployment-safety tests, local API workflows, Playwright UI tests, and the
production artifact build. Markdown-only pushes are ignored and do not deploy;
mixed pushes always use the full gate. Pull requests never deploy. On an eligible
`main` run, the deploy job waits for every test, confirms the tested commit is still
the branch tip, rebuilds the allowlisted artifact from that commit, publishes
through the pinned Netlify CLI, and records the production deployment in GitHub.

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

Account, credential, billing, and production configuration changes require explicit
approval immediately before they are performed.

## Recovery

GitHub Actions is the production deployment owner. A failed test or deploy must
leave the last successful production deployment live. Recovery options include
rerunning a failed workflow after correction or restoring a previously verified
production deploy. Manual production uploads should not be mixed with workflow-owned
deployment records except during an explicitly documented recovery.

The deploy job uses `NETLIFY_AUTH_TOKEN` only in secret validation and the publish
step. It uses `NETLIFY_SITE_ID` only to select the existing site. Workflow source
must never print either value, and pull-request jobs receive neither secret.
