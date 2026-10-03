import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

test("workbench sections follow URLs and browser history", async ({ page }) => {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/transactions$/);
  const sections = page.getByRole("navigation", {
    name: "Protocol workbench sections",
  });
  await sections.getByRole("button", { name: "GATT explorer" }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/gatt$/);
  await expect(
    page.getByRole("heading", { name: "GATT explorer" }),
  ).toBeVisible();
  await sections.getByRole("button", { name: "Raw events" }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/raw$/);
  await page.goBack();
  await expect(
    sections.getByRole("button", { name: "GATT explorer" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(
    sections.getByRole("button", { name: "Raw events" }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: /Investigate$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/raw$/);
  await page.screenshot({ path: "/private/tmp/workbench-navigation.png" });
});

test("direct links request missing context without connecting", async ({
  page,
}) => {
  await page.goto("/#/offline/report/develop/gatt");
  await expect(
    page.getByRole("heading", { name: "Reopen diagnostic report" }),
  ).toBeVisible();
  await page.goto("/#/device/develop/gatt");
  await expect(
    page.getByRole("heading", { name: "Connect a display" }),
  ).toBeVisible();
});

async function openOfflineOnly(page: import("@playwright/test").Page) {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  const report = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    store.startDevelopInvestigation();
    return store.exportBundle();
  });
  await page.goto("/?sim#/home");
  await page.reload();
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles({
      name: "report.json",
      mimeType: "application/json",
      buffer: Buffer.from(report),
    });
  await expect(
    page.getByRole("heading", { name: "Offline report", exact: true }),
  ).toBeVisible();
  return report;
}

async function section(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await page
    .getByRole("navigation", { name: "Protocol workbench sections" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("offline-only explicit connection retains both contexts, drafts, URLs, modal history and focus", async ({
  page,
}) => {
  await openOfflineOnly(page);
  await page.evaluate(() => {
    (globalThis as Record<string, unknown>).continuityDocument =
      "same document";
  });
  await section(page, "Transactions");
  await page.getByRole("searchbox").fill("offline search");
  await section(page, "Evidence / observations");
  await page
    .getByRole("textbox", { name: "Unsaved review note" })
    .fill("offline note");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (globalThis as Record<string, unknown>).continuityDocument,
    ),
  ).toBe("same document");
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("live draft");
  await page.getByRole("tab", { name: "GIF", exact: true }).click();
  await page
    .locator('input[type="file"][accept="image/gif,.gif"]')
    .setInputFiles({
      name: "partial-disposal.gif",
      mimeType: "image/gif",
      buffer: readFileSync(
        new URL("../fixtures/gif/partial-disposal.gif", import.meta.url),
      ),
    });
  await expect(page.getByLabel("Decoded GIF preview")).toBeVisible();
  await page.evaluate(() => {
    const globals = globalThis as unknown as {
      matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      retainedGif?: unknown;
    };
    globals.retainedGif = globals.matrixsmithStore.getSnapshot().content.gif;
  });
  await page.getByRole("tab", { name: "Image", exact: true }).click();
  await section(page, "Transactions");
  await page.getByRole("searchbox").fill("live search");
  await section(page, "Evidence / observations");
  await page
    .getByRole("textbox", { name: "Unsaved review note" })
    .fill("live note");
  await page
    .getByRole("button", { name: "Return to retained report", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/offline\/report\/develop\/evidence$/);
  await expect(
    page.getByRole("textbox", { name: "Unsaved review note" }),
  ).toHaveValue("offline note");
  await expect(
    page.getByRole("heading", { name: "Protocol workbench", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Add session note" }),
  ).toBeDisabled();
  await section(page, "Transactions");
  await expect(page.getByRole("searchbox")).toHaveValue("offline search");
  await page.screenshot({
    path: "/private/tmp/continuity-offline.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Return to live display/ }).click();
  await expect(page).toHaveURL(/#\/device\/develop\/evidence$/);
  await expect(
    page.getByRole("textbox", { name: "Unsaved review note" }),
  ).toHaveValue("live note");
  await section(page, "Transactions");
  await expect(page.getByRole("searchbox")).toHaveValue("live search");
  await page
    .getByRole("button", { name: /Create$/ })
    .first()
    .click();
  await expect(
    page.getByRole("tab", { name: "Image", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Text", exact: true }),
  ).toHaveValue("live draft");
  expect(
    await page.evaluate(() => {
      const globals = globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        retainedGif?: unknown;
      };
      return (
        globals.retainedGif ===
        globals.matrixsmithStore.getSnapshot().content.gif
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/continuity-live.png",
    fullPage: true,
  });
  // Ordinary updates keep editing focus.
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("edited draft");
  await expect(
    page.getByRole("textbox", { name: "Text", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Return to retained report", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/offline\/report\/develop\/transactions$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/device\/create$/);
  await expect(
    page.getByRole("textbox", { name: "Text", exact: true }),
  ).toHaveValue("edited draft");
  await page.goForward();
  await expect(page.getByRole("searchbox")).toHaveValue("offline search");
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Share report…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const url = page.url();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(
    page.getByRole("button", { name: "Device actions" }),
  ).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveValue("offline search");
});

test("cancellation retries without reload and a retained live disconnect updates offline review", async ({
  page,
}) => {
  await openOfflineOnly(page);
  await section(page, "Evidence / observations");
  await page
    .getByRole("textbox", { name: "Unsaved review note" })
    .fill("keep after cancellation");
  await page.evaluate(() => {
    const transport = (
      globalThis as unknown as {
        matrixsmithTransport: import("../../src/dev/simulated-device").SimulatedIledHatTransport;
      }
    ).matrixsmithTransport;
    const prototype = Object.getPrototypeOf(transport) as typeof transport;
    const original = prototype.selectAndConnect;
    prototype.selectAndConnect = async function () {
      prototype.selectAndConnect = original;
      throw new Error("Chooser canceled by test");
    };
  });
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await expect(
    page.getByText("Chooser canceled by test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Unsaved review note" }),
  ).toHaveValue("keep after cancellation");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to retained report", exact: true })
    .click();
  await page.evaluate(async () => {
    const transport = (
      globalThis as unknown as {
        matrixsmithTransport: import("../../src/dev/simulated-device").SimulatedIledHatTransport;
      }
    ).matrixsmithTransport;
    await transport.disconnect();
  });
  await expect(
    page.getByRole("button", {
      name: "Return to live display (disconnected)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Unsaved review note" }),
  ).toHaveValue("keep after cancellation");
  await page.screenshot({
    path: "/private/tmp/continuity-disconnected.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Return to live display/ }).click();
  await expect(
    page.getByText("Display disconnected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send to display", exact: true }),
  ).toBeDisabled();
});
