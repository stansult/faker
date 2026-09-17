import { expect, test } from "@playwright/test";

import {
  advanceToPlayer,
  finishWithFakerSecret,
  getGameState,
  getRoomStatus,
  openGameAsPlayer,
  openRoomAsPlayer,
  prepareStartedGame
} from "../helpers/playwrightGame.mjs";
import { postFunction } from "../helpers/playwrightApi.mjs";

test("faker wins immediately by submitting the secret word", async ({ page, request }) => {
  const game = await prepareStartedGame(request);
  await advanceToPlayer(request, game, game.faker);
  await openGameAsPlayer(page, game, game.faker);

  await expect(page.locator("#roleLabel")).toHaveText("You are the faker");
  await expect(page.locator("#moveHeader")).toHaveText("Your move!");
  await page.locator("#moveWord").fill(game.secretWord);
  await page.locator("#btnSubmitMove").click();

  await expect(page.locator("#overlay")).toBeVisible();
  await expect(page.locator("#overlayMessage")).toContainText(
    `Yes, the secret word was "${game.secretWord}".`
  );
  await expect(page.locator("#overlayMessage")).toContainText("You won!");

  const state = await getGameState(request, game.roomCode, game.faker.playerId);
  expect(state.matchEnded).toBe(true);
  expect(state.game.winner).toBe("faker");
  expect(state.game.endReason).toBe("faker_said_secret_word_on_turn");
});

test("legit player sees the winning voting result", async ({ page, request }) => {
  const game = await prepareStartedGame(request);
  const voter = game.legit[0];
  await openGameAsPlayer(page, game, voter);

  for (const trigger of game.players.filter(player => player.playerId !== voter.playerId)) {
    await postFunction(request, "triggerVote", {
      roomCode: game.roomCode,
      playerId: trigger.playerId
    }, `triggerVote ${trigger.name}`);
  }
  await expect(page.locator("#voteDetails")).toBeVisible();

  for (const player of game.players.filter(player => player.playerId !== voter.playerId)) {
    await postFunction(request, "castVote", {
      roomCode: game.roomCode,
      playerId: player.playerId,
      targetPlayerId: player.role === "faker" ? voter.playerId : game.faker.playerId
    }, `castVote ${player.name}`);
  }

  const fakerChoice = page.locator(
    `.vote-target[data-target="${game.faker.playerId}"]`
  );
  await fakerChoice.click({ force: true });
  await fakerChoice.click({ force: true });
  await expect.poll(async () => {
    const state = await getGameState(request, game.roomCode, voter.playerId);
    return state.game.votePhase.votes[voter.playerId];
  }).toBe(game.faker.playerId);

  let resolved;
  await expect.poll(async () => {
    resolved = await getGameState(request, game.roomCode, voter.playerId);
    return resolved.game.winner;
  }, { timeout: 5_000 }).toBe("legits");

  await expect(page.locator("#overlay")).toBeVisible({ timeout: 6_000 });
  await expect(page.locator("#overlayMessage")).toContainText("Votes are in — we won!");
  await expect(page.locator("#overlayMessage")).toContainText(game.faker.name);
  expect(resolved.matchEnded).toBe(true);
  expect(resolved.game.endReason).toBe("voting_legits_win");
});

test("completed match shows results and can be left", { tag: "@mobile" }, async ({
  page,
  request
}) => {
  const game = await prepareStartedGame(request);
  await finishWithFakerSecret(request, game);
  await openRoomAsPlayer(page, game, game.faker);

  await expect(page.locator("#overlay")).toBeVisible();
  await expect(page.locator("#overlayMessage .overlay-title")).toHaveText("Match over.");
  await expect(page.locator("#overlayMessage .match-table tbody tr")).toHaveCount(3);

  const fakerRow = page.locator("#overlayMessage .match-table tbody tr").filter({
    hasText: game.faker.name
  });
  await expect(fakerRow).toHaveClass(/\bis-me-row\b/);
  await expect(fakerRow).toContainText("1");
  await expect(fakerRow).toContainText("1st");
  await expect(page.locator("#overlayMessage .match-total")).toHaveText("Total games: 1");

  const status = await getRoomStatus(request, game.roomCode);
  expect(status.matchEnded).toBe(true);
  expect(status.players.find(player => player.playerId === game.faker.playerId)?.score).toBe(1);

  await expect(page.locator("#overlayAction")).toHaveText("Leave room");
  await page.locator("#overlayAction").click();
  await expect(page.locator("#viewLobby")).toBeVisible();
  await expect(page.locator("#overlay")).toBeHidden();
  await expect(page.locator("#btnRejoinRoom")).toBeHidden();
});
