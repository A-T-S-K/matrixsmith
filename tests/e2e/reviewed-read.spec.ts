import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
async function connect(page: Page, mode = "read-success") {
  await page.goto(`/?sim=${mode}#/home`);
  await page
    .getByRole("button", { name: "Choose device →", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Set up this display", exact: true }),
  ).toBeVisible();
}
async function start(page: Page) {
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .focus();
  await page.keyboard.press("Enter");
}
async function review(page: Page, name: string) {
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync("/tmp/matrixsmith-read-review/screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/matrixsmith-read-review/screenshots/${name}.png`,
    fullPage: true,
  });
}
for (const width of [390, 1280]) {
  test(`unfamiliar accessible service → decoded read at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await connect(page);
    await start(page);
    await expect(
      page
        .getByText(
          "LED matrix service value received and decoded under the inspected reference.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Set up this display", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("img", { name: /Five rows of decoded/ }),
    ).toHaveText("● · · · ·\n· · · · ●\n· ● · · ·\n· · ● · ·\n● · · ● ·");
    await expect(page.getByText(/source: live GATT read/)).toBeVisible();
    await expect(
      page.getByText(/Frame, text and control sending remain blocked/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use reported size", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".next-action")).toMatchAriaSnapshot({
      name: `read-success-${width}.aria.yml`,
    });
    await review(page, `success-${width}`);
    await page
      .getByText("Sources and exact technical evidence", { exact: true })
      .click();
    await expect(
      page.getByText(/received bytes: 10 01 08 04 12/),
    ).toBeVisible();
    await review(page, `evidence-${width}`);
  });
}
for (const mode of [
  "read-missing",
  "read-no-property",
  "read-malformed",
  "read-timeout",
]) {
  test(`${mode} gives a bounded useful recovery`, async ({ page }) => {
    await connect(page, mode);
    await start(page);
    const text =
      mode === "read-missing"
        ? /LED service is not accessible/
        : mode === "read-no-property"
          ? /has no Read property/
          : mode === "read-malformed"
            ? /Unexpected reserved bits/
            : /Read deadline reached/;
    await expect(page.getByText(text).first()).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Five rows of decoded/ }),
    ).toHaveCount(0);
    const recovery = page.getByRole("button", {
      name: "Disconnect and review access",
      exact: true,
    });
    await expect(recovery).toBeEnabled();
    if (mode === "read-timeout")
      await expect(
        page.getByRole("button", { name: "Start a new setup", exact: true }),
      ).toBeDisabled();
    await review(page, mode);
    await recovery.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: /Make the display/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose device →", exact: true }),
    ).toBeEnabled();
  });
}
for (const action of ["stop", "replacement"]) {
  test(`${action} during pending read suppresses stale success`, async ({
    page,
  }) => {
    await connect(page, "read-pending");
    await start(page);
    await expect(
      page.getByText(
        "What LED Matrix State value does the accessible service supply?",
        { exact: true },
      ),
    ).toBeVisible();
    if (action === "stop") {
      await page.getByRole("button", { name: "Stop", exact: true }).focus();
      await page.keyboard.press("Enter");
    } else
      await page.evaluate(() => {
        const store = (
          globalThis as unknown as {
            matrixsmithStore: import("../../src/presentation/store").PresentationStore;
          }
        ).matrixsmithStore;
        store.controller.session.fingerprint = {
          ...store.controller.session.fingerprint!,
          name: "replacement scripted target",
        };
      });
    await expect(
      page.getByText(/Read evidence belongs to a stopped or replaced context/),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Five rows of decoded/ }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "LED matrix service value received and decoded under the inspected reference.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await review(page, action);
  });
}
test("cold Home requests known service permission in the click before application loading", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", {
      value: {
        getDevices: async () => [],
        requestDevice: (options: unknown) => {
          (globalThis as unknown as { chooser: unknown }).chooser = {
            options,
            active: navigator.userActivation.isActive,
          };
          return Promise.reject(new Error("Scripted chooser cancellation"));
        },
      },
    });
  });
  await page.goto("/#/home");
  await page
    .getByRole("button", { name: "Choose device →", exact: true })
    .click();
  const chooser = await page.evaluate(
    () =>
      (
        globalThis as unknown as {
          chooser: {
            active: boolean;
            options: { acceptAllDevices: boolean; optionalServices: string[] };
          };
        }
      ).chooser,
  );
  expect(chooser.active).toBe(true);
  expect(chooser.options.acceptAllDevices).toBe(true);
  expect(chooser.options.optionalServices).toContain(
    "e95dd91d-251d-470a-a062-fa1922dfa9a8",
  );
  await expect(
    page.getByText(/Scripted chooser cancellation/).first(),
  ).toBeVisible();
});
