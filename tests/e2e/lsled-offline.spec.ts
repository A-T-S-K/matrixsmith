import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("offline lazy entry recovers from a module load failure", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/src/ui/pages/OfflineLegacy.tsx*", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, body: "controlled module failure" })
      : route.continue();
  });
  await page.goto("/?offline=lsled");
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load the offline LSLED preview.",
  );
  const retry = page.getByRole("button", { name: "Retry offline preview" });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "LSLED legacy preview" }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});
for (const width of [1280, 390]) {
  test(`offline LSLED inspect/copy/retry at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.goto("/");
    await page
      .getByRole("link", { name: "Open offline LSLED preview" })
      .click();
    await expect(
      page.getByRole("heading", { name: "LSLED legacy preview" }),
    ).toBeVisible();
    expect(requested.some((url) => url.includes("application-bootstrap"))).toBe(
      false,
    );
    const example = page.getByRole("combobox", {
      name: "Example",
      exact: true,
    });
    await example.focus();
    await expect(example).toBeFocused();
    await example.selectOption("asymmetric");
    await expect(example).toHaveValue("asymmetric");
    await expect(example).toBeFocused();
    await expect(
      page.getByRole("img", { name: /asymmetric logical/ }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("combobox", { name: "Packet index", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("combobox", { name: "Packet index", exact: true })
      .selectOption("4");
    const packet = page.getByLabel("Exact planned packet 4");
    await expect(packet).toHaveText(
      "80 01 00 00 00 00 00 00 00 00 80 00 00 80 00 00",
    );
    await page
      .getByRole("button", { name: "Copy packet bytes", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Exact planned bytes copied.",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await packet.textContent(),
    );
    await page.getByRole("button", { name: "Copy all planned bytes" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Exact planned bytes copied.",
    );
    const all = await page.evaluate(() => navigator.clipboard.readText());
    expect(all.split("\n")).toHaveLength(9);
    expect(all.replace(/\s/g, "")).toHaveLength(288);
    await example.selectOption("checkerboard");
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(
      page.getByRole("combobox", { name: "Packet index", exact: true }),
    ).toHaveValue("0");
    await expect(
      page.getByRole("img", { name: /checkerboard logical/ }),
    ).toBeVisible();
    // Controlled failure of the existing browser copy adapter, including fallback.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error("controlled copy failure");
          },
        },
      });
      document.execCommand = () => false;
    });
    await page
      .getByRole("button", { name: "Copy packet bytes", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Could not copy bytes");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => undefined },
      });
    });
    await page.getByRole("button", { name: "Retry copy" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Exact planned bytes copied.",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    // A delayed success for an old example must never appear in its replacement.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((resolve) => {
              (window as unknown as { finishCopy: () => void }).finishCopy =
                resolve;
            }),
        },
      });
    });
    await page
      .getByRole("button", { name: "Copy packet bytes", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Copying planned bytes…");
    await example.selectOption("asymmetric");
    await page.evaluate(() =>
      (window as unknown as { finishCopy: () => void }).finishCopy(),
    );
    await expect(page.getByRole("status")).toBeEmpty();
    let sourceRequests = 0;
    await page.route("**/knowledge-v1.json", (route) => {
      sourceRequests++;
      return sourceRequests === 1
        ? route.fulfill({ status: 503, body: "controlled failure" })
        : route.continue();
    });
    await page
      .getByText("Reference, sources and firmware limitations", { exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Source detail is unavailable",
    );
    await page.getByRole("button", { name: "Retry source detail" }).click();
    await expect(
      page.getByRole("link", {
        name: "file-fossasia-badgemagic-firmware-BadgeBLE-md",
        exact: true,
      }),
    ).toBeVisible();
    expect(sourceRequests).toBe(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.getByRole("button", { name: /send|connect/i }).count(),
    ).toBe(0);
    expect(await page.getByLabel(/Exact planned packet/).count()).toBe(1);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/lsled-offline-${width}-sources.png`,
      fullPage: true,
    });
    await page
      .getByText("Reference, sources and firmware limitations", { exact: true })
      .click();
    await page.screenshot({
      path: `/tmp/lsled-offline-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "MatrixSmith home" }).click();
    await page
      .getByRole("link", { name: "Open offline LSLED preview" })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Example", exact: true }),
    ).toHaveValue("blank");
    await expect(page.getByRole("status")).toBeEmpty();
  });
}
