import { defineConfig, devices } from "@playwright/test";

const productionUrl = process.env.PRODUCTION_URL;
if (!productionUrl) {
  throw new Error("PRODUCTION_URL is required for deployed build verification");
}

export default defineConfig({
  testDir: "./tests/post-deploy",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 30_000
  },
  reporter: "list",
  use: {
    baseURL: productionUrl,
    ...devices["Desktop Chrome"]
  }
});
