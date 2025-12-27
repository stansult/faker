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
