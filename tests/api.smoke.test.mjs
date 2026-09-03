import assert from "node:assert/strict";

import { test } from "./helpers/testHarness.mjs";
import { assertOk, postFunction } from "./helpers/apiClient.mjs";
import { startNetlifyDev } from "./helpers/netlifyDev.mjs";

const PLAYERS = [
  { playerId: "test-player-a", name: "Alice", move: "delta" },
  { playerId: "test-player-b", name: "Bob", move: "echo" },
  { playerId: "test-player-c", name: "Carol", move: "foxtrot" }
];
const SAFE_CLUES = new Map([
  ["test-player-a", "amber"],
  ["test-player-b", "birch"],
  ["test-player-c", "cedar"]
]);

async function post(baseUrl, functionName, payload) {
  return postFunction(baseUrl, functionName, payload);
}

function assertResponse(result, status, error, label) {
  assert.equal(
    result.status,
    status,
    `${label} expected ${status}, got ${result.status}: ${JSON.stringify(result.data)}`
  );
  if (error) assert.equal(result.data?.error, error, label);
}

async function createRoom(baseUrl, overrides = {}) {
  const result = await post(baseUrl, "createRoom", {
    playerCount: 3,
    gamesTotal: 1,
    roundsPerGame: 1,
    language: "en",
    ...overrides
  });
  assertOk(assert, result, "createRoom");
  return result.data.roomCode;
}

async function prepareGame(baseUrl, overrides = {}) {
  const roomCode = await createRoom(baseUrl, overrides);
  for (const player of PLAYERS) {
    const join = await post(baseUrl, "joinRoom", {
      roomCode,
      playerId: player.playerId,
      name: player.name
    });
    assertOk(assert, join, `joinRoom ${player.name}`);

    const submitWords = await post(baseUrl, "submitWords", {
      roomCode,
      playerId: player.playerId,
      words: [`${player.name.toLowerCase()}one`, `${player.name.toLowerCase()}two`]
    });
    assertOk(assert, submitWords, `submitWords ${player.name}`);

    const markDone = await post(baseUrl, "markWordsDone", {
      roomCode,
      playerId: player.playerId
    });
    assertOk(assert, markDone, `markWordsDone ${player.name}`);
  }

  const start = await post(baseUrl, "startGame", {
    roomCode,
    playerId: PLAYERS[0].playerId
  });
  assertOk(assert, start, "startGame");

  const roles = [];
  for (const player of PLAYERS) {
    const role = await post(baseUrl, "getRole", {
      roomCode,
      playerId: player.playerId
    });
    assertOk(assert, role, `getRole ${player.name}`);
    roles.push({ ...player, role: role.data.role, secretWord: role.data.secretWord });
  }

  const faker = roles.find(player => player.role === "faker");
  const legit = roles.filter(player => player.role !== "faker");
  assert.ok(faker, "expected exactly one faker");
  assert.equal(legit.length, 2);
  assert.ok(legit[0].secretWord, "legit player should receive the secret word");
  return { roomCode, roles, faker, legit, secretWord: legit[0].secretWord };
}

async function getState(baseUrl, roomCode, playerId = PLAYERS[0].playerId) {
  const state = await post(baseUrl, "gameState", { roomCode, playerId });
  assertOk(assert, state, "gameState");
  return state.data;
}

function playerForNumber(number) {
  return PLAYERS[number - 1];
}

async function submitNextMove(baseUrl, roomCode, word) {
  const state = await getState(baseUrl, roomCode);
  const player = playerForNumber(state.game.nextPlayerNumber);
  assert.ok(player, `expected next player ${state.game.nextPlayerNumber}`);
  const move = await post(baseUrl, "submitMove", { roomCode, playerId: player.playerId, word });
  return { move, player };
}

test("local API validates creation and enforces join, rejoin, full, and locked rooms", async t => {
  const server = await startNetlifyDev();
  t.after(() => server.stop());

  const invalidCases = [
    [{ playerCount: 2 }, "playerCount must be an integer between 3 and 20"],
    [{ playerCount: 3, gamesTotal: 21 }, "gamesTotal must be an integer between 1 and 20"],
    [{ playerCount: 3, roundsPerGame: 0 }, "roundsPerGame must be an integer between 1 and 20"],
    [{ playerCount: 3, language: "fr" }, "language must be 'en' or 'ru'"]
  ];
  for (const [payload, error] of invalidCases) {
    assertResponse(await post(server.baseUrl, "createRoom", payload), 400, error, "create validation");
  }

  const roomCode = await createRoom(server.baseUrl);
  for (const player of PLAYERS) {
    assertOk(assert, await post(server.baseUrl, "joinRoom", {
      roomCode,
      playerId: player.playerId,
      name: player.name
    }), `join ${player.name}`);
  }

  const rejoin = await post(server.baseUrl, "joinRoom", {
    roomCode,
    playerId: PLAYERS[0].playerId,
    name: "Alice Again"
  });
  assertOk(assert, rejoin, "rejoin");
  assert.equal(rejoin.data.rejoined, true);
  assert.equal(rejoin.data.playerNumber, 1);
  assert.equal(rejoin.data.name, "Alice Again");

  assertResponse(await post(server.baseUrl, "joinRoom", {
    roomCode,
    playerId: "test-player-d",
    name: "Dave"
  }), 409, "Room is full", "full room");

  const game = await prepareGame(server.baseUrl);
  assertResponse(await post(server.baseUrl, "joinRoom", {
    roomCode: game.roomCode,
    playerId: "test-player-d",
    name: "Dave"
  }), 409, "Room is locked", "locked room");
  const lockedRejoin = await post(server.baseUrl, "joinRoom", {
    roomCode: game.roomCode,
    playerId: PLAYERS[0].playerId,
    name: PLAYERS[0].name
  });
  assertOk(assert, lockedRejoin, "locked rejoin");
  assert.equal(lockedRejoin.data.rejoined, true);
});

test("local API enforces turn, duplicate clue, and secret-word rules", async t => {
  const server = await startNetlifyDev({ env: { VOTE_TOTAL_SECONDS: "1", VOTE_FINAL_SECONDS: "1" } });
  t.after(() => server.stop());
  const game = await prepareGame(server.baseUrl, { roundsPerGame: 2 });
  const initial = await getState(server.baseUrl, game.roomCode);
  const current = playerForNumber(initial.game.nextPlayerNumber);
  const wrong = PLAYERS.find(player => player.playerId !== current.playerId);

  assertResponse(await post(server.baseUrl, "submitMove", {
    roomCode: game.roomCode,
    playerId: wrong.playerId,
    word: "wrongturn"
  }), 409, "Not your turn", "wrong turn");

  const firstWord = "uniqueclue";
  assertOk(assert, (await submitNextMove(server.baseUrl, game.roomCode, firstWord)).move, "first move");
  assertOk(assert, (await submitNextMove(server.baseUrl, game.roomCode, "secondclue")).move, "second move");
  assertOk(assert, (await submitNextMove(server.baseUrl, game.roomCode, "thirdclue")).move, "third move");
  const duplicate = await submitNextMove(server.baseUrl, game.roomCode, firstWord);
  assertResponse(duplicate.move, 409, "You already used that word", "duplicate move");

  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await getState(server.baseUrl, game.roomCode);
    const next = playerForNumber(state.game.nextPlayerNumber);
    if (next.playerId !== game.faker.playerId) {
      assertResponse(await post(server.baseUrl, "submitMove", {
        roomCode: game.roomCode,
        playerId: next.playerId,
        word: game.secretWord
      }), 400, "You cannot use the secret word", "legit secret clue");
      break;
    }
    assertOk(assert, (await submitNextMove(server.baseUrl, game.roomCode, "fakerclue")).move, "faker clue");
  }

  const immediate = await prepareGame(server.baseUrl);
  while (true) {
    const state = await getState(server.baseUrl, immediate.roomCode);
    const next = playerForNumber(state.game.nextPlayerNumber);
    assert.ok(next, `expected immediate-win player ${state.game.nextPlayerNumber}`);
    assert.equal(
      state.game.moves.some(move => move.word === immediate.secretWord),
      false,
      `secret word was already recorded: ${JSON.stringify(state.game.moves)}`
    );
    const word = next.playerId === immediate.faker.playerId
      ? immediate.secretWord
      : SAFE_CLUES.get(next.playerId);
    assert.ok(word, `expected a clue for ${next.playerId}`);
    if (next.playerId !== immediate.faker.playerId) {
      assert.notEqual(word, immediate.secretWord, "safe clue must differ from the secret word");
    }
    const move = await post(server.baseUrl, "submitMove", {
      roomCode: immediate.roomCode,
      playerId: next.playerId,
      word
    });
    assert.equal(
      move.status,
      200,
      `immediate-win move ${next.name} failed: ${JSON.stringify({
        response: move.data,
        fakerPlayerId: immediate.faker.playerId,
        secretWord: immediate.secretWord,
        nextPlayerNumber: state.game.nextPlayerNumber,
        moves: state.game.moves
      })}`
    );
    if (next.playerId === immediate.faker.playerId) {
      assert.equal(move.data.ended, true);
      assert.equal(move.data.winner, "faker");
      assert.equal(move.data.endReason, "faker_said_secret_word_on_turn");
      break;
    }
  }
});

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

  for (const [functionName, payload] of [
    ["joinRoom", { playerId: "test-player-d", name: "Dave" }],
    ["submitWords", { playerId: PLAYERS[0].playerId, words: ["late"] }],
    ["updateWords", { playerId: PLAYERS[0].playerId, words: ["late"] }],
    ["markWordsDone", { playerId: PLAYERS[0].playerId }]
  ]) {
    assertResponse(await post(server.baseUrl, functionName, { roomCode, ...payload }), 409, "Match ended", `${functionName} ended room`);
  }
});

test("local API returns 410 for an expired active room", async t => {
  const server = await startNetlifyDev({ env: { ROOM_ACTIVE_TTL_HOURS: "0" } });
  t.after(() => server.stop());
  const roomCode = await createRoom(server.baseUrl);
  assertResponse(
    await post(server.baseUrl, "roomStatus", { roomCode }),
    410,
    "Room expired",
    "expired room"
  );
});
