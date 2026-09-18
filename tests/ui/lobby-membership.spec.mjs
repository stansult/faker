import { expect, test } from "@playwright/test";

import {
  getRoomStatus,
  openRoomAsPlayer
} from "../helpers/playwrightGame.mjs";
import { postFunction } from "../helpers/playwrightApi.mjs";

const LOBBY_PLAYERS = [
  { playerId: "playwright-lobby-alice", name: "Alice" },
  { playerId: "playwright-lobby-bob", name: "Bob" },
  { playerId: "playwright-lobby-carol", name: "Carol" }
];

async function prepareLobby(request) {
  const room = await postFunction(request, "createRoom", {
    playerCount: 3,
    gamesTotal: 1,
    roundsPerGame: 1,
    language: "en"
  });

  const players = [];
  for (const definition of LOBBY_PLAYERS) {
    const joined = await postFunction(request, "joinRoom", {
      roomCode: room.roomCode,
      playerId: definition.playerId,
      name: definition.name
    }, `joinRoom ${definition.name}`);
    players.push({
      ...definition,
      playerId: joined.playerId,
      playerNumber: joined.playerNumber
    });
  }
  return { roomCode: room.roomCode, players };
}

test("host kicks a player from an API-prepared lobby", async ({ page, request }) => {
  const lobby = await prepareLobby(request);
  const [host, target, remaining] = lobby.players;
  await openRoomAsPlayer(page, lobby, host);

  const hostRow = page.locator("#playersList tbody tr").filter({ hasText: host.name });
  const targetRow = page.locator("#playersList tbody tr").filter({ hasText: target.name });
  await expect(hostRow.locator(".kick-player")).toHaveCount(0);
  await expect(page.locator("#playersList .kick-player")).toHaveCount(2);

  await targetRow.locator(".kick-player").click();
  await expect(page.locator("#overlayMessage")).toContainText(
    `Remove player #${target.playerNumber} (${target.name}) from the room?`
  );
  await page.locator("#overlayPrimary").click();

  await expect(targetRow).toHaveCount(0);
  const remainingRow = page.locator("#playersList tbody tr").filter({
    hasText: remaining.name
  });
  await expect(remainingRow.locator("td").first()).toHaveText("2");

  const status = await getRoomStatus(request, lobby.roomCode);
  expect(status.currentPlayers).toBe(2);
  expect(status.players.map(player => [player.playerId, player.playerNumber])).toEqual([
    [host.playerId, 1],
    [remaining.playerId, 2]
  ]);
});

test("player leaves an API-prepared lobby", { tag: "@mobile" }, async ({
  page,
  request
}) => {
  const lobby = await prepareLobby(request);
  const [, player, remaining] = lobby.players;
  await openRoomAsPlayer(page, lobby, player);

  await page.locator("#btnLeaveRoom").click();
  await expect(page.locator("#overlayMessage")).toContainText(
    "Leave room? You won't be able to rejoin."
  );
  await page.locator("#overlayPrimary").click();

  await expect(page.locator("#viewLobby")).toBeVisible();
  await expect(page.locator("#btnRejoinRoom")).toBeHidden();
  const saved = await page.evaluate(roomCode => ({
    player: localStorage.getItem(`faker:${roomCode}`),
    words: localStorage.getItem(`faker:${roomCode}:words`),
    lastRoom: localStorage.getItem("faker:lastRoom")
  }), lobby.roomCode);
  expect(saved).toEqual({ player: null, words: null, lastRoom: null });

  const status = await getRoomStatus(request, lobby.roomCode);
  expect(status.currentPlayers).toBe(2);
  expect(status.players.map(candidate => [candidate.playerId, candidate.playerNumber])).toEqual([
    [lobby.players[0].playerId, 1],
    [remaining.playerId, 2]
  ]);
});
