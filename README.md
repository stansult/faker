# Faker
Party word game where one player is the faker. Legit players share a secret word and give one‑word moves to reveal themselves without giving the word away, while the faker bluffs and tries to survive or guess the word.

A match is a series of games. Each game picks one secret word from the pool, assigns roles, runs turn‑based moves, and ends with voting or a faker win. Scores persist across games until the match ends.

## Current state
- Real UI lives at `/index.html` and shows only production-ready controls.
- Debug tools and logs are available at `?debug=1` (no reload needed once toggled).
- Room flow: create/join, submit words, start games (host can short‑start before game 1).
- Language support: English and Russian validation for words/moves (room default is English).
- Moves: strict turn order, one word per move, move input validation.
- Voting: players can trigger a forced vote, then vote live with a timer; results end the game.
- Scores: winners gain +1; scores persist across games in a match and show in the room list.

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
https://dev.play-faker.us
```

This assumes you created a named tunnel `faker-dev` and mapped it to `dev.play-faker.us`:
```
cloudflared tunnel route dns faker-dev dev.play-faker.us
```
Or add a DNS CNAME in Cloudflare:
```
dev -> <tunnel-id>.cfargotunnel.com
```
To use a different tunnel name:
```
FAKER_TUNNEL_NAME=your-tunnel npm run dev:live
```
