import { expect } from "@playwright/test";

import { postFunction } from "./playwrightApi.mjs";

export const GAME_PLAYERS = [
  {
    playerId: "playwright-game-alice",
    name: "Alice",
    words: ["amber", "aspen"],
    clue: "glowing"
  },
  {
    playerId: "playwright-game-bob",
    name: "Bob",
    words: ["birch", "breeze"],
    clue: "swift"
  },
  {
    playerId: "playwright-game-carol",
    name: "Carol",
    words: ["cedar", "clover"],
    clue: "calm"
  }
];

export async function getGameState(request, roomCode, playerId) {
  return postFunction(request, "gameState", { roomCode, playerId });
}

export async function getRoomStatus(request, roomCode) {
  return postFunction(request, "roomStatus", { roomCode });
}

export async function prepareStartedGame(request, overrides = {}) {
  const room = await postFunction(request, "createRoom", {
    playerCount: 3,
    gamesTotal: 1,
    roundsPerGame: 1,
    language: "en",
    ...overrides
  });

  const players = [];
  for (const definition of GAME_PLAYERS) {
    const joined = await postFunction(request, "joinRoom", {
      roomCode: room.roomCode,
      playerId: definition.playerId,
      name: definition.name
    }, `joinRoom ${definition.name}`);
    const player = {
      ...definition,
      playerId: joined.playerId,
      playerNumber: joined.playerNumber
    };
    players.push(player);

    await postFunction(request, "submitWords", {
      roomCode: room.roomCode,
      playerId: player.playerId,
      words: player.words
    }, `submitWords ${player.name}`);
    await postFunction(request, "markWordsDone", {
      roomCode: room.roomCode,
      playerId: player.playerId
    }, `markWordsDone ${player.name}`);
  }

  await postFunction(request, "startGame", {
    roomCode: room.roomCode,
    playerId: players[0].playerId
  });

  for (const player of players) {
    const role = await postFunction(request, "getRole", {
      roomCode: room.roomCode,
      playerId: player.playerId
    }, `getRole ${player.name}`);
    player.role = role.role;
    player.secretWord = role.secretWord;
  }

  const faker = players.find(player => player.role === "faker");
  const legit = players.filter(player => player.role === "player");
  expect(faker).toBeTruthy();
  expect(legit).toHaveLength(2);
  expect(legit[0].secretWord).toBeTruthy();
  return {
    roomCode: room.roomCode,
    players,
    faker,
    legit,
    secretWord: legit[0].secretWord
  };
}

export async function advanceToPlayer(request, game, target) {
  for (let attempt = 0; attempt < game.players.length; attempt++) {
    const state = await getGameState(request, game.roomCode, target.playerId);
    const current = game.players.find(player =>
      player.playerNumber === state.game.nextPlayerNumber
    );
    expect(current, `player #${state.game.nextPlayerNumber} should exist`).toBeTruthy();
    if (current.playerId === target.playerId) return state;

    await postFunction(request, "submitMove", {
      roomCode: game.roomCode,
      playerId: current.playerId,
      word: current.clue
    }, `submitMove ${current.name}`);
  }
  throw new Error(`Could not advance ${game.roomCode} to ${target.name}`);
}

export async function finishWithFakerSecret(request, game) {
  await advanceToPlayer(request, game, game.faker);
  const result = await postFunction(request, "submitMove", {
    roomCode: game.roomCode,
    playerId: game.faker.playerId,
    word: game.secretWord
  }, "submitMove faker secret word");
  expect(result.ended).toBe(true);
  expect(result.winner).toBe("faker");
  return result;
}

export async function openRoomAsPlayer(page, game, player, expectedView = "#viewRoom") {
  await page.addInitScript(({ roomCode, savedPlayer }) => {
    const now = Date.now();
    localStorage.setItem(`faker:${roomCode}`, JSON.stringify({
      playerId: savedPlayer.playerId,
      playerNumber: savedPlayer.playerNumber,
      name: savedPlayer.name,
      savedAt: now,
      lastSeenAt: now
    }));
    localStorage.setItem("faker:lastRoom", roomCode);
  }, { roomCode: game.roomCode, savedPlayer: player });

  await page.goto(`/?room=${game.roomCode}`);
  await page.locator("#playerName").fill(player.name);
  await page.locator("#btnJoinRoom").click();

  await expect(page.locator(expectedView)).toBeVisible();
  const badge = expectedView === "#viewGame" ? "#playerBadgeGame" : "#playerBadge";
  await expect(page.locator(badge)).toHaveText(
    `Player #${player.playerNumber}: ${player.name}`
  );
}

export async function openGameAsPlayer(page, game, player) {
  await openRoomAsPlayer(page, game, player, "#viewGame");
}
