# Faker
Small party word game with Netlify Functions backend and a real UI in `index.html`.

## Current state
- Real UI lives at `/index.html` and shows only production-ready controls.
- Debug tools and logs are available at `?debug=1` (no reload needed once toggled).
- Room flow: create/join, submit words, start game (or host-only short start).
- Role flow: legit players see the secret word; the faker does not.
- Move flow: turn order is join order; non-fakers cannot submit the secret word.
- Voting phase: players can trigger a forced vote, vote live, and the timer resolves the game.
- Scores: winners gain +1; scores persist across games in a room and show in the lobby list.

## Local dev
Run the site + functions locally:
```
npm run dev
```
Then open `http://localhost:8888`.

For other devices on your Wi-Fi:
```
npm run dev:lan
```
Then open `http://<your-mac-ip>:8888`.
