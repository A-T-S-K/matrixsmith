import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

async function connectKnown(page: import("@playwright/test").Page) {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();
}

async function expectNoHighImpactViolations(
  page: import("@playwright/test").Page,
) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

test("known display updates routine text directly and remains visible from Home", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();
  await page.getByRole("textbox", { name: "Text" }).fill("HI");
  await page.getByRole("button", { name: "Display it" }).click();
  await expect(page.getByText("Display updated.")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: /back to MatrixSmith home/i }).click();
  await expect(page.getByText("ACTIVE DISPLAY")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to display" }),
  ).toBeVisible();
});

test("unknown display can identify its family and become provisional", async ({
  page,
}) => {
  await page.goto("/?sim=unknown#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(
    page.getByRole("heading", { name: "Investigate" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /safe identification|identify/i })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Confirm the display size" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use 32×16" }).click();
  await expect(
    page.getByText(/Bounded family tests are now available/i),
  ).toBeVisible();
});

test("critical simulator route has no serious or critical axe violations", async ({
  page,
}) => {
  await connectKnown(page);
  await expectNoHighImpactViolations(page);
});

test("critical routes match reviewed ARIA snapshots and the axe gate", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "one canonical ARIA baseline",
  );

  await page.goto("/?sim#/home");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "home.aria.yml",
  });
  await expectNoHighImpactViolations(page);

  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "create.aria.yml",
  });
  await expectNoHighImpactViolations(page);

  await page.getByRole("button", { name: /Investigate$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Investigate" }),
  ).toBeVisible();
  await expect(page.locator(".investigate")).toMatchAriaSnapshot({
    name: "investigate.aria.yml",
  });
  await expectNoHighImpactViolations(page);

  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Share report…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".report-options")).toMatchAriaSnapshot({
    name: "reports.aria.yml",
  });
  await expectNoHighImpactViolations(page);
  await page.getByRole("button", { name: "Close report" }).click();

  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await expect(page.getByRole("heading", { name: "Develop" })).toBeVisible();
  await expect(page.locator(".develop-view")).toMatchAriaSnapshot({
    name: "developer.aria.yml",
  });
  await expectNoHighImpactViolations(page);
});

test("reviewed responsive visuals cover 390, 768, and 1280 CSS pixels", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "one canonical visual baseline",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?sim#/home");
  await expect(
    page.getByRole("button", { name: "Connect a display" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("home-390.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();
  await expect(page).toHaveScreenshot("create-768.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: /Investigate$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Investigate" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("investigate-1280.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });
});

for (const width of [320, 390, 768, 1024, 1280]) {
  test(`Create remains usable without horizontal overflow at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Canonical breakpoint sweep runs once in Chromium.",
    );
    await page.setViewportSize({ width, height: 900 });
    await connectKnown(page);
    await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Display it" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("Browser Back closes overlays before navigating feature history", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Canonical history behavior runs once in Chromium.",
  );
  await connectKnown(page);
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Share report…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();

  await page.getByRole("button", { name: /Investigate$/ }).click();
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Developer tools" }).click();
  await expect(page.getByRole("heading", { name: "Develop" })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Investigate" }),
  ).toBeVisible();
});
