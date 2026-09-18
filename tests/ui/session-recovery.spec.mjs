import { expect, test } from "@playwright/test";

import {
  getGameState,
  openGameAsPlayer,
  prepareStartedGame
} from "../helpers/playwrightGame.mjs";

test("player recovers an active game after refreshing", async ({ browser, page, request }) => {
  const game = await prepareStartedGame(request);
  const before = await getGameState(request, game.roomCode, game.players[0].playerId);
  const player = game.players.find(candidate =>
    candidate.playerNumber === before.game.nextPlayerNumber
  );
  expect(player, "the active player should exist in the prepared roster").toBeTruthy();

  await openGameAsPlayer(page, game, player);
  await expect(page.locator("#playerBadgeGame")).toHaveText(
    `Player #${player.playerNumber}: ${player.name}`
  );
  await expect(page.locator("#moveHeader")).toHaveText("Your move!");

  const readSavedIdentity = () => page.evaluate(roomCode => {
    const raw = localStorage.getItem(`faker:${roomCode}`);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return {
      playerId: saved.playerId,
      playerNumber: saved.playerNumber,
      name: saved.name
    };
  }, game.roomCode);
  const savedIdentity = await readSavedIdentity();
  expect(savedIdentity).toEqual({
    playerId: player.playerId,
    playerNumber: player.playerNumber,
    name: player.name
  });

  await page.reload();

  await expect(page.locator("#viewLobby")).toBeVisible();
  await expect(page.locator("#btnRejoinRoom")).toBeVisible();
  await expect(page.locator("#playerBadgeGame")).toBeHidden();
  expect(await readSavedIdentity()).toEqual(savedIdentity);

  await page.locator("#btnRejoinRoom").click();

  await expect(page.locator("#viewGame")).toBeVisible();
  await expect(page.locator("#playerBadgeGame")).toHaveText(
    `Player #${player.playerNumber}: ${player.name}`
  );
  await expect(page.locator("#moveHeader")).toHaveText("Your move!");
  if (player.role === "faker") {
    await expect(page.locator("#roleLabel")).toHaveText("You are the faker");
    await expect(page.locator("#secretWord")).toHaveText("You do not know the word.");
  } else {
    await expect(page.locator("#roleLabel")).toHaveText("You are legit");
    await expect(page.locator("#secretWord")).toHaveText(player.secretWord);
  }

  await page.locator("#moveWord").fill(player.clue);
  await page.locator("#btnSubmitMove").click();

  await expect(page.locator("#roundsTable")).toContainText(player.clue);
  await expect.poll(async () => {
    const state = await getGameState(request, game.roomCode, player.playerId);
    return state.game.moves.find(move => move.playerId === player.playerId)?.word;
  }).toBe(player.clue);

  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    await freshPage.goto(`/?room=${game.roomCode}`);

    await expect(freshPage.locator("#viewLobby")).toBeVisible();
    await expect(freshPage.locator("#joinRoomCode")).toBeVisible();
    await expect(freshPage.locator("#btnRejoinRoom")).toBeHidden();
    await expect(freshPage.locator("#playerBadgeGame")).toBeHidden();
    expect(await freshPage.evaluate(roomCode =>
      localStorage.getItem(`faker:${roomCode}`), game.roomCode
    )).toBeNull();
  } finally {
    await freshContext.close();
  }
});
