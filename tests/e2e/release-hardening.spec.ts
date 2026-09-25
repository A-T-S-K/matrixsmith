import { test, expect } from "./fixtures";
import type { SimulatedIledHatTransport } from "../../src/dev/simulated-device";

async function connect(page: import("@playwright/test").Page) {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
}

test("malformed reports show an error on cold and warm Home and permit retry", async ({
  page,
}) => {
  for (const url of ["/#/home", "/?sim#/home"]) {
    await page.goto(url);
    await page.locator('input[accept="application/json,.json"]').setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{"),
    });
    await expect(page.getByRole("alert")).toContainText(/JSON|parse|invalid/i);
    await expect(
      page.getByRole("heading", { name: /Make the display/i }),
    ).toBeVisible();
  }
});

test("image selection, settings, and direct send recover after invalid input", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("tab", { name: "Image", exact: true }).click();
  const file = page.locator('input[accept="image/png,image/jpeg,image/webp"]');
  await file.setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("bad image"),
  });
  await expect(page.getByRole("alert")).toContainText(/image header/i);
  await file.setInputFiles("research/image-reduction/fixtures/transparent.png");
  await expect(
    page.getByRole("button", { name: "Display it", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("pixel-art");
  await page.getByRole("button", { name: "Display it", exact: true }).click();
  await expect(page.getByText("Display updated.", { exact: true })).toBeVisible(
    { timeout: 10000 },
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("shareable exports redact identity while the local archive preserves it", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: "Device actions" }).click();
  await page.getByRole("button", { name: "Share report…" }).click();
  await page
    .getByRole("textbox", { name: "Goal / question" })
    .fill("Check my display");
  await page.getByRole("checkbox", { name: "GATT", exact: true }).uncheck();
  const text = async (label: string) => {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const stream = await (await downloaded).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  };
  const shareable = await text("Download shareable Bundle V3");
  const archive = await text(
    "Download full local archive (includes identifiers)",
  );
  expect(shareable).not.toContain("simulated-iledhat");
  expect(archive).toContain("simulated-iledhat");
  await page.getByRole("button", { name: "Close report" }).click();
  await page.getByRole("button", { name: /back to MatrixSmith home/i }).click();
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(shareable),
  });
  await expect(
    page.getByText(
      "Diagnostic report opened offline. Live operations remain blocked.",
    ),
  ).toBeVisible();
});

test("unexpected disconnect clears the live state and reconnect remains usable", async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(async () => {
    await (
      globalThis as unknown as {
        matrixsmithTransport: SimulatedIledHatTransport;
      }
    ).matrixsmithTransport.disconnect();
  });
  await expect(
    page.getByRole("button", { name: "Display it", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /back to MatrixSmith home/i }).click();
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
});

test("experimental content requires one confirmation and permits cancellation", async ({
  page,
}) => {
  await page.goto("/?sim=experimental#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("HI");
  await page.getByRole("button", { name: "Display it", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Display it", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Display text", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Display updated.", { exact: true })).toBeVisible(
    { timeout: 10000 },
  );
});

test("a missed guided observation can retry without turning the missed attempt into evidence", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: /Investigate$/ }).click();
  await page.locator("summary").filter({ hasText: "All guided tests" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Measure how long a static image stays still" })
    .getByRole("button", { name: "Start", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "I'm ready — run test", exact: true })
    .click();
  await expect(dialog.getByRole("timer")).toBeVisible({ timeout: 10000 });
  await dialog
    .getByRole("button", { name: "I missed it — retry", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Retry this observation?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("timer")).toBeVisible({ timeout: 10000 });
  const attempts = await page.evaluate(() =>
    (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore
      .getSnapshot()
      .guidedFlow?.attempts.map((attempt) => attempt.validity),
  );
  expect(attempts).toHaveLength(2);
  expect(attempts?.[0]).not.toBe("valid");
  expect(attempts?.[1]).toBe("incomplete");
});
