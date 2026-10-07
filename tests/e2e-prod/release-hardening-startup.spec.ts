import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceStore } from "../../src/presentation/state/workspace-store";

// Observe the production bootstrap at its initialization boundary without adding
// a shipped test hook. Match the emitted operation before modifying the fixture.
async function observeWorkspace(page: Page): Promise<void> {
  await page.route(/\/assets\/application-bootstrap-.*\.js/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const modified = source.replace(
      /(Promise\.allSettled\(\[\s*)(\w+)\.initialize\(\)/,
      "$1((window.observedWorkspaces??=[]).push($2),$2.initialize())",
    );
    expect(modified).not.toBe(source);
    await route.fulfill({ response, body: modified });
  });
}

type ObservedStore = {
  workspaceStore: Pick<WorkspaceStore, "getController" | "getTransport">;
  snapshotStore: object;
  subscribe: object;
};

function currentIdentity() {
  const stores = (
    window as unknown as Window & { observedWorkspaces: ObservedStore[] }
  ).observedWorkspaces;
  const store = stores[0]!;
  return {
    store,
    controller: store.workspaceStore.getController(),
    transport: store.workspaceStore.getTransport(),
    snapshot: store.snapshotStore,
    subscribe: store.subscribe,
    constructions: stores.length,
  };
}

function captureSafety() {
  const observed = window as unknown as Window & {
    observedWorkspaces: ObservedStore[];
    observedWriteCount: () => number;
  };
  const controller =
    observed.observedWorkspaces[0]!.workspaceStore.getController();
  return {
    source: controller.session.source,
    authority: controller.session.identityAuthorityRevision,
    experimental: controller.session.experimentalTxEnabled,
    confirmation: controller.session.confirmedPlanDigest,
    transactions: controller.transactions.map((transaction) => transaction.id),
    writes: observed.observedWriteCount(),
  };
}

async function recordedBundle(): Promise<Buffer> {
  // This Node-side fixture has an explicit software version; no transport or
  // registry is constructed. The browser still validates the portable bundle.
  (globalThis as Record<string, unknown>).__MATRIXSMITH_VERSION__ =
    "0.1.0+software-fixture";
  const { createDiagnosticBundle, serializeDiagnosticBundle } =
    await import("../../src/diagnostics/bundle");
  return Buffer.from(
    serializeDiagnosticBundle(
      createDiagnosticBundle({
        fingerprint: JSON.parse(
          readFileSync(
            new URL(
              "../fixtures/devices/iledhat-31ae-32x16.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
        driverMatches: [],
        selectedDriver: null,
        selectedProfile: null,
        capabilities: [],
        trace: [],
        observations: [],
      }),
    ),
  );
}

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ request }) => {
  await request.get("/__test/release/a");
});

for (const [route, chunk, label, heading] of [
  [
    "/#/device/create",
    "application-bootstrap",
    "MatrixSmith",
    "Connect a display",
  ],
  ["/?demo=1", "Demo", "demo", "MatrixSmith"],
] as const) {
  test(`${label} download failure offers recovery and reload succeeds`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const resource = new RegExp(`/assets/${chunk}-.*\\.js`);
    let failures = 0;
    await page.route(resource, async (request) => {
      failures++;
      await request.abort("failed");
    });
    await page.goto(route!);
    await expect(
      page.getByRole("heading", { name: `${label} unavailable`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `${label} unavailable`, exact: true }),
    ).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`${label}-failed.png`) });
    expect(failures).toBeGreaterThan(0);
    await page.unroute(resource);
    await page.getByRole("button", { name: `Retry loading ${label}` }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const failedChunk of ["DevelopView"]) {
  test(`failed ${failedChunk} retries while retaining the imported workspace`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const chunk = new RegExp(`/assets/${failedChunk}-.*\\.js`);
    let downloads = 0;
    page.on("request", (request) => {
      if (chunk.test(request.url())) downloads++;
    });
    await page.route(chunk, async (route) => {
      await route.abort("failed");
    });
    await observeWorkspace(page);
    await page.goto("/");
    const originalDocument = await page.evaluateHandle(() => document);
    await page.locator('input[accept=".txt,.log,text/plain"]').setInputFiles({
      name: "software-capture.txt",
      mimeType: "text/plain",
      buffer: readFileSync(
        new URL("../fixtures/nrf/iledhat-session.txt", import.meta.url),
      ),
    });
    await expect(
      page.getByRole("heading", { name: "Protocol workbench unavailable" }),
    ).toBeVisible();
    await expect(page.getByText(/Imported .*transaction/)).toBeVisible();
    const identity = await page.evaluateHandle(currentIdentity);
    await expect(
      page.getByRole("heading", { name: "Protocol workbench unavailable" }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath("workbench-failed.png"),
    });
    // The report goal belongs to this in-memory workspace; do not export it.
    await page.getByRole("button", { name: "Device actions" }).click();
    await page.getByRole("button", { name: "Share report…" }).click();
    await page.getByRole("radio", { name: "Canonical device report" }).check();
    await page
      .getByRole("textbox", { name: "Goal / question" })
      .fill("Retain this unsaved recovery goal");
    await page.getByRole("button", { name: "Close report" }).click();
    await page.evaluate(() => {
      const observed = window as unknown as Window & {
        observedWorkspaces: ObservedStore[];
        observedWriteCount: () => number;
      };
      const transport =
        observed.observedWorkspaces[0]!.workspaceStore.getTransport();
      const write = transport.write.bind(transport);
      let calls = 0;
      transport.write = (...args) => {
        calls++;
        return write(...args);
      };
      observed.observedWriteCount = () => calls;
    });
    const safety = await page.evaluate(captureSafety);
    expect(safety.source).toBe("imported");
    expect(safety.experimental).toBe(false);
    expect(safety.confirmation).toBeNull();
    expect(safety.writes).toBe(0);
    await page
      .getByRole("complementary")
      .getByRole("button", { name: /Investigate/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Reopen diagnostic report" }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/#\/device\/investigate$/);
    await page.getByRole("button", { name: "Device actions" }).click();
    await page
      .getByRole("button", { name: "Developer tools", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Protocol workbench unavailable" }),
    ).toBeVisible();
    expect(downloads).toBe(1);
    await page.unroute(chunk);
    await page
      .getByRole("button", { name: "Retry Protocol workbench", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Protocol workbench sections" }),
    ).toBeVisible();
    await expect(page.locator(".transaction-row").first()).toBeVisible();
    await page.locator(".transaction-row").first().click();
    await expect(
      page.getByRole("heading", { name: "Transaction detail" }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.locator(".transaction-row").first()).toBeVisible();
    await page.goForward();
    await expect(
      page.getByRole("heading", { name: "Transaction detail" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Return to transactions" }).click();
    await page
      .getByRole("complementary")
      .getByRole("button", { name: /Investigate/ })
      .click();
    await expect(page).toHaveURL(/#\/device\/investigate$/);
    await expect(
      page.getByRole("heading", { name: "Reopen diagnostic report" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Device actions" }).click();
    await page
      .getByRole("button", { name: "Developer tools", exact: true })
      .click();
    await expect(page.locator(".transaction-row").first()).toBeVisible();
    await page
      .getByRole("button", { name: /back to MatrixSmith home/ })
      .click();
    await expect(page).toHaveURL(/#\/home$/);
    await page.goBack();
    await expect(page.locator(".transaction-row").first()).toBeVisible();
    expect(await page.evaluate(captureSafety)).toEqual(safety);
    // Recovery must re-request the failed resource and preserve the existing store.
    expect(downloads).toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate((before) => {
        const stores = (
          window as unknown as Window & { observedWorkspaces: ObservedStore[] }
        ).observedWorkspaces;
        const store = stores[0]!;
        return (
          stores.length === 1 &&
          before.constructions === 1 &&
          store === before.store &&
          store.workspaceStore.getController() === before.controller &&
          store.workspaceStore.getTransport() === before.transport &&
          store.snapshotStore === before.snapshot &&
          store.subscribe === before.subscribe
        );
      }, identity),
    ).toBe(true);
    expect(
      await page.evaluate(
        (original) => document === original,
        originalDocument,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Device actions" }).click();
    await page.getByRole("button", { name: "Share report…" }).click();
    await expect(
      page.getByRole("textbox", { name: "Goal / question" }),
    ).toHaveValue("Retain this unsaved recovery goal");
    expect(errors).toEqual([]);
  });
}

for (const failedChunk of ["application-bootstrap", "known-profiles"]) {
  test(`${failedChunk} download retry retains the selected capture before workspace construction`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const chunk = new RegExp(`/assets/${failedChunk}-.*\\.js`);
    let downloads = 0;
    page.on("request", (request) => {
      if (chunk.test(request.url())) downloads++;
    });
    await page.route(chunk, (route) => route.abort("failed"));
    await page.goto("/");
    const originalDocument = await page.evaluateHandle(() => document);
    await page.locator('input[accept=".txt,.log,text/plain"]').setInputFiles({
      name: "retained-capture.txt",
      mimeType: "text/plain",
      buffer: readFileSync(
        new URL("../fixtures/nrf/iledhat-session.txt", import.meta.url),
      ),
    });
    await expect(
      page.getByRole("heading", { name: "MatrixSmith unavailable" }),
    ).toBeFocused();
    await page.unroute(chunk);
    await page
      .getByRole("button", { name: "Retry loading MatrixSmith" })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Protocol workbench sections" }),
    ).toBeVisible();
    await expect(page.locator(".transaction-row").first()).toBeVisible();
    await expect(page.getByText(/Imported .*transaction/)).toBeVisible();
    expect(downloads).toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate(
        (original) => document === original,
        originalDocument,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("a workbench programming error is surfaced instead of labeled a download failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/assets\/DevelopView-.*\.js/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\nthrow new Error("controlled workbench programming error");`,
    });
  });
  await page.goto("/");
  await page.locator('input[accept=".txt,.log,text/plain"]').setInputFiles({
    name: "software-capture.txt",
    mimeType: "text/plain",
    buffer: readFileSync(
      new URL("../fixtures/nrf/iledhat-session.txt", import.meta.url),
    ),
  });
  await expect
    .poll(() => errors)
    .toContain("controlled workbench programming error");
  await expect(
    page.getByRole("region", { name: "Protocol workbench recovery" }),
  ).toHaveCount(0);
});

test("a second workbench download failure exhausts the single retry without reloading", async ({
  page,
}) => {
  let downloads = 0;
  await page.route(/\/assets\/DevelopView-.*\.js/, async (route) => {
    downloads++;
    await route.abort("failed");
  });
  await page.goto("/");
  const originalDocument = await page.evaluateHandle(() => document);
  await page.locator('input[accept=".txt,.log,text/plain"]').setInputFiles({
    name: "software-capture.txt",
    mimeType: "text/plain",
    buffer: readFileSync(
      new URL("../fixtures/nrf/iledhat-session.txt", import.meta.url),
    ),
  });
  const retry = page.getByRole("button", {
    name: "Retry Protocol workbench",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await retry.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("alert")).toContainText(
    "Retry failed. Your workspace is still open.",
  );
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Go to Home" })).toBeVisible();
  expect(downloads).toBe(2);
  expect(
    await page.evaluate((original) => document === original, originalDocument),
  ).toBe(true);
  await expect(page.getByText(/Imported .*transaction/)).toBeVisible();
});

test("the generated import map is accepted and a changed map is blocked by strict CSP", async ({
  page,
  context,
}) => {
  const listen = () => {
    const state = window as unknown as Window & { mapViolations?: string[] };
    state.mapViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      state.mapViolations!.push(
        `${event.effectiveDirective}:${event.blockedURI}`,
      );
    });
  };
  await page.addInitScript(listen);
  await page.goto("/index.html");
  await expect(
    page.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  expect(await page.locator('script[type="importmap"]').count()).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as Window & { mapViolations: string[] })
          .mapViolations,
    ),
  ).toEqual([]);
  const changed = await context.newPage();
  await changed.addInitScript(listen);
  await changed.route(/^http:\/\/127\.0\.0\.1:4174\/$/, async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    expect(original).toContain('<script type="importmap">');
    await route.fulfill({
      response,
      body: original.replace(
        '<script type="importmap">',
        '<script type="importmap">\n',
      ),
    });
  });
  await changed.goto("/");
  await expect
    .poll(() =>
      changed.evaluate(
        () =>
          (window as unknown as Window & { mapViolations: string[] })
            .mapViolations,
      ),
    )
    .toContain("script-src-elem:inline");
});

test.describe("installed worker native recovery", () => {
  test.use({ serviceWorkers: "allow" });
  test("offline startup child recovery preserves the selected capture and revised dependency graph", async ({
    page,
    context,
  }, testInfo) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() =>
      Boolean(navigator.serviceWorker.controller),
    );
    const originalDocument = await page.evaluateHandle(() => document);
    const removed = await page.evaluate(async () => {
      const state = window as unknown as Window & {
        removedRecoveryResponses?: {
          cache: string;
          url: string;
          response: Response;
        }[];
      };
      state.removedRecoveryResponses = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const key of await cache.keys()) {
          if (!/\/assets\/known-profiles-.*\.js$/.test(key.url)) continue;
          state.removedRecoveryResponses.push({
            cache: name,
            url: key.url,
            response: (await cache.match(key))!,
          });
          await cache.delete(key);
        }
      }
      return state.removedRecoveryResponses.map(({ url }) => url);
    });
    expect(removed.length).toBeGreaterThan(0);
    await context.setOffline(true);
    await page.locator('input[accept=".txt,.log,text/plain"]').setInputFiles({
      name: "offline-retained-capture.txt",
      mimeType: "text/plain",
      buffer: readFileSync(
        new URL("../fixtures/nrf/iledhat-session.txt", import.meta.url),
      ),
    });
    await expect(
      page.getByRole("heading", { name: "MatrixSmith unavailable" }),
    ).toBeFocused();
    // Restore the same cached network Response, including its original URL.
    // The actual installed worker must preserve revised importer resolution.
    await page.evaluate(async () => {
      const state = window as unknown as Window & {
        removedRecoveryResponses: {
          cache: string;
          url: string;
          response: Response;
        }[];
      };
      for (const asset of state.removedRecoveryResponses)
        await (await caches.open(asset.cache)).put(asset.url, asset.response);
    });
    await page
      .getByRole("button", { name: "Retry loading MatrixSmith" })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Protocol workbench sections" }),
    ).toBeVisible();
    await expect(page.locator(".transaction-row").first()).toBeVisible();
    await expect(page.getByText(/Imported .*transaction/)).toBeVisible();
    expect(
      await page.evaluate(
        (original) => document === original,
        originalDocument,
      ),
    ).toBe(true);
    expect(
      requests.some((url) =>
        /known-profiles-.*\.js\?matrixsmith-retry=a1$/.test(url),
      ),
    ).toBe(true);
    expect(
      requests.filter((url) => url.includes("matrixsmith-retry=a1")).length,
    ).toBeGreaterThan(1);
    await page.getByRole("button", { name: "Device actions" }).click();
    await page.getByRole("button", { name: "Share report…" }).click();
    await page.getByRole("radio", { name: "Canonical device report" }).check();
    await page
      .getByRole("textbox", { name: "Goal / question" })
      .fill("offline recovered application goal");
    await page.getByRole("button", { name: "Close report" }).click();
    await page.getByRole("button", { name: "Device actions" }).click();
    await page.getByRole("button", { name: "Share report…" }).click();
    await expect(
      page.getByRole("textbox", { name: "Goal / question" }),
    ).toHaveValue("offline recovered application goal");
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("offline-native-recovered.png"),
    });
  });
});

test("a workbench root retry retains prior advisory state and workspace owners", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const chunk = /\/assets\/DevelopView-.*\.js/;
  let downloads = 0;
  page.on("request", (request) => {
    if (chunk.test(request.url())) downloads++;
  });
  await page.route(chunk, (route) => route.abort("failed"));
  await observeWorkspace(page);
  await page.goto("/");
  const originalDocument = await page.evaluateHandle(() => document);
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: "recorded-evidence.json",
    mimeType: "application/json",
    buffer: await recordedBundle(),
  });
  await expect(
    page.getByRole("heading", { name: "Offline report", exact: true }),
  ).toBeVisible();
  const identity = await page.evaluateHandle(currentIdentity);
  await page
    .getByRole("button", { name: "Explain plausible families" })
    .click();
  await page.getByText(/Search the reference index/).click();
  await page
    .getByRole("textbox", { name: "Reference search" })
    .fill("retained advisory query");
  await page.getByRole("button", { name: "Device actions" }).click();
  await page
    .getByRole("button", { name: "Developer tools", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Protocol workbench unavailable" }),
  ).toBeFocused();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /Investigate/ })
    .click();
  await page.getByText(/Search the reference index/).click();
  await expect(
    page.getByRole("textbox", { name: "Reference search" }),
  ).toHaveValue("retained advisory query");
  await page.getByRole("button", { name: "Device actions" }).click();
  await page
    .getByRole("button", { name: "Developer tools", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Protocol workbench unavailable" }),
  ).toBeVisible();
  expect(downloads).toBe(1);
  await page.unroute(chunk);
  await page
    .getByRole("button", { name: "Retry Protocol workbench", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Protocol workbench sections" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Protocol candidates", exact: true })
    .click();
  await page.getByText(/Search the reference index/).click();
  await expect(
    page.getByRole("textbox", { name: "Reference search" }),
  ).toHaveValue("retained advisory query");
  expect(downloads).toBe(2);
  expect(
    await page.evaluate((original) => document === original, originalDocument),
  ).toBe(true);
  expect(
    await page.evaluate((before) => {
      const stores = (
        window as unknown as Window & { observedWorkspaces: ObservedStore[] }
      ).observedWorkspaces;
      const store = stores[0]!;
      return (
        stores.length === 1 &&
        store === before.store &&
        store.workspaceStore.getController() === before.controller &&
        store.workspaceStore.getTransport() === before.transport &&
        store.snapshotStore === before.snapshot &&
        store.subscribe === before.subscribe
      );
    }, identity),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("recovered startup child supports advisory and local profile helpers without replacing its workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const child = /\/assets\/known-profiles-.*\.js/;
  await page.route(child, (route) => route.abort("failed"));
  await observeWorkspace(page);
  await page.goto("/");
  const originalDocument = await page.evaluateHandle(() => document);
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: "recorded-evidence.json",
    mimeType: "application/json",
    buffer: await recordedBundle(),
  });
  await expect(
    page.getByRole("heading", { name: "MatrixSmith unavailable" }),
  ).toBeFocused();
  await page.unroute(child);
  await page.getByRole("button", { name: "Retry loading MatrixSmith" }).click();
  await expect(
    page.getByRole("heading", { name: "Offline report", exact: true }),
  ).toBeVisible();
  const identity = await page.evaluateHandle(currentIdentity);
  await page
    .getByRole("button", { name: "Explain plausible families" })
    .click();
  await page.getByText(/Search the reference index/).click();
  await expect(
    page.getByRole("textbox", { name: "Reference search" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Reference search" }).fill("CoolLED");
  await expect(
    page
      .locator(".knowledge-advisory details")
      .filter({ has: page.getByRole("textbox", { name: "Reference search" }) })
      .locator(":scope > ul > li")
      .filter({ hasText: /CoolLED/i })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /back to MatrixSmith home/ }).click();
  await page
    .locator('input[accept=".json,application/json"]')
    .first()
    .setInputFiles({
      name: "banner.profile.json",
      mimeType: "application/json",
      buffer: readFileSync(
        new URL(
          "../../src/profiles/data/authored-ux-banner.json",
          import.meta.url,
        ),
      ),
    });
  await expect(
    page.getByRole("heading", { name: "Local profile review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load reviewed profile" }),
  ).toBeEnabled();
  expect(
    await page.evaluate((original) => document === original, originalDocument),
  ).toBe(true);
  expect(
    await page.evaluate((before) => {
      const stores = (
        window as unknown as Window & { observedWorkspaces: ObservedStore[] }
      ).observedWorkspaces;
      const store = stores[0]!;
      return (
        stores.length === 1 &&
        store === before.store &&
        store.workspaceStore.getController() === before.controller &&
        store.workspaceStore.getTransport() === before.transport &&
        store.snapshotStore === before.snapshot &&
        store.subscribe === before.subscribe
      );
    }, identity),
  ).toBe(true);
  expect(errors).toEqual([]);
});
