import { expect, test } from "@playwright/test";

import {
  getGameState,
  openGameAsPlayer,
  prepareStartedGame
} from "../helpers/playwrightGame.mjs";
import { postFunction } from "../helpers/playwrightApi.mjs";

test("active player submits a clue", { tag: "@mobile" }, async ({ page, request }) => {
  const game = await prepareStartedGame(request);
  const before = await getGameState(request, game.roomCode, game.players[0].playerId);
  const player = game.players.find(candidate =>
    candidate.playerNumber === before.game.nextPlayerNumber
  );
  expect(player, "the active player should exist in the prepared roster").toBeTruthy();

  await openGameAsPlayer(page, game, player);
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
  await expect(page.locator("#moveHeader")).not.toHaveText("Your move!");
  await expect.poll(async () => {
    const state = await getGameState(request, game.roomCode, player.playerId);
    return state.game.moves.find(move => move.playerId === player.playerId)?.word;
  }).toBe(player.clue);
});

test("player casts a vote", { tag: "@mobile" }, async ({ page, request }) => {
  const game = await prepareStartedGame(request);
  const voter = game.players[0];
  const target = game.players[1];

  await openGameAsPlayer(page, game, voter);
  await expect(page.locator("#voteDetails")).toBeHidden();
  await expect(page.locator("#voteSection")).not.toHaveClass(/\byour-turn\b/);
  await expect(page.locator("#voteSection")).not.toHaveClass(/\byour-turn-alert\b/);

  for (const player of game.players.slice(1)) {
    await postFunction(request, "triggerVote", {
      roomCode: game.roomCode,
      playerId: player.playerId
    }, `triggerVote ${player.name}`);
  }

  const voting = await getGameState(request, game.roomCode, voter.playerId);
  expect(voting.game.votePhase.active).toBe(true);

  await expect(page.locator("#voteDetails")).toBeVisible();
  await expect(page.locator("#voteStatus")).toContainText("Voting in progress");
  await expect(page.locator("#voteSection")).toHaveClass(/\byour-turn\b/);
  await expect(page.locator("#voteSection")).toHaveClass(/\byour-turn-alert\b/);

  const targetChoice = page.locator(`.vote-target[data-target="${target.playerId}"]`);
  // Voting intentionally requires a quick second tap. The live vote panel pulses,
  // so bypass Playwright's stability wait while preserving real pointer events.
  await targetChoice.click({ force: true });
  await targetChoice.click({ force: true });

  await expect(page.locator(`.vote-choice[data-target="${target.playerId}"]`)).toBeChecked();
  await expect(page.locator("#voteChangeHint")).toHaveText(
    "There's still time to change your mind!"
  );
  await expect.poll(async () => {
    const state = await getGameState(request, game.roomCode, voter.playerId);
    return state.game.votePhase.votes[voter.playerId];
  }).toBe(target.playerId);
});

test("voting alert ends promptly when the countdown expires", async ({ page, request }) => {
  const game = await prepareStartedGame(request);
  const player = game.players[0];

  await openGameAsPlayer(page, game, player);
  await expect(page.locator("#voteSection")).not.toHaveClass(/\byour-turn-alert\b/);

  for (const trigger of game.players.slice(1)) {
    await postFunction(request, "triggerVote", {
      roomCode: game.roomCode,
      playerId: trigger.playerId
    }, `triggerVote ${trigger.name}`);
  }

  await expect(page.locator("#voteSection")).toHaveClass(/\byour-turn-alert\b/);
  await expect(page.locator("#voteTimer")).toHaveText("0:00", { timeout: 12_000 });
  await expect(page.locator("#voteSection")).not.toHaveClass(
    /\byour-turn-alert\b/,
    { timeout: 1_500 }
  );
  await expect(page.locator("#voteSection")).not.toHaveClass(/\byour-turn\b/);
  await expect(page.locator("#overlay")).toBeVisible();
});
