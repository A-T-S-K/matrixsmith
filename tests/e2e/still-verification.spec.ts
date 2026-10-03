import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
async function setup(page: Page, width = 48, height = 16) {
  await page.goto("/?sim=unknown#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Establish the display size" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Width (pixels)" })
    .fill(String(width));
  await page
    .getByRole("textbox", { name: "Height (pixels)" })
    .fill(String(height));
  await page
    .getByRole("button", { name: "Use these dimensions", exact: true })
    .click();
}
async function review(page: Page, bootstrap = false) {
  await page
    .getByRole("button", {
      name: bootstrap ? "Verify a still image" : "Run test",
      exact: true,
    })
    .first()
    .click();
  await expect(
    page.getByText(/Existing content cannot be read back/).first(),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", {
      name: bootstrap ? "I'm ready — run test" : "Run test",
      exact: true,
    })
    .click();
}
async function screenshot(page: Page, name: string) {
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
  mkdirSync("/tmp/matrixsmith-still-review", { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `/tmp/matrixsmith-still-review/${name}.png`,
    fullPage: true,
  });
}
for (const width of [390, 1280])
  test(`unfamiliar still verification to experimental Create at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page);
    const verify = page.getByRole("button", {
      name: "Verify a still image",
      exact: true,
    });
    await verify.focus();
    await page.keyboard.press("Enter");
    await screenshot(page, `review-${width}`);
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "I'm ready — run test", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Full image is visible now", exact: true })
      .click();
    await page.waitForTimeout(15100);
    await page
      .getByRole("button", {
        name: "Still completely static at 15 seconds",
        exact: true,
      })
      .click();
    await expect(page.locator("#prompt-coverage")).toBeVisible();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page
      .getByRole("button", { name: "Record observations", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByText(
          "Bootstrap rendering observed; colors and encoder still need verification.",
        ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Run test", exact: true })
      .click();
    for (const color of ["red", "green", "blue"])
      await page.getByRole("button", { name: color, exact: true }).click();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page
      .getByRole("button", { name: "Record observations", exact: true })
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Run test", exact: true })
      .click();
    for (let i = 0; i < 3; i++)
      await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page
      .getByRole("button", { name: "Record observations", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByText(
          "Static route verified for this session. Text and images are available experimentally.",
        ),
    ).toBeVisible();
    await screenshot(page, `verified-${width}`);
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await page
      .getByRole("button", { name: "Create content", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Create", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /verified for this session only. Review each stored-content replacement/,
      ),
    ).toBeVisible();
    await screenshot(page, `create-${width}`);
  });
test("short and unsure observation keeps a partial route with explicit recovery", async ({
  page,
}) => {
  await setup(page, 16);
  await review(page, true);
  await page
    .getByRole("button", { name: "Full image is visible now", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Still completely static — stop watching",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Unsure", exact: true }).click();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page
    .getByRole("button", { name: "Record observations", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "Partial or inconclusive still-image observation; no usable route yet.",
      ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Measure again", exact: true }),
  ).toBeVisible();
  await screenshot(page, "partial");
});
test("unsupported stride ends with useful workbench and report alternatives", async ({
  page,
}) => {
  await setup(page, 48, 8);
  await expect(
    page.getByRole("button", { name: "Verify a still image", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/height 16 and width 16–64/)).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Open Protocol workbench", exact: true })
      .first(),
  ).toBeVisible();
  await screenshot(page, "unsupported");
});
test("changed geometry during observation cannot adopt old answers", async ({
  page,
}) => {
  await setup(page);
  await review(page, true);
  await page
    .getByRole("button", { name: "Full image is visible now", exact: true })
    .click();
  await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    store.controller.confirmProvisionalGeometry(16, 16);
    store.submitGuidedObservations();
    if (
      store.controller
        .allClaimEvidence()
        .some(
          (entry) =>
            entry.claimId === "stored-program.upload" &&
            entry.status === "verified",
        )
    )
      throw new Error("Stale observation adopted");
  });
  await page
    .getByRole("button", {
      name: "Stop observation and save as incomplete",
      exact: true,
    })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Verify a still image", exact: true }),
  ).toBeVisible();
});
