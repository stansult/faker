import { expect, test } from "@playwright/test";

import { postFunction } from "../helpers/playwrightApi.mjs";

test("player joins an API-prepared room", { tag: "@mobile" }, async ({ page, request }) => {
  const room = await postFunction(request, "createRoom", {
    playerCount: 3,
    gamesTotal: 1,
    roundsPerGame: 1,
    language: "en"
  });
  expect(room.roomCode).toMatch(/^[0-9A-Z]{6}$/);

  const supportingPlayers = [
    { playerId: "playwright-player-alice", name: "Alice" },
    { playerId: "playwright-player-bob", name: "Bob" }
  ];
  for (const player of supportingPlayers) {
    await postFunction(request, "joinRoom", {
      roomCode: room.roomCode,
      playerId: player.playerId,
      name: player.name
    }, `joinRoom ${player.name}`);
  }

  await page.goto("/");
  await page.locator("#playerName").fill("Carol");
  await page.locator("#btnJoinRoom").click();

  await expect(page.locator("#joinRoomCode")).toBeVisible();
  await page.locator("#roomCode").fill(room.roomCode);
  await page.locator("#btnJoinRoom").click();

  await expect(page.locator("#viewRoom")).toBeVisible();
  await expect(page.locator("#playerBadge")).toHaveText("Player #3: Carol");

  for (const name of ["Alice", "Bob"]) {
    const row = page.locator("#playersList tbody tr").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("← you");
  }
  const carolRow = page.locator("#playersList tbody tr").filter({ hasText: "Carol" });
  await expect(carolRow).toHaveCount(1);
  await expect(carolRow).toContainText("← you");
  await expect(page.locator("#playersList tbody tr.is-me-row")).toHaveCount(1);

  const status = await postFunction(request, "roomStatus", { roomCode: room.roomCode });
  const joinedPlayer = status.players.find(player => player.playerNumber === 3);
  expect(status.currentPlayers).toBe(3);
  expect(status.allJoined).toBe(true);
  expect(joinedPlayer?.name).toBe("carol");
  expect(joinedPlayer?.playerId).toBeTruthy();
});
