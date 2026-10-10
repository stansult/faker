import { expect, test } from "@playwright/test";

test("production footer shows the deployed commit and UTC build time", async ({ page }) => {
  const productionUrl = process.env.PRODUCTION_URL;
  const deploySha = process.env.DEPLOY_SHA;

  expect(productionUrl, "PRODUCTION_URL must be set").toBeTruthy();
  expect(deploySha, "DEPLOY_SHA must be a full commit SHA").toMatch(/^[\da-f]{40}$/i);

  const shortSha = deploySha.slice(0, 7);
  const buildInfo = new RegExp(
    `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC\\s+${shortSha}$`
  );

  await expect.poll(async () => {
    const response = await fetch(new URL("build.txt", productionUrl), {
      cache: "no-store"
    });
    return response.ok ? (await response.text()).trim() : "";
  }, {
    intervals: [1_000, 2_000, 5_000],
    timeout: 90_000
  }).toMatch(buildInfo);

  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("#buildVersion")).toHaveText(
    new RegExp(
      `^v\\d+\\.\\d+ • build \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC\\s+${shortSha}$`
    )
  );
});
