import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { INPUT_LIMITS } from "../../src/application/input-limits";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import { workspaceUpdateBlocker } from "../../src/app/update-manager";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { PresentationStore } from "../../src/presentation/store";
import { PublicationScheduler } from "../../src/presentation/state/publication-scheduler";
import { ReplayTransport } from "../../src/transport/replay";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { deferred } from "../helpers/deferred-gatt";
import { reviewTransaction } from "../helpers/review-fixtures";
import info from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { parseHexBytes } from "../../src/discovery/advertisement";

const stores: PresentationStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(capacity = false) {
  vi.useFakeTimers();
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  await runtime.enableNotifications(COOLLEDX_ENDPOINT);
  if (capacity)
    for (let i = 0; i < INPUT_LIMITS.traceEvents; i++)
      runtime.trace.record("notification.raw", { index: i });
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    storage,
    createOfflineWorkspace(fingerprint) {
      const replay = new ReplayTransport(fingerprint);
      return { transport: replay, controller: new ApplicationRuntime(replay) };
    },
  });
  stores.push(store);
  return { store, transport, runtime, storage };
}

it("keeps slow and throwing observers outside actual notification decoding and receipt ownership", async () => {
  const { store, transport, runtime } = await setup(true);
  const snapshot = store["snapshotStore"];
  const rebuild = vi.spyOn(snapshot, "_rebuild");
  const throwing = vi.fn(() => {
    throw new Error("Presentation observer failed");
  });
  let received = 0;
  let observedEvents = 0;
  let decodingCompleted = false;
  const workload = vi.fn(() => {
    // Subscribed projection workload, without a wall-clock assertion.
    for (const event of runtime.trace.events) {
      received += event.type.length;
      observedEvents++;
    }
    decodingCompleted = Boolean(runtime.session.notifications.at(-1)?.decoded);
  });
  store.subscribe(throwing);
  store.subscribe(workload);
  const before = runtime.session.notifications.length;
  transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
  expect(runtime.session.notifications).toHaveLength(before + 1);
  expect(runtime.session.notifications.at(-1)?.decoded?.kind).toBe(
    "device-info",
  );
  expect(throwing).not.toHaveBeenCalled();
  expect(workload).not.toHaveBeenCalled();
  expect(rebuild).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(throwing).toHaveBeenCalledOnce();
  expect(workload).toHaveBeenCalledOnce();
  expect(received).toBeGreaterThan(0);
  expect(observedEvents).toBe(INPUT_LIMITS.traceEvents);
  expect(decodingCompleted).toBe(true);
  expect(snapshot.getPublicationFailures()).toMatchObject([
    { phase: "observer", error: new Error("Presentation observer failed") },
  ]);
  const result = await runtime.send(runtime.plan({ type: "GetDeviceInfo" }));
  expect(result.response?.kind).toBe("device-info");
  expect(result.responseTimedOut).toBe(false);
  expect(result.responseRecord?.receiveSequence).toBeGreaterThan(0);
  expect(runtime.transactions.at(-1)?.decodedResponse?.kind).toBe(
    "device-info",
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(throwing).toHaveBeenCalledOnce(); // isolated until an explicit resubscribe
  expect(workload).toHaveBeenCalledTimes(2);
});

it("supervises immediate disconnect observers while invalidating authority and notifying other observers", async () => {
  const { store, transport, runtime } = await setup();
  store.subscribe(() => {
    throw new Error("Disconnect observer failed");
  });
  const healthy = vi.fn();
  store.subscribe(healthy);
  runtime.session.confirmPlanDigest("obsolete");
  runtime.session.enableExperimentalTx();
  runtime.trace.record("notification.raw");
  expect(() => transport.unexpectedDisconnect()).not.toThrow();
  expect(runtime.session.confirmedPlanDigest).toBeNull();
  expect(runtime.session.experimentalTxEnabled).toBe(false);
  expect(store.getSnapshot().liveConnected).toBe(false);
  expect(store.getSnapshot().content.allowed).toBe(false);
  expect(healthy).toHaveBeenCalled();
  const count = healthy.mock.calls.length;
  await vi.advanceTimersByTimeAsync(0);
  expect(healthy).toHaveBeenCalledTimes(count);
});

it("bounds observer diagnostics and recursive publication without an error/trace feedback loop", async () => {
  const { store, runtime } = await setup();
  const snapshot = store["snapshotStore"];
  store.subscribe(() => snapshot._emit());
  const healthy = vi.fn();
  store.subscribe(healthy);
  const revision = runtime.trace.revision;
  for (let i = 0; i < 25; i++) store.clearMessage();
  expect(healthy).toHaveBeenCalledTimes(25);
  expect(snapshot.getPublicationFailures()).toHaveLength(20);
  expect(
    snapshot.getPublicationFailures().every((f) => f.phase === "reentrant"),
  ).toBe(true);
  const failures = snapshot.getPublicationFailures();
  store.getSnapshot();
  expect(snapshot.getPublicationFailures()).toEqual(failures);
  expect(runtime.trace.revision).toBe(revision);
  expect(vi.getTimerCount()).toBe(0);
});

it("supervises projection failure, blocks update readiness and recovers on a later successful publication", async () => {
  const { store, transport } = await setup();
  const snapshot = store["snapshotStore"];
  const healthy = vi.fn();
  store.subscribe(healthy);
  const rebuild = vi.spyOn(snapshot, "_rebuild").mockImplementationOnce(() => {
    throw new Error("Projection failed");
  });
  transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
  await vi.advanceTimersByTimeAsync(0);
  expect(healthy).toHaveBeenCalledOnce();
  expect(workspaceUpdateBlocker(store.getSnapshot())).toMatch(
    /could not be refreshed/,
  );
  expect(store.getSnapshot()).toMatchObject({
    liveConnected: false,
    pendingSend: null,
    content: { allowed: false },
    error: expect.stringMatching(/could not be refreshed/),
  });
  expect(snapshot.getPublicationFailures()).toMatchObject([
    { phase: "projection" },
  ]);
  rebuild.mockRestore();
  store.clearMessage();
  expect(workspaceUpdateBlocker(store.getSnapshot())).toBeNull();
  expect(store.getSnapshot().liveConnected).toBe(true);
  expect(healthy).toHaveBeenCalledTimes(2);
});

it("retains a synchronous subscriber UI change without recursively notifying observers", async () => {
  const { store } = await setup();
  const change = vi.fn(() => store.setReviewNote("observer draft"));
  const healthy = vi.fn();
  store.subscribe(change);
  store.subscribe(healthy);
  store.clearMessage();
  expect(change).toHaveBeenCalledOnce();
  expect(healthy).toHaveBeenCalledOnce();
  expect(store.getSnapshot().reviewNote).toBe("observer draft");
  expect(vi.getTimerCount()).toBe(0);
});

it("supervises rejected observer promises without deleting a newer subscription or emitting again", async () => {
  const { store, runtime } = await setup();
  const rejection = deferred<void>();
  const observer = vi.fn(() => rejection.promise);
  const unsubscribe = store.subscribe(observer);
  const healthy = vi.fn();
  store.subscribe(healthy);
  const revision = runtime.trace.revision;
  store.clearMessage();
  unsubscribe();
  store.subscribe(observer);
  rejection.reject(new Error("Async observer failed"));
  await Promise.resolve();
  expect(store["snapshotStore"].getPublicationFailures()).toMatchObject([
    { phase: "observer", error: new Error("Async observer failed") },
  ]);
  expect(healthy).toHaveBeenCalledOnce();
  expect(runtime.trace.revision).toBe(revision);
  observer.mockImplementation(() => Promise.resolve());
  store.clearMessage();
  expect(observer).toHaveBeenCalledTimes(2);
  expect(healthy).toHaveBeenCalledTimes(2);
});

it("projects one subscribed burst at retained trace capacity and preserves frozen raw windows and preview identity", async () => {
  const { store, runtime, transport, storage } = await setup(true);
  store.updateContentSettings({ text: "Retained preview" });
  store.setWorkbenchSection("raw");
  store.setReviewPage("raw", 999);
  const frozen = store.getSnapshot().review.events.map((row) => row.id);
  const preview = store.getSnapshot().content.textPreview;
  const snapshot = store["snapshotStore"];
  const rebuild = vi.spyOn(snapshot, "_rebuild");
  const project = vi.spyOn(store.reviewState, "project");
  const beforeWork = store.reviewState.work.raw;
  const beforeCounts = snapshot.getPublicationCounts();
  const subscriber = vi.fn(() => store.getSnapshot());
  store.subscribe(subscriber);
  storage.setItem.mockClear();
  for (let i = 0; i < 256; i++)
    transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
  expect(runtime.trace.events).toHaveLength(INPUT_LIMITS.traceEvents);
  expect(rebuild).not.toHaveBeenCalled();
  expect(project).not.toHaveBeenCalled();
  expect(subscriber).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(project).toHaveBeenCalledOnce();
  expect(store.reviewState.work.raw - beforeWork).toBe(1);
  expect(subscriber).toHaveBeenCalledOnce();
  const counts = snapshot.getPublicationCounts();
  expect(counts.traceRequests - beforeCounts.traceRequests).toBe(512);
  expect(counts.rebuilds - beforeCounts.rebuilds).toBe(1);
  expect(counts.publications - beforeCounts.publications).toBe(1);
  expect(counts.observerCalls - beforeCounts.observerCalls).toBe(1);
  console.info(
    JSON.stringify({
      retainedTraceEvents: runtime.trace.events.length,
      incomingNotifications: 256,
      traceRequests: counts.traceRequests - beforeCounts.traceRequests,
      snapshotRebuilds: counts.rebuilds - beforeCounts.rebuilds,
      reviewProjections: project.mock.calls.length,
      rawProjections: store.reviewState.work.raw - beforeWork,
      subscriberCalls: subscriber.mock.calls.length,
    }),
  );
  const current = store.getSnapshot();
  expect(current.review.events.map((row) => row.id)).toEqual(frozen);
  expect(current.review.events.every((row) => row.event === null)).toBe(true);
  expect(current.review.raw.page).toBe(999);
  expect(current.review.rawPending).toBe(512);
  expect(current.content.textPreview).toBe(preview);
  store.showLatest("raw");
  expect(store.getSnapshot().review.raw.page).toBe(0);
  expect(store.getSnapshot().review.events[0]?.event).toBe(
    runtime.trace.events.at(-1),
  );
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("refreshes explicit pending reads once without dropping the scheduled subscriber notification", async () => {
  const { store, transport, storage } = await setup();
  const snapshot = store["snapshotStore"];
  const rebuild = vi.spyOn(snapshot, "_rebuild");
  const subscriber = vi.fn();
  store.subscribe(subscriber);
  transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
  const fresh = store.getSnapshot();
  expect(fresh.rawEvents.at(-1)?.type).toBe("notification.decoded");
  expect(store.getSnapshot()).toBe(fresh);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(subscriber).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(subscriber).toHaveBeenCalledOnce();
  expect(store.getSnapshot()).toBe(fresh);
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("preserves a selected transaction, packet page and review position across a notification burst", async () => {
  const { store, runtime, transport } = await setup();
  await runtime.send(runtime.plan({ type: "GetDeviceInfo" }));
  store.setWorkbenchSection("transactions");
  const transaction = runtime.transactions.at(-1)!;
  store.openTransaction(transaction.id);
  store.reviewState.packetPage = 2;
  store.reviewState.scrollY = 123;
  store.reviewState.restoreFocus = true;
  const before = store.getSnapshot();
  const frozen = before.review.rows.map((row) => row.id);
  for (let i = 0; i < 32; i++)
    transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getSnapshot().review.selected).toBe(transaction);
  expect(store.getSnapshot().review.selectedId).toBe(transaction.id);
  expect(store.getSnapshot().review.rows.map((row) => row.id)).toEqual(frozen);
  expect(store.reviewState.packetPage).toBe(2);
  expect(store.reviewState.scrollY).toBe(123);
  expect(store.reviewState.restoreFocus).toBe(true);
});

it("shows settled manual-read ownership immediately and blocks activation during the read", async () => {
  const { store, transport } = await setup();
  const response = deferred<Uint8Array>();
  vi.spyOn(transport, "read").mockReturnValueOnce(response.promise);
  const read = store.readCharacteristic(COOLLEDX_ENDPOINT);
  expect(workspaceUpdateBlocker(store.getSnapshot())).not.toBeNull();
  response.resolve(Uint8Array.of(1, 2));
  await read;
  expect(store.getSnapshot().busy).toBeNull();
  expect(store.getSnapshot().contextTransitionReason).toBeNull();
  expect(workspaceUpdateBlocker(store.getSnapshot())).toBeNull();
});

it("keeps explicit update reads current while an actual query owns host acceptance and after settlement", async () => {
  const { store, runtime, transport } = await setup();
  const accepted = deferred<void>();
  const started = deferred<void>();
  const write = transport.write.bind(transport);
  vi.spyOn(transport, "write").mockImplementation(async (...args) => {
    const receipt = await write(...args);
    started.resolve(undefined);
    await accepted.promise;
    return receipt;
  });
  const pending = runtime.send(runtime.plan({ type: "GetDeviceInfo" }));
  await started.promise;
  expect(runtime.executionBusy).toBe(true);
  expect(store.getSnapshot().busy).toBeNull();
  expect(workspaceUpdateBlocker(store.getSnapshot())).toMatch(
    /Finish the current operation/,
  );
  accepted.resolve(undefined);
  const result = await pending;
  expect(result.response?.kind).toBe("device-info");
  expect(runtime.executionBusy).toBe(false);
  expect(workspaceUpdateBlocker(store.getSnapshot())).toBeNull();
});

it("rechecks settled ownership after a synchronous consumer reads the final protocol trace", async () => {
  const { store, runtime } = await setup();
  let completionReason: string | null | undefined;
  const unsubscribe = runtime.trace.subscribe((event) => {
    if (event.type === "tx.completed")
      completionReason = store.getSnapshot().contextTransitionReason;
  });
  const result = await runtime.send(runtime.plan({ type: "GetDeviceInfo" }));
  unsubscribe();
  expect(result.response?.kind).toBe("device-info");
  expect(completionReason).toMatch(/Finish the current operation/);
  expect(runtime.executionBusy).toBe(false);
  expect(workspaceUpdateBlocker(store.getSnapshot())).toBeNull();
  expect(store.getSnapshot().profileLoadReason).toMatch(/Disconnect/);
});

it("refreshes evidence committed after a pending trace was read without moving the frozen review window", async () => {
  const { store, runtime } = await setup();
  store.setWorkbenchSection("transactions");
  runtime.trace.record("notification.raw");
  const before = store.getSnapshot();
  const transaction = reviewTransaction(123);
  runtime["protocolEvidence"].editTransactions((values) =>
    values.push(transaction),
  );
  const subscriber = vi.fn();
  store.subscribe(subscriber);
  const after = store.getSnapshot();
  expect(after).not.toBe(before);
  expect(after.transactions).toContain(transaction);
  expect(after.review.rows).toEqual(before.review.rows);
  expect(after.review.pending).toBe(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(subscriber).toHaveBeenCalledOnce();
  expect(store.getSnapshot()).toBe(after);
});

it("does not publish retired report tasks into a replacement and cancels tasks on disposal", async () => {
  const { store, runtime } = await setup();
  const bundle = runtime.exportBundle();
  store.importBundle(bundle);
  const retired = store.controller;
  retired.trace.record("notification.raw");
  store.importBundle(bundle);
  const replacement = store.controller;
  expect(replacement).not.toBe(retired);
  const subscriber = vi.fn();
  store.subscribe(subscriber);
  const snapshot = store.getSnapshot();
  retired.trace.record("notification.raw");
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getSnapshot()).toBe(snapshot);
  expect(subscriber).not.toHaveBeenCalled();
  replacement.trace.record("notification.raw");
  await store.dispose();
  await vi.advanceTimersByTimeAsync(0);
  expect(subscriber).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps retained live trace publication in offline context and preserves the live draft on return", async () => {
  const { store, runtime, transport, storage } = await setup();
  store.updateContentSettings({ text: "live draft" });
  const preview = store.getSnapshot().content.textPreview;
  store.importBundle(runtime.exportBundle());
  const offline = store.controller;
  const subscriber = vi.fn();
  store.subscribe(subscriber);
  transport.emitNotification(COOLLEDX_ENDPOINT, parseHexBytes(info.rxHex));
  await vi.advanceTimersByTimeAsync(0);
  expect(store.controller).toBe(offline);
  expect(store.getSnapshot().source).toBe("imported");
  expect(subscriber).toHaveBeenCalledOnce();
  storage.setItem.mockClear();
  store.returnToLiveWorkspace();
  expect(store.getSnapshot().content.settings.text).toBe("live draft");
  expect(store.getSnapshot().content.textPreview).toBe(preview);
  expect(store.getSnapshot().pendingSend).toBeNull();
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("discards scheduler ownership after retirement without running an obsolete task", async () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const scheduler = new PublicationScheduler(publish);
  let current = true;
  scheduler.schedule("old", () => current);
  current = false;
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).not.toHaveBeenCalled();
  scheduler.schedule("old", () => false);
  scheduler.schedule("new", () => true);
  scheduler.cancel("old");
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenCalledOnce();
  scheduler.schedule("new", () => true);
  scheduler.dispose();
  scheduler.schedule("new", () => true);
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenCalledOnce();
});
