import { defineConfig, devices } from "@playwright/test";

const remoteBaseURL = process.env.FAKER_UI_BASE_URL || null;
if (remoteBaseURL && process.env.ALLOW_NON_LOCAL_TEST_UI !== "1") {
  throw new Error("Set ALLOW_NON_LOCAL_TEST_UI=1 to run UI tests against a non-local target");
}

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: "list",
  use: {
    baseURL: remoteBaseURL || "http://localhost:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chrome",
      use: devices["Desktop Chrome"]
    },
    {
      name: "mobile-chrome",
      grep: /@mobile/,
      use: devices["Pixel 7"]
    }
  ],
  webServer: remoteBaseURL ? undefined : {
    command: "node tests/helpers/uiServer.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 60_000
  }
});
