import { qualificationArtifactPath } from "../helpers/qualification-paths";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [390, 1280]) {
  test(`shared explorer switches delivery contracts at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/?offline=1");
    const implementation = page.getByRole("combobox", {
      name: "Implementation",
      exact: true,
    });
    await expect(page.getByLabel("Exact planned packet 0")).toContainText(
      "77 61 6E 67",
    );
    await page
      .getByRole("combobox", { name: "Example", exact: true })
      .selectOption("asymmetric");
    await page
      .getByRole("combobox", { name: "Packet index", exact: true })
      .selectOption("8");
    await page
      .getByRole("button", { name: "Copy packet bytes", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Exact planned bytes copied.",
    );
    await implementation.focus();
    await implementation.selectOption("microbit");
    await expect(implementation).toBeFocused();
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(
      page.getByRole("combobox", { name: "Packet index", exact: true }),
    ).toHaveValue("0");
    await expect(
      page
        .getByRole("combobox", { name: "Packet index", exact: true })
        .locator("option"),
    ).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("combobox", { name: "Example", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("combobox", { name: "Example", exact: true })
      .selectOption("asymmetric");
    await expect(
      page.getByRole("img", {
        name: "asymmetric logical pixels, 5 columns and 5 rows",
      }),
    ).toBeVisible();
    await expect(page.locator("canvas")).toHaveAttribute("width", "5");
    await expect(page.locator("canvas")).toHaveAttribute("height", "5");
    await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
      "10 01 08 04 12",
    );
    await expect(
      page.getByText(/Direct LED Matrix State characteristic value/),
    ).toBeVisible();
    await expect(
      page.getByText(/Pinned DAL stops display animation/),
    ).toBeVisible();
    await expect(
      page.getByText(/e95d7b77-251d-470a-a062-fa1922dfa9a8/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Copy all planned bytes" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Exact planned bytes copied.",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "10 01 08 04 12",
    );
    expect(
      requests.some((url) =>
        /application-bootstrap|drivers\/coolled|knowledge/.test(url),
      ),
    ).toBe(false);
    expect(
      await page.getByRole("button", { name: /send|connect/i }).count(),
    ).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: qualificationArtifactPath(
        test.info(),
        `microbit-offline-${width}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByText("Reference, sources and firmware limitations", { exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "microbit-dal-led-cpp", exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: qualificationArtifactPath(
        test.info(),
        `microbit-offline-${width}-sources.png`,
      ),
      fullPage: true,
    });
  });
}

test("unknown bounded and path-like IDs show selection without arbitrary imports", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/?offline=1&reference=..%2Fdrivers%2Fcoolled");
  await expect(page.getByRole("alert")).toContainText(
    "Unknown offline reference",
  );
  expect(
    requests.some((url) => /drivers\/coolled|offline-entries/.test(url)),
  ).toBe(false);
  await page
    .getByRole("combobox", { name: "Implementation" })
    .selectOption("microbit");
  await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
    "00 00 00 00 00",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("reference module failure reload retry retains selected reference", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/src/app/offline-entries/microbit.ts*", (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 503, body: "controlled failure" })
      : route.continue(),
  );
  await page.goto("/?offline=1&reference=microbit");
  await expect(page.getByRole("alert")).toContainText("Reference unavailable");
  await page.getByRole("button", { name: "Retry reference loading" }).click();
  await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
    "00 00 00 00 00",
  );
  await expect(
    page.getByRole("combobox", { name: "Implementation" }),
  ).toHaveValue("microbit");
  expect(attempts).toBe(2);
});

test("controlled compilation failure retries without a stale result", async ({
  page,
}) => {
  await page.route("**/src/app/offline-entries/lsled.ts*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "function compileOfflineExample(example) {",
      'function compileOfflineExample(example) { if (!globalThis.__failedCompile) { globalThis.__failedCompile = true; throw new Error("controlled compilation failure"); }',
    );
    await route.fulfill({ response, body });
  });
  await page.goto("/?offline=lsled");
  await expect(page.getByRole("alert")).toContainText(
    "controlled compilation failure",
  );
  await expect(page.getByLabel(/Exact planned packet/)).toHaveCount(0);
  await page.getByRole("button", { name: "Retry compilation" }).click();
  await expect(page.getByLabel("Exact planned packet 0")).toContainText(
    "77 61 6E 67",
  );
});

test("rapid switching suppresses delayed module completion", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen!: () => void;
  const requested = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route("**/src/app/offline-entries/microbit.ts*", async (route) => {
    seen();
    await gate;
    await route.continue();
  });
  await page.goto("/?offline=lsled");
  await expect(page.getByLabel("Exact planned packet 0")).toContainText(
    "77 61 6E 67",
  );
  const selector = page.getByRole("combobox", { name: "Implementation" });
  await selector.selectOption("microbit");
  await requested;
  await selector.selectOption("lsled");
  await expect(
    page.getByRole("img", { name: /44 columns and 11 rows/ }),
  ).toBeVisible();
  release();
  // Load the delayed module and then revisit it: a fresh owner may use the cached module.
  await page.waitForResponse((r) =>
    r.url().includes("offline-entries/microbit.ts"),
  );
  await expect(page.getByLabel("Exact planned packet 0")).toContainText(
    "77 61 6E 67",
  );
  await selector.selectOption("microbit");
  await expect(
    page.getByRole("img", { name: /5 columns and 5 rows/ }),
  ).toBeVisible();
});

test("entry switching suppresses old source and copy completions, including failures", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen!: () => void;
  const requested = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route("**/knowledge-v1.json", async (route) => {
    seen();
    await gate;
    await route.fulfill({ status: 503, body: "late source failure" });
  });
  await page.goto("/?offline=lsled");
  await expect(page.getByLabel("Exact planned packet 0")).toBeVisible();
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
  await page
    .getByText("Reference, sources and firmware limitations", { exact: true })
    .click();
  await requested;
  await page
    .getByRole("combobox", { name: "Implementation" })
    .selectOption("microbit");
  await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
    "00 00 00 00 00",
  );
  const finished = page.waitForResponse((r) =>
    r.url().includes("knowledge-v1.json"),
  );
  release();
  await finished;
  await page.evaluate(() =>
    (window as unknown as { finishCopy: () => void }).finishCopy(),
  );
  await expect(page.getByRole("status")).toBeEmpty();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.unroute("**/knowledge-v1.json");
  await page
    .getByText("Reference, sources and firmware limitations", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "microbit-dal-led-cpp", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "file-fossasia-badgemagic-firmware-BadgeBLE-md",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("delayed source success cannot replace the current entry citations", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen!: () => void;
  const requested = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route("**/knowledge-v1.json", async (route) => {
    const response = await route.fetch();
    seen();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto("/?offline=lsled");
  await expect(page.getByLabel("Exact planned packet 0")).toBeVisible();
  await page
    .getByText("Reference, sources and firmware limitations", { exact: true })
    .click();
  await requested;
  await page
    .getByRole("combobox", { name: "Implementation" })
    .selectOption("microbit");
  await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
    "00 00 00 00 00",
  );
  await page
    .getByText("Reference, sources and firmware limitations", { exact: true })
    .click();
  release();
  await expect(
    page.getByRole("link", { name: "microbit-dal-led-cpp", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "file-fossasia-badgemagic-firmware-BadgeBLE-md",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
