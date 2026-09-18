import { expect, test } from "@playwright/test";

import {
  advanceToPlayer,
  getGameState
} from "../helpers/playwrightGame.mjs";
import { postFunction } from "../helpers/playwrightApi.mjs";

test("Russian room accepts Cyrillic words through active gameplay", async ({ page, request }) => {
  await page.goto("/");
  await page.locator("#playerName").fill("Alice");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#createSettings")).toBeVisible();
  await page.locator("#playerCount").fill("3");
  await page.locator("#roomLanguage").selectOption("ru");
  await page.locator("#gamesTotal").fill("1");
  await page.locator("#roundsPerGame").fill("1");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#viewRoom")).toBeVisible();
  await expect(page.locator("#wordLanguageHint")).toContainText("Language: Russian");
  const roomCode = (await page.locator("#roomCodeDisplay").textContent())?.trim();
  expect(roomCode).toMatch(/^[0-9A-Z]{6}$/);

  const initialStatus = await postFunction(request, "roomStatus", { roomCode });
  expect(initialStatus.language).toBe("ru");
  const host = initialStatus.players.find(player => player.playerNumber === 1);
  expect(host, "player 1 should be the room host").toBeTruthy();

  for (const word of ["берёза", "облако"]) {
    await page.locator("#wordInput").fill(word);
    await page.locator("#btnSubmitWords").click();
    await expect(page.locator("#submittedWordsLine")).toContainText(word);
  }
  await page.locator("#btnDoneWords").click();
  const markWordsDoneResponse = page.waitForResponse(response =>
    response.url().endsWith("/.netlify/functions/markWordsDone") &&
    response.request().method() === "POST"
  );
  await page.locator("#overlayPrimary").click();
  expect((await markWordsDoneResponse).status()).toBe(200);
  const hostRow = page.locator("#playersList tbody tr").filter({ hasText: "Alice" });
  await expect(hostRow).toContainText("Ready");

  const players = [
    {
      playerId: host.playerId,
      playerNumber: host.playerNumber,
      name: "Alice",
      clue: "тихий"
    },
    {
      playerId: "playwright-russian-bob",
      name: "Bob",
      words: ["река", "звезда"],
      clue: "быстрый"
    },
    {
      playerId: "playwright-russian-carol",
      name: "Carol",
      words: ["книга", "лампа"],
      clue: "яркий"
    }
  ];

  for (const player of players.slice(1)) {
    const joined = await postFunction(request, "joinRoom", {
      roomCode,
      playerId: player.playerId,
      name: player.name
    }, `joinRoom ${player.name}`);
    player.playerId = joined.playerId;
    player.playerNumber = joined.playerNumber;

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
  }).toBe(true);
  await expect(page.locator("#btnStartGame")).toBeEnabled();
  await page.locator("#btnStartGame").click();

  await expect(page.locator("#viewGame")).toBeVisible();
  const started = await getGameState(request, roomCode, host.playerId);
  expect(started.language).toBe("ru");

  const game = { roomCode, players };
  await advanceToPlayer(request, game, players[0]);
  await expect(page.locator("#moveHeader")).toHaveText("Your move!");

  await page.locator("#moveWord").fill("bright");
  await page.locator("#btnSubmitMove").click();
  await expect(page.locator("#moveError")).toHaveText(
    "Use Russian letters only (including ё), hyphens, apostrophes."
  );

  await page.locator("#moveWord").fill(players[0].clue);
  await page.locator("#btnSubmitMove").click();

  await expect(page.locator("#roundsTable")).toContainText(players[0].clue);
  await expect.poll(async () => {
    const state = await getGameState(request, roomCode, host.playerId);
    return state.game.moves.find(move => move.playerId === host.playerId)?.word;
  }).toBe(players[0].clue);
});
