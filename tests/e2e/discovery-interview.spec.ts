import { qualificationArtifactPath } from "../helpers/qualification-paths";
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

async function connect(page: Page, mode = "discovery") {
  await page.goto(`/?sim=${mode}#/home`);
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Set up this display", exact: true }),
  ).toHaveCount(1);
}
async function evidence(page: Page, name: string) {
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: qualificationArtifactPath(test.info(), `${name}.png`),
    fullPage: true,
  });
}
for (const width of [390, 1280]) {
  test(`adaptive identification and explicit geometry handoff at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await connect(page);
    const start = page.getByRole("button", {
      name: "Set up this display",
      exact: true,
    });
    await start.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Is this software a?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await evidence(page, `progress-${width}`);
    await expect(
      page.getByText(
        "Family identified. Sourced dimensions are available for explicit review. Physical capabilities remain unverified.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Set up this display", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText("2 checks completed.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Display reported 24×8 pixels.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Width (pixels)" }),
    ).toHaveValue("");
    await page
      .getByText("Sources and exact technical evidence", { exact: true })
      .click();
    await evidence(page, `evidence-${width}`);
    await page
      .getByText("Sources and exact technical evidence", { exact: true })
      .click();
    await evidence(page, `geometry-${width}`);
    await page
      .getByRole("button", { name: "Use reported size", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "24×8 pixels · provisional",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      page.getByText(/Geometry grants no capability evidence/),
    ).toBeVisible();
    await evidence(page, `adopted-${width}`);
  });
}
test("Stop retains dispatched ownership and evidence without adopting or scheduling another step", async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(() => {
    const transport = (
      globalThis as unknown as {
        matrixsmithTransport: import("../../src/transport/fake").FakeTransport;
      }
    ).matrixsmithTransport;
    transport.writeDelayMs = 1000;
  });
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .click();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(stop).toBeDisabled();
  await expect(
    page.getByText(/dispatched check is still supervised/),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const store = (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore;
      try {
        store.controller.probe("b", "info");
        return false;
      } catch {
        return store.controller.discoveryBusy;
      }
    }),
  ).toBe(true);
  await expect(
    page.getByText(/Setup stopped. The dispatched attempt has settled/),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const store = (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore;
      return {
        attempts: store.controller.discovery?.attempts.length,
        identity: store.controller.session.protocolResolution,
        transactions: store.controller.transactions.length,
      };
    }),
  ).toEqual({ attempts: 1, identity: null, transactions: 1 });
  await evidence(page, "stopped");
});
test("ambiguity and timeout retain uncertainty and recovery actions", async ({
  page,
}) => {
  await connect(page, "discovery-ambiguous");
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .click();
  await expect(
    page.getByText("2 checks completed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/No further registered check can answer/),
  ).toBeVisible();
  await page
    .getByText("Sources and exact technical evidence", { exact: true })
    .click();
  await expect(
    page.getByText(/Multiple valid decoder interpretations remain/),
  ).toBeVisible();
  await evidence(page, "ambiguous");
  await page
    .getByRole("button", { name: "Open Protocol workbench", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Protocol workbench", exact: true }),
  ).toBeVisible();
  await page.goto("/?sim=discovery#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await page.evaluate(() => {
    (
      globalThis as unknown as {
        matrixsmithTransport: import("../../src/transport/fake").FakeTransport;
      }
    ).matrixsmithTransport.notificationOnWrite = null;
  });
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .click();
  await expect(
    page.getByText("2 checks completed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start a new setup", exact: true }),
  ).toBeVisible();
  await evidence(page, "timeout");
});
test("no-check completion explains limits and leaves manual tools available", async ({
  page,
}) => {
  await connect(page, "lumen");
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .click();
  await expect(
    page.getByText(/does not mean the display is unsupported/),
  ).toBeVisible();
  await expect(
    page.getByText("0 checks completed.", { exact: true }),
  ).toBeVisible();
  await evidence(page, "no-check");
  await page
    .getByRole("button", { name: "Open report", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
