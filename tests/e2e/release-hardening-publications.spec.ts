import { test, expect } from "./fixtures";
import type { PresentationStore } from "../../src/presentation/store";

type PublicationWindow = Window & { matrixsmithStore: PresentationStore };

test("subscribed trace burst preserves review position, focus and preview, then recovers across report replacement", async ({
  page,
}, testInfo) => {
  await page.goto("/?sim#/home");
  await page
    .getByRole("button", { name: "Connect a display", exact: true })
    .click();
  await page.evaluate(() => {
    const store = (window as unknown as PublicationWindow).matrixsmithStore;
    store.updateContentSettings({ text: "Retained publication preview" });
    for (let i = 0; i < 50_000; i++)
      store.controller.trace.record("notification.raw", { index: i });
    store.setWorkbenchSection("raw");
    store.showLatest("raw");
    store.setReviewPage("raw", 999);
  });
  await expect(
    page.getByRole("heading", { name: "Raw events", exact: true }),
  ).toBeVisible();
  const latest = page.getByRole("button", { name: "Show latest", exact: true });
  await latest.focus();
  await page.evaluate(() => window.scrollTo(0, 160));
  const scrollPosition = await page.evaluate(() => window.scrollY);
  const counts = await page.evaluate(() => {
    const store = (window as unknown as PublicationWindow).matrixsmithStore;
    const snapshot = store["snapshotStore"];
    const rebuild = snapshot._rebuild.bind(snapshot);
    const project = store.reviewState.project.bind(store.reviewState);
    const before = store.getSnapshot();
    const frozen = before.review.events.map((row) => row.id);
    const preview = before.content.textPreview;
    const initialRawWork = store.reviewState.work.raw;
    const metrics = { rebuilds: 0, projections: 0, observers: 0, workload: 0 };
    snapshot._rebuild = () => {
      metrics.rebuilds++;
      rebuild();
    };
    store.reviewState.project = (input) => {
      metrics.projections++;
      return project(input);
    };
    const failing = store.subscribe(() => {
      throw new Error("Scoped publication observer");
    });
    const healthy = store.subscribe(() => {
      metrics.observers++;
      for (const event of store.controller.trace.events)
        metrics.workload += event.type.length;
    });
    for (let i = 0; i < 512; i++)
      store.controller.trace.record("notification.raw", { burst: i });
    const synchronous = { ...metrics };
    return new Promise((resolve) => {
      setTimeout(() => {
        const current = store.getSnapshot();
        const result = {
          synchronous,
          ...metrics,
          rawWork: store.reviewState.work.raw - initialRawWork,
          retained: current.review.rawTotal,
          page: current.review.raw.page,
          frozen:
            JSON.stringify(current.review.events.map((row) => row.id)) ===
            JSON.stringify(frozen),
          evicted: current.review.events.every((row) => row.event === null),
          pending: current.review.rawPending,
          preview: current.content.textPreview === preview,
          failures: snapshot
            .getPublicationFailures()
            .map((failure) => failure.phase),
        };
        failing();
        healthy();
        snapshot._rebuild = rebuild;
        store.reviewState.project = project;
        resolve(result);
      }, 0);
    });
  });
  expect(counts).toMatchObject({
    synchronous: { rebuilds: 0, projections: 0, observers: 0, workload: 0 },
    rebuilds: 1,
    projections: 1,
    observers: 1,
    rawWork: 1,
    retained: 50_000,
    page: 999,
    frozen: true,
    evicted: true,
    pending: 512,
    preview: true,
    failures: ["observer"],
  });
  expect((counts as { workload: number }).workload).toBeGreaterThan(0);
  console.info(JSON.stringify({ publicationBurst: counts }));
  await testInfo.attach("publication-counts", {
    body: Buffer.from(JSON.stringify(counts, null, 2)),
    contentType: "application/json",
  });
  const arrivals = page.getByRole("button", {
    name: "Show latest (512 new events)",
    exact: true,
  });
  await expect(arrivals).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollPosition);
  await expect(
    page.getByRole("navigation", { name: "Raw events pagination" }),
  ).toContainText("Page 1000 of 1000");
  await expect(
    page
      .getByText("Event removed by capture retention. Show latest to refresh.")
      .first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("publication-burst.png") });
  await arrivals.click();
  await expect(
    page.getByRole("navigation", { name: "Raw events pagination" }),
  ).toContainText("Page 1 of 1000");
  await expect(
    page.getByRole("button", { name: "Show latest", exact: true }),
  ).toBeVisible();

  const replacement = await page.evaluate(async () => {
    const store = (window as unknown as PublicationWindow).matrixsmithStore;
    const live = store.controller;
    const bundle = store.exportBundle();
    store.importBundle(bundle);
    const old = store.controller;
    old.trace.record("notification.raw", { obsolete: true });
    store.importBundle(bundle);
    const current = store.controller;
    let publications = 0;
    const unsubscribe = store.subscribe(() => publications++);
    old.trace.record("notification.raw", { retired: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    const result = {
      replaced: old !== current,
      source: store.getSnapshot().source,
      publications,
    };
    store.returnToLiveWorkspace();
    await store.transport.disconnect();
    return {
      ...result,
      retainedLive: store.controller === live,
      draft: store.getSnapshot().content.settings.text,
      connected: store.getSnapshot().liveConnected,
      contentAllowed: store.getSnapshot().content.allowed,
      confirmation: live.session.confirmedPlanDigest,
    };
  });
  expect(replacement).toEqual({
    replaced: true,
    source: "imported",
    publications: 0,
    retainedLive: true,
    draft: "Retained publication preview",
    connected: false,
    contentAllowed: false,
    confirmation: null,
  });
  await page.screenshot({
    path: testInfo.outputPath("publication-recovery.png"),
  });
});
