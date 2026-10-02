import { expect, test } from "./fixtures";
import { reviewTransaction } from "../helpers/review-fixtures";
import type { Page } from "@playwright/test";

async function connect(page: Page) {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
}
async function workbench(page: Page, name = "Transactions") {
  const desktop = page.getByRole("button", { name: /Protocol workbench/ });
  if (await desktop.isVisible()) await desktop.click();
  else {
    await page
      .getByRole("button", { name: "Device actions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Developer tools", exact: true })
      .click();
  }
  await section(page, name);
}
async function section(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Protocol workbench sections" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function capture(page: Page, count = 1201) {
  const bundle = await page.evaluate(() =>
    JSON.parse(
      (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore.exportBundle(),
    ),
  );
  bundle.transactions = Array.from({ length: count }, (_, i) =>
    reviewTransaction(i),
  );
  bundle.transactions[count - 51].id = "opaque:/?#% +🔬";
  bundle.transactions[count - 51].packets = Array.from(
    { length: 151 },
    (_, index) => ({
      timestamp: "2026-10-02T00:00:00.000Z",
      direction: "TX",
      hex: `00 ${index.toString(16).padStart(2, "0")} FF`,
      endpoint: {
        serviceUuid: "service",
        characteristicUuid: "characteristic",
      },
      hostAcceptedAt: "2026-10-02T00:00:00.005Z",
      scheduledDelayMs: 10,
      gapSincePreviousTxMs: 11,
    }),
  );
  bundle.transactions[count - 51].packets[50].direction = "RX";
  bundle.transactions[count - 51].packets[50].relation = "unrelated-concurrent";
  bundle.trace = Array.from({ length: 151 }, (_, index) => ({
    timestamp: "2026-10-02T00:00:00.000Z",
    type: "gatt.read",
    metadata: { index },
    rawHex: "00ABFF",
  }));
  const text = JSON.stringify(bundle);
  await page.evaluate(() =>
    (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore.goHome(),
  );
  expect(Buffer.byteLength(text)).toBeLessThan(10 * 1024 * 1024);
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles({
      name: "large.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
  await expect(
    page.getByRole("heading", { name: "Offline report", exact: true }),
  ).toBeVisible();
}

test("large imported review preserves pages, focus, history, exact packet windows and complete exports", async ({
  page,
}) => {
  await connect(page);
  await capture(page);
  await workbench(page);
  await expect(page.locator(".transaction-row")).toHaveCount(50);
  await expect(page.locator(".packet")).toHaveCount(0);
  await page
    .getByRole("searchbox", { name: "Search transactions" })
    .fill("probe");
  await page.getByRole("button", { name: "Probes", exact: true }).click();
  await expect(
    page.getByText("600 matching / 1201 total", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset search and filters" }).click();
  const pagination = page.getByRole("navigation", {
    name: "Transactions pagination",
  });
  await pagination.getByRole("button", { name: "Next" }).click();
  const origin = page.locator(".transaction-row").first();
  await origin.focus();
  const listScroll = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Transaction detail" }),
  ).toBeFocused();
  await expect(page).toHaveURL(/opaque%3A%2F%3F%23%25/);
  await expect(page.locator(".packet")).toHaveCount(50);
  const packets = page.getByRole("navigation", { name: "Packets pagination" });
  await packets.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".packet").first()).toContainText(
    "Scheduled delay: 10 ms · Measured gap: 11 ms",
  );
  await expect(page.locator(".packet").first()).toContainText("RX #50");
  await expect(page.locator(".packet").first()).toContainText(
    "unrelated-concurrent",
  );
  await expect(page.locator(".packet").first().locator("code")).toHaveText(
    "00 32 FF",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .locator(".packet")
    .first()
    .getByRole("button", { name: "Copy to clipboard" })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "00 32 FF",
  );
  await packets.getByRole("button", { name: "Next" }).click();
  await packets.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".packet")).toHaveCount(1);
  await expect(page.locator(".packet").first()).toContainText("TX #150");
  await page.goBack();
  await expect(pagination).toContainText("Page 2 of 25");
  await expect(origin).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(listScroll);
  await page.goForward();
  await expect(packets).toContainText("Page 4 of 4");
  await expect(
    page.getByRole("heading", { name: "Transaction detail" }),
  ).toBeFocused();
  await section(page, "Raw events");
  await expect(page.locator(".raw-layer li")).toHaveCount(50);
  const raw = page.getByRole("navigation", { name: "Raw events pagination" });
  await raw.getByRole("button", { name: "Next" }).click();
  const expectedRaw = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    return JSON.stringify(store.getSnapshot().rawEvents.at(-51)!.metadata);
  });
  await expect(page.locator(".raw-layer li").first()).toContainText(
    expectedRaw,
  );
  await section(page, "Transactions");
  await expect(
    page.getByRole("heading", { name: "Transaction detail" }),
  ).toBeFocused();
  await section(page, "Raw events");
  await expect(raw).toContainText("Page 2 of 4");
  const evidence = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    return {
      count: JSON.parse(store.exportBundle()).transactions.length,
      allowed: store.getSnapshot().content.allowed,
    };
  });
  expect(evidence).toEqual({ count: 1201, allowed: false });
  await page.getByRole("button", { name: /Return to live/ }).click();
  await workbench(page);
  await page.getByRole("searchbox").fill("live query");
  await page.getByRole("button", { name: /Return to retained report/ }).click();
  await workbench(page, "Raw events");
  await expect(raw).toContainText("Page 2 of 4");
  await section(page, "Transactions");
  await expect(
    page.getByRole("heading", { name: "Transaction detail" }),
  ).toBeVisible();
});

test("live arrivals retain the review window and only explicit latest changes it", async ({
  page,
}) => {
  await connect(page);
  await workbench(page, "GATT explorer");
  await page.getByRole("button", { name: "Read", exact: true }).first().click();
  await section(page, "Transactions");
  await page.getByRole("button", { name: /Show latest/ }).click();
  const before = await page
    .locator(".transaction-row")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.transaction),
    );
  await section(page, "GATT explorer");
  await page.getByRole("button", { name: "Read", exact: true }).first().click();
  await section(page, "Transactions");
  expect(
    await page
      .locator(".transaction-row")
      .evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.transaction),
      ),
  ).toEqual(before);
  await page
    .getByRole("button", { name: /Show latest \(1 new matches\)/ })
    .click();
  await expect(page.locator(".transaction-row")).toHaveCount(before.length + 1);
});

for (const width of [320, 390, 1280])
  test(`review layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await connect(page);
    await capture(page, width === 1280 ? 10000 : 1201);
    await workbench(page);
    await expect(page.locator(".transaction-row")).toHaveCount(50);
    await page
      .getByRole("navigation", { name: "Transactions pagination" })
      .getByRole("button", { name: "Next" })
      .click();
    await page.locator(".transaction-row").first().click();
    await expect(page.locator(".packet")).toHaveCount(50);
    await expect(
      page
        .getByRole("navigation", { name: "Packets pagination" })
        .getByRole("button", { name: "Next" }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/transaction-review-detail-${width}.png`,
    });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 1,
        )
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          right: element.getBoundingClientRect().right,
        }))
        .slice(-15),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      JSON.stringify(overflow),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/transaction-review-detail-${width}-full.png`,
      fullPage: true,
    });
    await section(page, "Raw events");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/transaction-review-raw-${width}.png`,
      fullPage: true,
    });
  });

test("detail modal Back precedence and replacement/reload history remain non-authorizing", async ({
  page,
}) => {
  await connect(page);
  await capture(page);
  await workbench(page);
  await page.locator(".transaction-row").first().click();
  await page
    .getByRole("button", { name: "Device actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Share report…", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Transaction detail" }),
  ).toBeVisible();
  await capture(page);
  await page.goBack();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Reopen diagnostic report" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reopen diagnostic report" }),
  ).toBeVisible();
});

test("raw arrivals preserve duplicate-event window and keyboard focus", async ({
  page,
}) => {
  await connect(page);
  await workbench(page, "Raw events");
  const before = await page.locator(".raw-layer li").allTextContents();
  const latest = page.getByRole("button", { name: /^Show latest/ });
  await latest.focus();
  await page.evaluate(() =>
    (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore.controller.trace.record(
      "error",
      { reviewFixture: true },
      Uint8Array.of(0, 171, 255),
    ),
  );
  await expect(latest).toBeFocused();
  expect(await page.locator(".raw-layer li").allTextContents()).toEqual(before);
  await page
    .getByRole("button", { name: "Show latest (1 new events)", exact: true })
    .click();
  await expect(
    page.locator(".raw-layer li").first().locator("code"),
  ).toHaveText("00 AB FF");
});
