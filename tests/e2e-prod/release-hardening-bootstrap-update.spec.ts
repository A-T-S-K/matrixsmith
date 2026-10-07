import { expect, test, type Page } from "@playwright/test";

async function installed(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}
async function build(page: Page): Promise<string> {
  return page.evaluate(
    async () =>
      (await (await fetch("./build-metadata.json")).json()).buildId as string,
  );
}
async function bypassCache(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setBypassServiceWorker", { bypass: true });
}

function readyReply(
  page: Page,
): Promise<{ ready: boolean; reason: string | null }> {
  return page.evaluate(async () => {
    const channel = new MessageChannel();
    const reply = new Promise<{ ready: boolean; reason: string | null }>(
      (resolve) => {
        channel.port1.onmessage = (event) => {
          resolve(event.data);
          channel.port1.close();
          channel.port2.close();
        };
      },
    );
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "matrixsmith:check-ready" },
        ports: [channel.port2],
      }),
    );
    return reply;
  });
}

test.beforeEach(async ({ request }) => {
  await request.get("/__test/release/a");
});

test("injected readiness port refuses a pending chooser and reserves startup before replying", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      const controls = globalThis as unknown as { selections: number };
      controls.selections = 0;
      Object.defineProperty(navigator, "bluetooth", {
        configurable: true,
        value: {
          getDevices: async () => [],
          requestDevice: () => {
            controls.selections++;
            return new Promise(() => {});
          },
        },
      });
    });
    await page.goto("/");
    const readiness = () => readyReply(page);
    expect(await readiness()).toEqual({ ready: true, reason: null });
    // The real update notice makes main inert. Exercise a queued activation
    // directly as well, so startup's own reservation check must still refuse it.
    await page
      .locator("button.hero-cta")
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("alert")).toContainText(
      "update is being applied",
    );
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { selections: number }).selections,
      ),
    ).toBe(0);
    await page.evaluate(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "matrixsmith:update-cancelled" },
        }),
      ),
    );
    await page
      .getByRole("button", { name: "Connect a display", exact: true })
      .click();
    expect(await readiness()).toMatchObject({
      ready: false,
      reason: "Finish opening the workspace before updating.",
    });
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { selections: number }).selections,
      ),
    ).toBe(1);
  } finally {
    await context.close();
  }
});

test("another tab cannot update during chooser, import or initialization; cancellation permits retry", async ({
  page,
  context,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installed(page);
  const original = await build(page);
  const other = await context.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  await other.addInitScript(() => {
    const controls = globalThis as unknown as {
      cancelChooser: () => void;
      finishInitialization: () => void;
      selections: number;
    };
    controls.selections = 0;
    let requests = 0;
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        getDevices: () =>
          ++requests === 1
            ? Promise.resolve([])
            : new Promise<[]>((resolve) => {
                controls.finishInitialization = () => resolve([]);
              }),
        requestDevice: () => {
          controls.selections++;
          return new Promise((_resolve, reject) => {
            controls.cancelChooser = () =>
              reject(new DOMException("Chooser cancelled", "NotFoundError"));
          });
        },
      },
    });
  });
  await installed(other);
  await bypassCache(other);
  let releaseImport: (() => void) | undefined;
  const importStarted = deferred<void>();
  const importGate = deferred<void>();
  const runtimeChunk = /\/assets\/application-bootstrap-.*\.js/;
  await other.route(runtimeChunk, async (route) => {
    const response = await route.fetch();
    releaseImport = () => importGate.resolve();
    importStarted.resolve();
    await importGate.promise;
    await route.fulfill({ response });
  });
  await other
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await importStarted.promise;
  await request.get("/__test/release/b");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  const apply = page.getByRole("button", { name: "Update and reload" });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.getByRole("alert")).toContainText("Another app tab");
  expect(await build(page)).toBe(original);
  await page.screenshot({
    path: testInfo.outputPath("blocked-chooser-and-import.png"),
  });
  // Cancellation alone cannot release the outstanding runtime import.
  await other.evaluate(() =>
    (globalThis as unknown as { cancelChooser: () => void }).cancelChooser(),
  );
  await apply.click();
  await expect(page.getByRole("alert")).toContainText("Another app tab");
  expect(await build(page)).toBe(original);
  releaseImport!();
  await other.waitForFunction(
    () =>
      typeof (globalThis as unknown as { finishInitialization?: () => void })
        .finishInitialization === "function",
  );
  // Construction completed, but initialize() is still awaiting getDevices().
  await apply.click();
  await expect(page.getByRole("alert")).toContainText("Another app tab");
  expect(await build(page)).toBe(original);
  await other.evaluate(() =>
    (
      globalThis as unknown as { finishInitialization: () => void }
    ).finishInitialization(),
  );
  await expect(
    other.getByRole("heading", { name: /Make the display/i }),
  ).toBeVisible();
  expect(
    await other.evaluate(
      () => (globalThis as unknown as { selections: number }).selections,
    ),
  ).toBe(1);
  await apply.click();
  await expect
    .poll(() =>
      build(page)
        .then((value) => value !== original)
        .catch(() => false),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("bootstrap initialization failure releases readiness and safe reload retries without a chooser", async ({
  page,
  context,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installed(page);
  const original = await build(page);
  const other = await context.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  await installed(other);
  await bypassCache(other);
  const runtimeChunk = /\/assets\/application-bootstrap-.*\.js/;
  let injected = false;
  await other.route(runtimeChunk, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const modified = source.replace(
      /(Promise\.allSettled\(\[\s*)\w+\.initialize\(\)/,
      '$1Promise.reject(new Error("controlled initialization failure"))',
    );
    expect(modified).not.toBe(source);
    injected = true;
    await route.fulfill({ response, body: modified });
  });
  // Navigate within the existing controlled tab; bypass only its fetch cache.
  await other.goto("/?startup-failure=1#/device/create");
  await expect(
    other.getByRole("heading", { name: "MatrixSmith unavailable" }),
  ).toBeVisible();
  expect(injected).toBe(true);
  await other.screenshot({
    path: testInfo.outputPath("initialization-failed.png"),
  });
  // Readiness must recover on the failed document, before any reload can
  // discard the failed owner's state. Release this injected reservation only.
  expect(await readyReply(other)).toEqual({ ready: true, reason: null });
  await other.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "matrixsmith:update-cancelled" },
      }),
    ),
  );
  await other.unroute(runtimeChunk);
  await other
    .getByRole("button", { name: "Retry loading MatrixSmith" })
    .click();
  await expect(
    other.getByRole("heading", { name: "Connect a display", exact: true }),
  ).toBeVisible();
  await request.get("/__test/release/b");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await expect(
    page.getByRole("button", { name: "Update and reload" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect
    .poll(() =>
      build(page)
        .then((value) => value !== original)
        .catch(() => false),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
