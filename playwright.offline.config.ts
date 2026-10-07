import { defineConfig, devices } from "@playwright/test";
import { prepareQualificationRun } from "./tests/helpers/qualification-paths";
import { join } from "node:path";

const run = prepareQualificationRun();

export default defineConfig({
  testDir: "tests/e2e-prod",
  outputDir: run.offline,
  reporter: [
    ["line"],
    ["json", { outputFile: join(run.reporter, "offline.json") }],
  ],
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-release-fixtures.mjs",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
