import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

async function setup(page: Page) {
  await page.goto("/?sim=unknown#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set up this display", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Width (pixels)" }).fill("32");
  await page.getByRole("textbox", { name: "Height (pixels)" }).fill("16");
  await page
    .getByRole("button", { name: "Use these dimensions", exact: true })
    .click();
}
async function verify(page: Page) {
  await page
    .getByRole("button", { name: "Verify a still image", exact: true })
    .click();
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
  for (let i = 0; i < 2; i++)
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
  await page.getByRole("button", { name: "Finish", exact: true }).click();
}
async function capture(page: Page, name: string) {
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
  const review = page.locator(
    '[aria-labelledby="candidate-review-title"], [aria-labelledby="profile-review-title"]',
  );
  if (await review.count())
    await expect(review).toMatchAriaSnapshot({ name: `${name}.aria.yml` });
  mkdirSync("/tmp/matrixsmith-candidate-review/screenshots", {
    recursive: true,
  });
  await page.screenshot({
    path: `/tmp/matrixsmith-candidate-review/screenshots/${name}.png`,
    fullPage: true,
  });
}
async function upload(page: Page, buffer: Buffer) {
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "candidate.profile.json",
      mimeType: "application/json",
      buffer,
    });
}
for (const width of [390, 1280])
  test(`candidate export, fresh load and explicit three-step revalidation at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(100000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page);
    await verify(page);
    const create = page.getByRole("button", {
      name: "Create candidate profile",
      exact: true,
    });
    await create.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Candidate profile", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText(/Locally verified on one target/),
    ).toBeVisible();
    await expect(
      page.getByText(/Observed Bluetooth matching name/),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Public label", exact: true })
      .fill("Owner reviewed still display");
    await page
      .getByRole("textbox", { name: "Public label", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("heading", { name: "Candidate profile", exact: true }),
    ).toBeFocused();
    await capture(page, `review-${width}`);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download candidate profile", exact: true })
      .click();
    const portable = readFileSync((await (await download).path())!);
    const document = JSON.parse(portable.toString());
    expect(document.documentVersion).toBe(2);
    expect(document.label).toBe("Owner reviewed still display");
    expect(document.candidate.history.status).toBe("locally-verified");
    expect(document.contradictions.companyId).toBeNull();
    const attachmentDownload = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Download shareable candidate evidence",
        exact: true,
      })
      .click();
    const attachment = readFileSync((await (await attachmentDownload).path())!);
    await page.goto("/?sim=unknown#/home");
    await page.reload(); // Fresh runtime, same browser history must not unlock.
    await upload(page, portable);
    await expect(
      page.getByText(/Evidence attachment is missing/),
    ).toBeVisible();
    await capture(page, `reload-${width}`);
    await page
      .locator(
        '[aria-labelledby="profile-review-title"] input[type="file"][accept=".json,application/json"]',
      )
      .setInputFiles({
        name: "candidate-evidence.json",
        mimeType: "application/json",
        buffer: Buffer.from(attachment),
      });
    await expect(
      page.getByText(/Referenced V3 evidence attachment inspected/),
    ).toBeVisible();
    expect(
      await page.evaluate(() => {
        const store = (
          globalThis as unknown as {
            matrixsmithStore: import("../../src/presentation/store").PresentationStore;
          }
        ).matrixsmithStore;
        return {
          source: store.controller.session.source,
          investigation: store.controller.investigation,
          permission: store.controller.session.experimentalTxEnabled,
          confirmation: store.controller.session.confirmedPlanDigest,
          certainty: store.controller.panelProgram().certainty,
        };
      }),
    ).toEqual({
      source: "live",
      investigation: null,
      permission: false,
      confirmation: null,
      certainty: "unknown",
    });
    await page
      .getByRole("button", { name: "Load reviewed profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connect a display", exact: true })
      .click();
    await page.getByRole("button", { name: /Create$/ }).click();
    await expect(
      page.getByRole("button", { name: "Verify a still image", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Investigate$/ }).click();
    await page
      .getByRole("button", { name: "Set up this display", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Verify a still image", exact: true }),
    ).toBeVisible();
    await capture(page, `gated-${width}`);
    await verify(page);
    await page
      .getByRole("button", { name: "Create content", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /Create$/ })).toBeVisible();
    await expect(
      page.getByText(/verified for this session only/),
    ).toBeVisible();
    await capture(page, `experimental-create-${width}`);
  });

test("partial candidate, incompatible input, export failure and changed-context recovery", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Create candidate profile", exact: true })
    .click();
  await expect(
    page.getByText(/Incomplete candidate; no completed still verification/),
  ).toBeVisible();
  await page.evaluate(() => {
    document.execCommand = () => false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new Error("Simulated clipboard denial")),
      },
    });
  });
  await page
    .getByRole("button", { name: "Copy candidate profile", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /Clipboard|clipboard/ }),
  ).toBeVisible();
  await capture(page, "export-error");
  await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    store.controller.confirmProvisionalGeometry(16, 16);
    store.updateGeometryDraft("width", "16");
  });
  await expect(
    page.getByRole("button", {
      name: "Download candidate profile",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Display target, geometry, definition or evidence changed/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create candidate profile", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download candidate profile", exact: true })
    .click();
  const portable = readFileSync((await (await download).path())!);
  expect(JSON.parse(portable.toString()).dimensions.width).toBe(16);
  await page.goto("/?sim=unknown#/home");
  await page.reload();
  await upload(
    page,
    Buffer.from(
      JSON.stringify({
        ...JSON.parse(portable.toString()),
        implementation: "not-installed",
      }),
    ),
  );
  await expect(
    page.getByRole("button", { name: "Load reviewed profile", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("not installed");
  await capture(page, "incompatible");
});
