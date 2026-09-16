import { expect, test } from "@playwright/test";

async function postFunction(request, functionName, payload, label = functionName) {
  const response = await request.post(`/.netlify/functions/${functionName}`, {
    data: payload
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  expect(
    response.status(),
    `${label} expected 200, got ${response.status()}: ${JSON.stringify(data)}`
  ).toBe(200);
  return data;
}

test("host starts an API-prepared three-player game", async ({ page, request }) => {
  await page.goto("/");
  await page.locator("#playerName").fill("Alice");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#createSettings")).toBeVisible();
  await page.locator("#playerCount").fill("3");
  await page.locator("#gamesTotal").fill("1");
  await page.locator("#roundsPerGame").fill("1");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#viewRoom")).toBeVisible();
  await expect(page.locator("#playersList")).toContainText("Alice");
  const roomCode = (await page.locator("#roomCodeDisplay").textContent())?.trim();
  expect(roomCode).toMatch(/^[0-9A-Z]{6}$/);

  const initialStatus = await postFunction(request, "roomStatus", { roomCode });
  const host = initialStatus.players.find(player => player.playerNumber === 1);
  expect(host, "player 1 should be the room host").toBeTruthy();
  expect(host.name).toBe("alice");

  const players = [
    { playerId: host.playerId, name: "Alice", words: ["amber", "aspen"] },
    { playerId: "playwright-player-bob", name: "Bob", words: ["birch", "breeze"] },
    { playerId: "playwright-player-carol", name: "Carol", words: ["cedar", "clover"] }
  ];

  for (const player of players.slice(1)) {
    await postFunction(request, "joinRoom", {
      roomCode,
      playerId: player.playerId,
      name: player.name
    }, `joinRoom ${player.name}`);
  }

  for (const player of players) {
    await postFunction(request, "submitWords", {
      roomCode,
      playerId: player.playerId,
      words: player.words
    }, `submitWords ${player.name}`);
    await postFunction(request, "markWordsDone", {
      roomCode,
      playerId: player.playerId
    }, `markWordsDone ${player.name}`);
  }

  await expect.poll(async () => {
    const status = await postFunction(request, "roomStatus", { roomCode });
    return status.allJoined && status.allReady;
  }, {
    message: "all three players should be joined and ready",
    timeout: 15_000
  }).toBe(true);

  for (const player of players) {
    const row = page.locator("#playersList tbody tr").filter({ hasText: player.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Ready");
  }

  await expect(page.locator("#btnStartGame")).toBeEnabled();
  await page.locator("#btnStartGame").click();

  await expect(page.locator("#viewGame")).toBeVisible();
  await expect(page.locator("#gameHeader")).toHaveText("Game #1 of 1");

  const state = await postFunction(request, "gameState", {
    roomCode,
    playerId: host.playerId
  });
  expect(state.currentPlayers).toBe(3);
  expect(state.you).toEqual({ playerId: host.playerId, playerNumber: 1 });
  expect(state.game?.gameId).toBeTruthy();
  expect(state.game?.endedAt).toBeNull();
  expect(state.game?.nextPlayerNumber).toBeGreaterThanOrEqual(1);
  expect(state.game?.nextPlayerNumber).toBeLessThanOrEqual(3);
});
