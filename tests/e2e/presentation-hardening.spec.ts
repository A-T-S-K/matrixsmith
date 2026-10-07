import { expect, test } from "./fixtures";

test("scrolling advances through unrelated publications and unsupported text is explained", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("HELLO WORLD");
  await page
    .getByRole("combobox", { name: "Display", exact: true })
    .selectOption("scroll");
  const observed = await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const sequence = store.getSnapshot().content.textScrollPlan;
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[aria-label="Actual scrolling-text preview"] canvas',
    )!;
    const frames = new Set<string>();
    for (let i = 0; i < 30; i++) {
      store.controller.trace.record("app.started", {});
      frames.add(canvas.toDataURL());
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      unique: frames.size,
      same: sequence === store.getSnapshot().content.textScrollPlan,
    };
  });
  expect(observed.same).toBe(true);
  expect(observed.unique).toBeGreaterThan(1);
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("HI é😀");
  await expect(
    page.getByText(/These characters will appear as boxes/),
  ).toBeVisible();
  await expect(page.getByText(/6 \/ 512 text units/)).toBeVisible();
});

test("Home diagnosis preserves connection and blocked connection actions explain why", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  const before = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    store.goHome();
    return store.transport.connectionId;
  });
  await expect(
    page.getByRole("button", { name: "Choose device →" }),
  ).toBeDisabled();
  await expect(
    page
      .getByText("Return to the live display before choosing another device.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start diagnosis →" }).click();
  await expect(
    page.getByRole("button", { name: "Device actions" }),
  ).toBeVisible();
  const after = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    return {
      generation: store.transport.connectionId,
      view: store.getSnapshot().view,
      connected: store.getSnapshot().liveConnected,
    };
  });
  expect(after).toEqual({
    generation: before,
    view: "diagnose",
    connected: true,
  });
  await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const bundle = store.controller.exportBundle();
    await store.disconnect();
    store.importBundle(bundle);
    store.goHome();
  });
  await expect(
    page.getByRole("button", { name: "Connect a display" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start diagnosis →" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Choose device →" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Retained live display · disconnected" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect a display" }).click();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to retained report" }),
  ).toBeVisible();
});

test("menu-launched report restores stable trigger focus through Escape and Browser Back", async ({
  page,
}) => {
  let releaseView!: () => void;
  const viewGate = new Promise<void>((resolve) => {
    releaseView = resolve;
  });
  await page.route(/\/src\/ui\/views\/ControlView\.tsx/, async (route) => {
    await viewGate;
    await route.continue();
  });
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  const trigger = page.getByRole("button", { name: "Device actions" });
  for (const method of ["escape", "back"] as const) {
    await trigger.focus();
    await page.keyboard.press("Enter");
    const report = page.getByRole("button", { name: "Share report…" });
    await report.focus();
    if (method === "escape") {
      releaseView();
      await expect(
        page.getByRole("heading", { name: "Create", exact: true }),
      ).toBeVisible();
      await expect(report).toBeFocused();
    }
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveJSProperty("inert", true);
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    if (method === "escape") await page.keyboard.press("Escape");
    else await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator(".app-shell")).toHaveJSProperty("inert", false);
  }
});

test("late Create view preserves keyboard focus on the device action trigger", async ({
  page,
}) => {
  let releaseView!: () => void;
  const viewGate = new Promise<void>((resolve) => {
    releaseView = resolve;
  });
  await page.route(/\/src\/ui\/views\/ControlView\.tsx/, async (route) => {
    await viewGate;
    await route.continue();
  });
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  const trigger = page.getByRole("button", { name: "Device actions" });
  await trigger.focus();
  releaseView();
  await expect(
    page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const report = page.getByRole("button", { name: "Share report…" });
  await report.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("image reports actual target geometry, manual and Legacy modes remain selectable", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    Object.assign(store.controller.session, {
      profile: { ...store.controller.session.profile!, width: 16, height: 8 },
    });
    store.controller.trace.record("app.started", {});
  });
  await page
    .getByRole("tab", { name: "Imagenot yet verified", exact: true })
    .click();
  const input = page.locator('input[accept="image/png,image/jpeg,image/webp"]');
  await input.setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Image header is malformed",
  );
  await input.setInputFiles(
    "research/image-reduction/fixtures/transparent.png",
  );
  const mode = page.getByRole("combobox", { name: "Mode", exact: true });
  await expect(mode).toBeVisible();
  await expect(
    page.locator(".content-editor p.fineprint").filter({ hasText: /^16×8 ·/ }),
  ).toBeVisible();
  await mode.selectOption("photo");
  await expect(
    page.getByText("Photo · manually selected", { exact: true }),
  ).toBeVisible();
  await mode.selectOption("legacy");
  await expect(mode).toHaveValue("legacy");
  await expect(page.getByText(/16×8 · Legacy \/ Smooth/)).toBeVisible();
  await mode.selectOption("auto");
  await expect(
    page.locator("p.notice").filter({ hasText: /^Auto/ }).first(),
  ).toBeVisible();
});

test("external-store bridge handles mount races, store replacement and cleanup", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  const result = await page.evaluate(async () => {
    const preactPath = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname.endsWith("/preact.js"));
    if (!preactPath)
      throw new Error("The application's Preact module was not observed.");
    const hookPath = "/src/presentation/state/selectors.ts";
    const { h, render } = await import(/* @vite-ignore */ preactPath);
    const { useMatrixSnapshot } = await import(/* @vite-ignore */ hookPath);
    const root = document.createElement("div");
    document.body.append(root);
    const counts = { subscriptions: 0, cleanups: 0 };
    const makeStore = (initial: number, race: boolean) => {
      let value = initial;
      const listeners = new Set<() => void>();
      return {
        getSnapshot: () => {
          if (race) {
            race = false;
            queueMicrotask(() => {
              value++;
              for (const listener of listeners) listener();
            });
          }
          return value;
        },
        subscribe: (listener: () => void) => {
          counts.subscriptions++;
          listeners.add(listener);
          return () => {
            counts.cleanups++;
            listeners.delete(listener);
          };
        },
        publish: (next: number) => {
          value = next;
          for (const listener of listeners) listener();
        },
      };
    };
    const first = makeStore(1, true);
    const second = makeStore(10, false);
    const View = ({ store }: { store: typeof first }) =>
      h("span", null, String(useMatrixSnapshot(store)));
    const settle = async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    render(h(View, { store: first }), root);
    await settle();
    const mounted = root.textContent;
    render(h(View, { store: second }), root);
    await settle();
    const replaced = root.textContent;
    first.publish(3);
    second.publish(11);
    await settle();
    const updated = root.textContent;
    render(null, root);
    await settle();
    root.remove();
    return { mounted, replaced, updated, ...counts };
  });
  expect(result).toEqual({
    mounted: "2",
    replaced: "10",
    updated: "11",
    subscriptions: 2,
    cleanups: 2,
  });
});

test("guided elapsed timer advances locally without snapshot publications", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
  });
  await expect(page.getByRole("timer")).toBeVisible();
  const result = await page.evaluate(async () => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const before = document.querySelector('[role="timer"]')!.textContent;
    let publications = 0;
    const cleanup = store.subscribe(() => publications++);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    cleanup();
    return {
      before,
      after: document.querySelector('[role="timer"]')!.textContent,
      publications,
    };
  });
  expect(result.after).not.toBe(result.before);
  expect(result.publications).toBe(0);
});

test("cold and warm Home refresh relevant storage changes while saved summaries remain non-authorizing", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.evaluate(() => {
    const key = "matrixsmith:v2:investigations";
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 2,
        investigations: [
          {
            savedAt: "2026-10-02T00:00:00Z",
            investigation: {
              deviceName: "Saved display",
              goal: { kind: "develop" },
              completedTests: [],
            },
          },
        ],
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key, storageArea: localStorage }),
    );
  });
  await expect(page.getByText(/Saved display · 0 completed/)).toBeVisible();
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page.getByRole("button", { name: /back to MatrixSmith home/ }).click();
  await expect(page.getByText(/Saved display · 0 completed/)).toBeVisible();
  await page.evaluate(() => {
    const key = "matrixsmith:v2:investigations";
    localStorage.setItem(
      key,
      localStorage.getItem(key)!.replace("Saved display", "External display"),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "unrelated-key",
        storageArea: localStorage,
      }),
    );
  });
  await expect(page.getByText(/Saved display · 0 completed/)).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "matrixsmith:v2:investigations",
        storageArea: localStorage,
      }),
    ),
  );
  await expect(page.getByText(/External display · 0 completed/)).toBeVisible();
  await page
    .getByRole("button", { name: "Review saved investigation" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "No stored investigation found",
  );
  await page.evaluate(() => {
    localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: localStorage }),
    );
  });
  await expect(
    page.getByRole("heading", { name: "Saved investigation" }),
  ).toHaveCount(0);
});
