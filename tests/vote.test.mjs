import assert from "node:assert/strict";

import { resolveVoteIfEnded } from "../netlify/functions/_vote.js";
import { test } from "./helpers/testHarness.mjs";

const ENDED_AT = "2026-01-01T00:00:01.000Z";

function makeRoom(votes) {
  return {
    gamesTotal: 1,
    gamesPlayed: 0,
    locked: true,
    matchEnded: false,
    players: [
      { playerId: "faker", score: 0 },
      { playerId: "legit-a", score: 0 },
      { playerId: "legit-b", score: 0 }
    ],
    game: {
      fakerPlayerId: "faker",
      votePhase: {
        active: true,
        endsAt: "2026-01-01T00:00:00.000Z",
        votes
      }
    }
  };
}

test("all legit players must identify the faker for a legit win", () => {
  const room = makeRoom({
    "legit-a": "faker",
    "legit-b": "faker",
    faker: "legit-a"
  });

  assert.equal(resolveVoteIfEnded(room, ENDED_AT), true);
  assert.equal(room.game.winner, "legits");
  assert.equal(room.game.endReason, "voting_legits_win");
  assert.deepEqual(room.players.map(player => player.score), [0, 1, 1]);
  assert.equal(room.matchEnded, true);
});

test("faker wins when any legit player votes incorrectly", () => {
  const room = makeRoom({
    "legit-a": "faker",
    "legit-b": "legit-a",
    faker: "legit-a"
  });

  assert.equal(resolveVoteIfEnded(room, ENDED_AT), true);
  assert.equal(room.game.winner, "faker");
  assert.equal(room.game.endReason, "voting_faker_win");
  assert.deepEqual(room.players.map(player => player.score), [1, 0, 0]);
});

test("faker wins when a legit player abstains", () => {
  const room = makeRoom({
    "legit-a": "faker",
    faker: "legit-a"
  });

  assert.equal(resolveVoteIfEnded(room, ENDED_AT), true);
  assert.equal(room.game.winner, "faker");
  assert.deepEqual(room.players.map(player => player.score), [1, 0, 0]);
});
