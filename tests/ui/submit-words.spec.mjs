import { expect, test } from "@playwright/test";

test("player submits and locks words", { tag: "@mobile" }, async ({ page }) => {
  await page.goto("/");
  await page.locator("#playerName").fill("Alice");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#createSettings")).toBeVisible();
  await page.locator("#playerCount").fill("3");
  await page.locator("#gamesTotal").fill("1");
  await page.locator("#roundsPerGame").fill("1");
  await page.locator("#btnCreateRoom").click();

  await expect(page.locator("#viewRoom")).toBeVisible();
  for (const word of ["amber", "aspen"]) {
    await page.locator("#wordInput").fill(word);
    await page.locator("#btnSubmitWords").click();
    await expect(page.locator("#submittedWordsLine")).toContainText(word);
  }

  await expect(page.locator("#wordsProgress")).toHaveText("All 2 words submitted.");
  await expect(page.locator("#submittedWordsEditor .word-chip")).toHaveCount(2);
  await expect(page.locator("#btnDoneWords")).toBeVisible();
  await page.locator("#btnDoneWords").click();

  await expect(page.locator("#overlayMessage")).toContainText("ready to lock your words");
  await page.locator("#overlayPrimary").click();

  await expect(page.locator("#submitWordsPanel")).toBeHidden();
  const aliceRow = page.locator("#playersList tbody tr").filter({ hasText: "Alice" });
  await expect(aliceRow).toContainText("Ready");
  await expect(aliceRow).toContainText("← you");
});
