# Faker
Party word game where one player is the faker. Everyone else shares a secret word and tries to blend in with believable one‑word clues, while the faker guesses and survives.

The game runs as a series of games inside a match. Each game picks a secret word from the shared pool, assigns roles, runs turn‑based moves, and ends with voting. Scores persist across games until the match ends.

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

For other devices on the same Wi‑Fi (HTTP):
```
npm run dev:lan
```
It prints `http://<your-mac-ip>:8888`.

For mobile HTTPS testing (clipboard works), use Cloudflare Tunnel:
```
npm run dev:live
```
Then open:
```
https://dev.stansult.com
```

This assumes you created a named tunnel `faker-dev` and mapped it to `dev.stansult.com`.
To use a different tunnel name:
```
FAKER_TUNNEL_NAME=your-tunnel npm run dev:live
```
