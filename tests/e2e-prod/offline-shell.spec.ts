import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("built production shell navigates and reloads offline", async ({
  page,
  context,
}) => {
  const failures: string[] = [];
  page.on("requestfailed", (request) =>
    failures.push(
      `${request.url()} — ${request.failure()?.errorText ?? "failed"}`,
    ),
  );
  page.on("pageerror", (error) =>
    failures.push(`pageerror — ${error.message}`),
  );
  await page.goto("/#/home");
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const scripts = [...document.scripts]
      .map((script) => script.src)
      .filter(Boolean);
    const styles = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ].map((link) => link.href);
    return Promise.all(
      [...scripts, ...styles].map(async (url) => ({
        url,
        cached: Boolean(await caches.match(url)),
      })),
    );
  });
  expect(cached.every(({ cached }) => cached)).toBe(true);
  expect(
    await page.evaluate(async () =>
      Promise.all(
        [
          "knowledge-v1.json",
          "knowledge-v1.schema.json",
          "profile-v1.schema.json",
          "profile-v2.schema.json",
        ].map(async (path) =>
          Boolean(await caches.match(new URL(path, location.href))),
        ),
      ),
    ),
  ).toEqual([true, true, true, true]);
  // Reload online first: the installed worker must serve a shell fetched
  // through the host's /index.html redirect without a navigation error.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(failures).toEqual([]);
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  const profile = readFileSync(
    new URL("../../src/profiles/data/authored-ux-banner.json", import.meta.url),
  );
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles({
      name: "banner.profile.json",
      mimeType: "application/json",
      buffer: profile,
    });
  await expect(
    page.getByRole("heading", { name: "Local profile review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load reviewed profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Loaded local profiles" }),
  ).toBeVisible();
  // The candidate is deliberately incomplete. Even fully cached definitions
  // are configuration only and install into a disconnected workspace.
  const candidate = {
    ...JSON.parse(profile.toString()),
    documentVersion: 2,
    id: "offline-still-candidate",
    label: "Offline still candidate",
    matching: {
      ...JSON.parse(profile.toString()).matching,
      name: "offline candidate display",
    },
    contradictions: { companyId: null, geometry: true },
    dimensions: { width: 32, height: 16 },
    candidate: {
      kind: "revalidation-required",
      assumptions: {
        pixelFormat: "RGB444",
        rowStride: 16,
        tileWidth: 8,
        channelMap: ["r", "g", "b"],
      },
      identity: { manufacturer: null, firmware: null, model: null, chip: null },
      history: {
        status: "incomplete",
        createdAt: "2026-10-03T00:00:00.000Z",
        definitionIdentity: "offline-software-fixture",
        evidenceDigest: `sha256:${"0".repeat(64)}`,
        testIds: [],
      },
    },
  };
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "still.profile.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(candidate)),
    });
  await expect(page.getByText(/Candidate only · incomplete/)).toBeVisible();
  await expect(page.getByText(/Evidence attachment is missing/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load reviewed profile" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Load reviewed profile" }).click();
  await expect(
    page.getByRole("button", { name: "Export Offline still candidate" }),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => (await fetch("profile-v2.schema.json")).ok),
  ).toBe(true);
  expect(failures).toEqual([]);
  await page.goto("/#/device/investigate", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).not.toBeEmpty();
});
