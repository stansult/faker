import { expect, test } from "@playwright/test";

import {
  openGameAsPlayer,
  prepareStartedGame
} from "../helpers/playwrightGame.mjs";

function rectanglesOverlap(first, second) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

test(
  "bottom status does not cover constrained-layout game panels",
  { tag: "@mobile" },
  async ({ page, request }, testInfo) => {
    if (testInfo.project.name === "desktop-chrome") {
      await page.setViewportSize({ width: 574, height: 846 });
    } else {
      await page.setViewportSize({ width: 412, height: 800 });
    }

    const game = await prepareStartedGame(request, {
      gamesTotal: 3,
      roundsPerGame: 3
    });
    await openGameAsPlayer(page, game, game.legit[0]);

    const rolePanel = page.locator("#movePanel");
    const movePanel = page.locator("#moveEntryPanel");
    const votePanel = page.locator("#voteSection");
    const voteButton = page.locator("#btnTriggerVote");
    const buildVersion = page.locator("#buildVersion");

    await expect(voteButton).toBeVisible();
    await expect(buildVersion).not.toBeEmpty();

    const [roleBox, moveBox] = await Promise.all([
      rolePanel.boundingBox(),
      movePanel.boundingBox()
    ]);
    expect(roleBox, "the role panel should have layout geometry").toBeTruthy();
    expect(moveBox, "the move panel should have layout geometry").toBeTruthy();
    expect(
      Math.abs(roleBox.x - moveBox.x),
      "the constrained fixture should use the single-column game layout"
    ).toBeLessThan(2);
    expect(moveBox.y).toBeGreaterThanOrEqual(roleBox.y + roleBox.height);

    const [voteBox, buildBox] = await Promise.all([
      votePanel.boundingBox(),
      buildVersion.boundingBox()
    ]);
    expect(voteBox, "the voting panel should have layout geometry").toBeTruthy();
    expect(buildBox, "the build status should have layout geometry").toBeTruthy();
    expect(
      rectanglesOverlap(voteBox, buildBox),
      `the build status should not cover the voting panel: ${JSON.stringify({ voteBox, buildBox })}`
    ).toBe(false);
  }
);
