import { defineConfig, devices } from "@playwright/test";

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
    baseURL: "http://localhost:4173",
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
  webServer: {
    command: "node tests/helpers/uiServer.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 60_000
  }
});
