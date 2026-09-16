import assert from "node:assert/strict";

import { assertOk, postFunction } from "./helpers/apiClient.mjs";
import { test } from "./helpers/testHarness.mjs";

const baseUrl = process.env.FAKER_TEST_BASE_URL;
if (!baseUrl) {
  throw new Error("FAKER_TEST_BASE_URL is required for the remote API smoke test");
}
if (process.env.ALLOW_NON_LOCAL_TEST_API !== "1") {
  throw new Error("Set ALLOW_NON_LOCAL_TEST_API=1 to run the remote API smoke test");
}

const target = new URL(baseUrl);
if (target.protocol !== "https:") {
  throw new Error("Remote API smoke tests require an HTTPS target");
}

const runId = Date.now().toString(36);
const safeClues = ["amber", "birch", "cedar"];
const players = ["Alice", "Bob", "Carol"].map((name, index) => ({
  name,
  playerId: `remote-${runId}-${index + 1}`,
  clue: safeClues[index]
}));

async function post(functionName, payload = {}) {
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

test("remote deploy serves the app and completes an immediate-win match", async () => {
  const page = await fetch(new URL("/", baseUrl));
  assert.equal(page.status, 200, "static app should be available");
  assert.match(await page.text(), /Faker/);

  assertResponse(
    await post("createRoom", { playerCount: 2 }),
    400,
    "playerCount must be an integer between 3 and 20",
    "create validation"
  );

  const create = await post("createRoom", {
    playerCount: 3,
    gamesTotal: 1,
    roundsPerGame: 1,
    language: "en"
  });
  assertOk(assert, create, "createRoom");
  const roomCode = create.data.roomCode;

  for (const player of players) {
    assertOk(assert, await post("joinRoom", {
      roomCode,
      playerId: player.playerId,
      name: player.name
    }), `joinRoom ${player.name}`);
    assertOk(assert, await post("submitWords", {
      roomCode,
      playerId: player.playerId,
      words: [`${player.name.toLowerCase()}one`, `${player.name.toLowerCase()}two`]
    }), `submitWords ${player.name}`);
    assertOk(assert, await post("markWordsDone", {
      roomCode,
      playerId: player.playerId
    }), `markWordsDone ${player.name}`);
  }

  assertOk(assert, await post("startGame", {
    roomCode,
    playerId: players[0].playerId
  }), "startGame");

  const roles = [];
  for (const player of players) {
    const role = await post("getRole", { roomCode, playerId: player.playerId });
    assertOk(assert, role, `getRole ${player.name}`);
    roles.push({ ...player, ...role.data });
  }
  const faker = roles.find(player => player.role === "faker");
  const legit = roles.find(player => player.role !== "faker");
  assert.ok(faker, "expected a faker");
  assert.ok(legit?.secretWord, "expected a secret word for a legit player");

  for (let moves = 0; moves < players.length; moves++) {
    const state = await post("gameState", { roomCode, playerId: players[0].playerId });
    assertOk(assert, state, "gameState");
    const next = roles[state.data.game.nextPlayerNumber - 1];
    assert.ok(next, "expected next player");
    const move = await post("submitMove", {
      roomCode,
      playerId: next.playerId,
      word: next.playerId === faker.playerId ? legit.secretWord : next.clue
    });
    assertOk(assert, move, `submitMove ${next.name}`);
    if (next.playerId === faker.playerId) {
      assert.equal(move.data.ended, true);
      assert.equal(move.data.winner, "faker");
      break;
    }
  }

  const result = await post("gameState", { roomCode });
  assertOk(assert, result, "gameState by room code");
  assert.equal(result.data.matchEnded, true);
  assert.equal(result.data.game.winner, "faker");

  const status = await post("roomStatus", { roomCode });
  assertOk(assert, status, "roomStatus by room code");
  assert.equal(status.data.matchEnded, true);

  assertResponse(await post("updateWords", {
    roomCode,
    playerId: players[0].playerId,
    words: ["late"]
  }), 409, "Match ended", "ended-room mutation");
});
