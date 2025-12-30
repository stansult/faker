# Project Notes (Handoff)

Use this file as the single source of truth for context across separate Codex threads.

## Current State (Quick Summary)
- UI is live in `index.html` + `styles.css`, logic in `app.js`.
- Netlify Functions in `netlify/functions/`.
- Debug UI toggle available; build badge shows `v1.0 • build ...`.

## Bugs (Repro + Status)
- [ ] 

## Major Features (Decisions + Next Steps)
- [ ] 

## Infrastructure / DevOps
- Local dev:
  - `npm run dev` runs Netlify dev server locally (site + functions) at `http://localhost:8888`.
  - `npm run dev:lan` runs `netlify dev --live` and prints a public URL for phone testing.
- Netlify credits:
  - Production deploys cost credits (15 per deploy).
  - Web requests + function compute also consume credits.
  - Heavy dev with frequent deploys burns credits quickly.
- Migration / switchability:
  - Netlify Functions use `exports.handler(event, context)`.
  - Cloudflare Pages/Workers use `export default { fetch(request, env) { ... } }`.
  - Host‑agnostic approach: move core logic into shared modules, then create tiny wrappers per host.
  - Switching hosts later is possible but manual unless we add a wrapper‑generation script.
  - Future idea: script to generate/update wrappers based on a config flag (similar to build‑string hook).
  - Keep URL paths consistent (e.g., Netlify `/.netlify/functions/*` vs Cloudflare `/api/*`) via rewrites.

## Marketing / Launch
- [ ] 

## Open Questions
- [ ] 

## Recent Changes (for new threads)
- [ ] 
