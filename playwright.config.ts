import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // ARIA is shared; visual baselines use the platform font environment.
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      pathTemplate:
        process.platform === "linux"
          ? "{testDir}/{testFilePath}-snapshots/linux/{arg}{ext}"
          : "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
    },
  },
  fullyParallel: true,
  retries: 0,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:4187", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
