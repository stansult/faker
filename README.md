# Faker

Faker is a browser party word game for 3–20 players. Most players know the
secret word and give clues; one faker has to blend in without knowing it.

**[Play Faker](https://play-faker.us)**

## How to play

1. One player creates a room, chooses the number of players, games, rounds, and
   language, then shares the room code or invite link.
2. Everyone joins and privately submits the requested number of words. These
   become the secret-word pool for the match.
3. At the start of each game, one player is randomly assigned as the faker.
   Everyone else sees the same secret word; the faker does not.
4. Players take turns giving a unique one-word clue. Legit players must hint at
   the secret word without saying it outright, while the faker tries to sound
   convincing.
5. Voting begins after the configured rounds. It can also begin early once all
   but one player request it.
6. Each player votes for the person they think is the faker.

The legit players win only if **every legit player votes for the faker**. A
wrong vote or abstention gives the faker the win. The faker also wins
immediately by correctly submitting the secret word as a clue.

Each winning legit player earns one point when the legit side wins; the faker
earns one point when the faker wins. After the selected number of games, the
final standings rank everyone by total score.

## Features

- No account or installation required
- Configurable matches for 3–20 players
- English and Russian word validation
- Shareable room codes and invite links
- Desktop and mobile browser support
- Session recovery after refreshing or reopening the game
- Persistent scores and final match standings

## Run locally

Install dependencies and start the site with its local Netlify Functions:

```bash
npm install
npm run dev
```

Then open `http://localhost:8888`.

## Testing

The project has fast logic and tooling tests, local API workflows, and
Playwright browser coverage for desktop and mobile layouts.

```bash
npm test
npm run test:api
npm run test:ui
```

See the [testing guide](tests/README.md) for the suite design, coverage, local
commands, Git hooks, and CI behavior.

## Technical documentation

- [Development guide](docs/development.md) — architecture, APIs, local
  environments, build behavior, and technical room rules
- [Testing guide](tests/README.md) — test strategy, coverage, and commands
- [Deployment guide](docs/deployment.md) — test-gated Netlify production flow
