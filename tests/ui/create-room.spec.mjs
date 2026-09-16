import { expect, test } from "@playwright/test";

test("host creates a room and reaches the lobby", { tag: "@mobile" }, async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Faker — Lobby");
  await page.locator("#playerName").fill("Alice");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#createSettings")).toBeVisible();
  await page.locator("#playerCount").fill("3");
  await page.locator("#gamesTotal").fill("1");
  await page.locator("#roundsPerGame").fill("1");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#viewRoom")).toBeVisible();
  await expect(page.locator("#roomCodeDisplay")).toHaveText(/^[0-9A-Z]{6}$/);
  await expect(page.locator("#playerBadge")).toContainText("Alice");
  await expect(page.locator("#playersList")).toContainText("Alice");
  await expect(page.locator("#roomMeta")).toContainText("Games:");
});
