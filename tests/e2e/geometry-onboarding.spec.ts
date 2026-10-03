import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

async function liveStore(page: Page, action: "unlock" | "import" | "return") {
  await page.evaluate(async (action) => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    if (action === "unlock") store.controller.session.enableExperimentalTx();
    if (action === "import")
      store.importBundle(store.controller.exportBundle());
    if (action === "return") store.returnToLiveWorkspace();
  }, action);
}
async function checkLayout(page: Page, label: string, width: number) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync("/tmp/matrixsmith-geometry-review", { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `/tmp/matrixsmith-geometry-review/${label}-${width}.png`,
    fullPage: true,
  });
}

for (const width of [320, 390, 1280]) {
  test(`unknown-display manual and reported onboarding at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?sim=lumen#/home");
    await page
      .getByRole("button", { name: "Connect a display", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Set up this display", exact: true }),
    ).toHaveCount(1);
    // Simulator setup grants the same explicit session permission used by application tests.
    // It is never evidence of real hardware support or a UI permission shortcut.
    await liveStore(page, "unlock");
    const identify = page.getByRole("button", {
      name: "Set up this display",
      exact: true,
    });
    await identify.focus();
    await page.keyboard.press("Enter");
    // Experimental legacy fixtures still require a manual power-user diagnostic.
    await page.evaluate(async () => {
      const store = (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore;
      await store.runDiagnostic("lumen-identify");
    });
    await expect(
      page.getByRole("heading", { name: "Establish the display size" }),
    ).toBeVisible();
    const w = page.getByRole("textbox", { name: "Width (pixels)" });
    const h = page.getByRole("textbox", { name: "Height (pixels)" });
    await expect(w).toHaveValue("");
    await expect(h).toHaveValue("");
    await expect(
      page.getByText("Display reported 24×8 pixels.", { exact: true }),
    ).toBeVisible();
    await checkLayout(page, "blank-reported", width);
    await w.fill("2.");
    await h.fill("8");
    // Navigation through normal controls retains raw unsubmitted text.
    await page
      .getByRole("button", { name: "Device actions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Developer tools", exact: true })
      .click();
    await page.getByRole("button", { name: /Investigate$/ }).click();
    await expect(w).toHaveValue("2.");
    await h.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Use these dimensions" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(w).toBeFocused();
    expect(
      await w.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 55 && box.bottom < innerHeight - 65;
      }),
    ).toBe(true);
    await expect(w).toHaveAttribute("aria-invalid", "true");
    await expect(w).toHaveAttribute("aria-describedby", /geometry-width-error/);
    await expect(page.locator("#geometry-width-error")).toContainText(
      "whole number",
    );
    await expect(h).toHaveValue("8");
    await checkLayout(page, "field-error", width);
    await w.fill("512");
    await h.fill("129");
    await page.getByRole("button", { name: "Use these dimensions" }).click();
    await expect(page.getByRole("alert")).toContainText("65,536-pixel budget");
    await expect(w).toHaveValue("512");
    await expect(h).toHaveValue("129");
    await expect(w).toHaveAttribute(
      "aria-describedby",
      /geometry-budget-error/,
    );
    await expect(h).toHaveAttribute(
      "aria-describedby",
      /geometry-budget-error/,
    );
    await checkLayout(page, "budget-error", width);
    // Switching contexts retains the correct draft, and no unlock is restored.
    await liveStore(page, "import");
    await expect(
      page.getByRole("heading", { name: "Offline report", exact: true }),
    ).toBeVisible();
    await liveStore(page, "return");
    await expect(w).toHaveValue("512");
    await expect(h).toHaveValue("129");
    await w.fill("16");
    await h.fill("8");
    await h.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "16×8 pixels · provisional" }),
    ).toBeFocused();
    expect(
      await page
        .locator("#geometry-status")
        .evaluate((element) => element.getBoundingClientRect().top >= 55),
    ).toBe(true);
    await expect(page.getByText(/manual owner entry/)).toBeVisible();
    await expect(
      page.getByText(/This family contributes no applicable bounded tests/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh device info", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Brightness: unsupported/)).toBeVisible();
    await expect(page.getByText(/Static image: blocked/)).toBeVisible();
    await expect(
      page.getByText(/Geometry grants no capability evidence/),
    ).toBeVisible();
    await checkLayout(page, "manual-terminal", width);
    await page
      .getByRole("button", { name: "Open report", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close report" }).click();
    await page
      .getByRole("button", { name: "Open Protocol workbench", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Protocol workbench", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Investigate$/ }).click();
    await page.getByText("Change dimensions", { exact: true }).click();
    await expect(w).toHaveValue("16");
    await expect(h).toHaveValue("8");
    await page
      .getByRole("button", { name: "Use reported size", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "24×8 pixels · provisional" }),
    ).toBeFocused();
    await expect(
      page.getByText(/Source: display identification response/),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Read Synthetic Lumen information",
        exact: true,
      }),
    ).toBeVisible();
    // Explicit adoption never overwrites the manual draft or enables permissions.
    await expect(w).toHaveValue("16");
    await expect(h).toHaveValue("8");
    const state = await page.evaluate(() => {
      const store = (
        globalThis as unknown as {
          matrixsmithStore: import("../../src/presentation/store").PresentationStore;
        }
      ).matrixsmithStore;
      return {
        manual: store.controller.session.fingerprint?.manuallyConfirmedGeometry,
        unlocked: store.controller.session.experimentalTxEnabled,
        brightness:
          store.getSnapshot().assessment.capabilities.brightness.availability,
        gate: store.controller.evaluate(
          store.controller.plan({ type: "GetDeviceInfo" }),
        ).allowed,
      };
    });
    expect(state).toEqual({
      manual: undefined,
      unlocked: false,
      brightness: "unsupported",
      gate: false,
    });
    await checkLayout(page, "reported-adopted", width);
  });
}
