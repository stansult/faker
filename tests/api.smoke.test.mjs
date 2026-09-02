import assert from "node:assert/strict";

import { test } from "./helpers/testHarness.mjs";
import { assertOk, postFunction } from "./helpers/apiClient.mjs";
import { startNetlifyDev } from "./helpers/netlifyDev.mjs";

const PLAYERS = [
  { playerId: "test-player-a", name: "Alice", move: "delta" },
  { playerId: "test-player-b", name: "Bob", move: "echo" },
  { playerId: "test-player-c", name: "Carol", move: "foxtrot" }
];

async function post(baseUrl, functionName, payload) {
  return postFunction(baseUrl, functionName, payload);
}

test("local API completes a one-game room and exposes match-ended results by room code", async t => {
  const server = await startNetlifyDev({
    env: {
      VOTE_TOTAL_SECONDS: "1",
      VOTE_FINAL_SECONDS: "1",
      ROOM_ACTIVE_TTL_HOURS: "1"
    }
  });
  t.after(() => server.stop());

  const create = await post(server.baseUrl, "createRoom", {
    playerCount: 3,
    gamesTotal: 1,
    roundsPerGame: 1,
    language: "en"
  });
  assertOk(assert, create, "createRoom");
  const roomCode = create.data.roomCode;
  assert.match(roomCode, /^[0-9A-Z]{6}$/);

  for (const player of PLAYERS) {
    const join = await post(server.baseUrl, "joinRoom", {
      roomCode,
      playerId: player.playerId,
      name: player.name
    });
    assertOk(assert, join, `joinRoom ${player.name}`);

    const submitWords = await post(server.baseUrl, "submitWords", {
      roomCode,
      playerId: player.playerId,
      words: [`${player.name.toLowerCase()}one`, `${player.name.toLowerCase()}two`]
    });
    assertOk(assert, submitWords, `submitWords ${player.name}`);

    const markDone = await post(server.baseUrl, "markWordsDone", {
      roomCode,
      playerId: player.playerId
    });
    assertOk(assert, markDone, `markWordsDone ${player.name}`);
  }

  const start = await post(server.baseUrl, "startGame", {
    roomCode,
    playerId: PLAYERS[0].playerId
  });
  assertOk(assert, start, "startGame");

  const roles = [];
  for (const player of PLAYERS) {
    const role = await post(server.baseUrl, "getRole", {
      roomCode,
      playerId: player.playerId
    });
    assertOk(assert, role, `getRole ${player.name}`);
    roles.push({ ...player, role: role.data.role });
  }

  const faker = roles.find(player => player.role === "faker");
  const legit = roles.filter(player => player.role !== "faker");
  assert.ok(faker, "expected exactly one faker");
  assert.equal(legit.length, 2);

  for (let i = 0; i < PLAYERS.length; i++) {
    const state = await post(server.baseUrl, "gameState", {
      roomCode,
      playerId: PLAYERS[0].playerId
    });
    assertOk(assert, state, `gameState before move ${i + 1}`);
    const nextPlayer = PLAYERS.find(player => player.playerId.endsWith(
      String.fromCharCode(96 + state.data.game.nextPlayerNumber)
    ));
    assert.ok(nextPlayer, `expected next player ${state.data.game.nextPlayerNumber}`);

    const move = await post(server.baseUrl, "submitMove", {
      roomCode,
      playerId: nextPlayer.playerId,
      word: nextPlayer.move
    });
    assertOk(assert, move, `submitMove ${nextPlayer.name}`);
  }

  for (const player of legit) {
    const vote = await post(server.baseUrl, "castVote", {
      roomCode,
      playerId: player.playerId,
      targetPlayerId: faker.playerId
    });
    assertOk(assert, vote, `castVote ${player.name}`);
  }

  const fakerVote = await post(server.baseUrl, "castVote", {
    roomCode,
    playerId: faker.playerId,
    targetPlayerId: legit[0].playerId
  });
  assertOk(assert, fakerVote, "castVote faker");

  await new Promise(resolve => setTimeout(resolve, 1200));

  const resolved = await post(server.baseUrl, "gameState", {
    roomCode
  });
  assertOk(assert, resolved, "gameState result by code");
  assert.equal(resolved.data.matchEnded, true);
  assert.equal(resolved.data.game.winner, "legits");
  assert.equal(resolved.data.yourRole, null);
  assert.equal(resolved.data.secretWord, null);

  const status = await post(server.baseUrl, "roomStatus", { roomCode });
  assertOk(assert, status, "roomStatus result by code");
  assert.equal(status.data.matchEnded, true);
  assert.equal(status.data.players.length, 3);
  assert.equal(status.data.players.find(player => player.playerId === faker.playerId).score, 0);
  for (const player of legit) {
    assert.equal(status.data.players.find(p => p.playerId === player.playerId).score, 1);
  }
});
