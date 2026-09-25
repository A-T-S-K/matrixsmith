import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e-prod",
  reporter: "line",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", serviceWorkers: "allow" },
  webServer: {
    command: "node scripts/serve-release-fixtures.mjs",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
