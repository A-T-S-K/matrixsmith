import { BUNDLE_INPUT_LIMITS } from "../../src/diagnostics/bundle";
import * as gifCodec from "../../src/render/gif";
import { FrameSequence } from "../../src/render/frame-sequence";
import { Framebuffer } from "../../src/render/framebuffer";
import * as image from "../../src/render/image";
import { experimentalRegistry } from "../../src/dev/experimental-registry";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { ReplayTransport } from "../../src/transport/replay";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { deferred } from "../helpers/deferred-gatt";
import { CONTENT_SETTINGS_KEY } from "../../src/storage/settings";
import { fileActivity } from "../../src/application/file-input";
import {
  createHashRouter,
  parseRoute,
} from "../../src/presentation/app/routes";

const stores: PresentationStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  vi.restoreAllMocks();
});

async function setup(connected = true, experimental = false) {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    experimental ? experimentalRegistry() : undefined,
  );
  if (connected) await runtime.connect();
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const liveTransport = new FakeTransport(knownIledHatFingerprint());
  const createLiveWorkspace = vi.fn(() => ({
    transport: liveTransport,
    controller: new ApplicationRuntime(liveTransport),
  }));
  const createOfflineWorkspace = vi.fn((fingerprint) => {
    const replay = new ReplayTransport(fingerprint);
    return { transport: replay, controller: new ApplicationRuntime(replay) };
  });
  const copy = deferred<boolean>();
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    storage,
    createLiveWorkspace,
    createOfflineWorkspace,
    files: { copyText: vi.fn(() => copy.promise), download: vi.fn() },
  });
  stores.push(store);
  // Use separately collected software evidence when the initial runtime is unused.
  const evidenceTransport = new FakeTransport(knownIledHatFingerprint());
  const evidence = new ApplicationRuntime(evidenceTransport);
  await evidence.connect();
  evidence.ensureInvestigation();
  const json = evidence.exportBundle();
  await evidence.dispose();
  return {
    store,
    transport,
    runtime,
    liveTransport,
    createLiveWorkspace,
    createOfflineWorkspace,
    storage,
    data,
    copy,
    json,
  };
}

it("connects from offline synchronously into a fresh authority and retains report without saving its investigation", async () => {
  const s = await setup(false);
  const chooser = vi.spyOn(s.liveTransport, "selectAndConnect");
  expect(s.createLiveWorkspace).not.toHaveBeenCalled();
  s.store.importBundle(s.json);
  const report = s.store.controller;
  const dispose = vi.spyOn(report, "dispose");
  s.store.setTransactionSearch("offline");
  s.store.setReviewNote("offline draft");
  s.storage.setItem.mockClear();
  const connect = s.store.connect();
  expect(chooser).toHaveBeenCalledOnce(); // no prerequisite await before chooser
  expect(s.createLiveWorkspace).toHaveBeenCalledOnce();
  await connect;
  expect(s.store.controller).not.toBe(report);
  expect(s.store.controller.trace).not.toBe(report.trace);
  expect(s.store.controller.session).not.toBe(report.session);
  expect(s.store.controller.investigation).toBeNull();
  expect(s.store.controller.session).toMatchObject({
    source: "live",
    confirmedPlanDigest: null,
    experimentalTxEnabled: false,
  });
  expect(s.storage.setItem).not.toHaveBeenCalled();
  expect(s.store.getSnapshot().offlineWorkspaceAvailable).toBe(true);
  s.store.returnToOfflineWorkspace();
  expect(s.store.controller).toBe(report);
  expect(s.store.getSnapshot()).toMatchObject({
    transactionSearch: "offline",
    reviewNote: "offline draft",
    source: "imported",
  });
  expect(dispose).not.toHaveBeenCalled();
  s.store.returnToLiveWorkspace();
  expect(s.createLiveWorkspace).toHaveBeenCalledOnce();
  expect(s.liveTransport.notificationListenerCount).toBe(1);
});

it.each(["chooser canceled", "connection failed"])(
  "preserves offline context after %s and retries the same candidate",
  async (message) => {
    const s = await setup(false);
    s.store.importBundle(s.json);
    const offline = s.store.controller;
    s.store.setWorkbenchSection("evidence");
    s.store.setReviewNote("keep me");
    s.store.setTransactionSearch("private search");
    const options = {
      ...s.store.getSnapshot().reportOptions,
      includeIdentifiers: true,
    };
    s.store.setReportOptions(options);
    const chooser = vi
      .spyOn(s.liveTransport, "selectAndConnect")
      .mockRejectedValueOnce(new Error(message));
    await s.store.connect();
    expect(s.store.controller).toBe(offline);
    expect(s.store.getSnapshot()).toMatchObject({
      error: message,
      workbenchSection: "evidence",
      reviewNote: "keep me",
      transactionSearch: "private search",
      reportOptions: options,
    });
    await s.store.connect();
    expect(s.createLiveWorkspace).toHaveBeenCalledOnce();
    expect(chooser).toHaveBeenCalledTimes(2);
    expect(s.store.getSnapshot().liveConnected).toBe(true);
    s.store.returnToOfflineWorkspace();
    expect(s.store.getSnapshot().reviewNote).toBe("keep me");
  },
);

it("round trips isolate UI, errors, preferences and caches without saving restored drafts", async () => {
  const s = await setup();
  s.store.setView("control");
  s.store.updateContentSettings({
    text: "live text",
    textDisplayMode: "scroll",
  });
  s.store.setContentSelection("image");
  s.store.setTransactionSearch("live search");
  s.store.setTransactionFilter("errors");
  s.store.setReviewNote("live note");
  s.store.importExternalCapture("bad capture");
  const liveError = s.store.getSnapshot().error;
  const livePreview = s.store.getSnapshot().content.textPreview;
  const animation = s.store.getSnapshot().content.animationPreview;
  s.store.setWorkbenchSection("gatt");
  s.store.importBundle(s.json);
  expect(s.store.getSnapshot().content.settings.text).toBe("");
  expect(s.store.getSnapshot().error).toBeNull();
  s.store.setWorkbenchSection("evidence");
  s.store.setTransactionSearch("report search");
  s.store.setTransactionFilter("queries");
  s.store.setReviewNote("report note");
  s.store.setReportOptions({
    ...s.store.getSnapshot().reportOptions,
    includeIdentifiers: true,
  });
  s.storage.setItem.mockClear();
  s.store.returnToLiveWorkspace();
  expect(s.store.getSnapshot()).toMatchObject({
    view: "develop",
    workbenchSection: "gatt",
    transactionSearch: "live search",
    transactionFilter: "errors",
    reviewNote: "live note",
    error: liveError,
    contentSelection: "image",
  });
  expect(s.store.getSnapshot().content.settings.text).toBe("live text");
  expect(s.store.getSnapshot().content.textPreview).toBe(livePreview);
  expect(s.store.getSnapshot().content.animationPreview).toBe(animation);
  expect(s.store.getSnapshot().reportOptions.includeIdentifiers).toBe(false);
  s.store.returnToOfflineWorkspace();
  expect(s.store.getSnapshot()).toMatchObject({
    workbenchSection: "evidence",
    transactionSearch: "report search",
    transactionFilter: "queries",
    reviewNote: "report note",
    error: null,
  });
  expect(s.store.getSnapshot().reportOptions.includeIdentifiers).toBe(true);
  expect(s.storage.setItem).not.toHaveBeenCalled();
  expect(JSON.parse(s.data.get(CONTENT_SETTINGS_KEY)!).text).toBe("");
  expect(s.createLiveWorkspace).not.toHaveBeenCalled();
});

it("validates replacement atomically, retires once, and never disconnects retained live", async () => {
  const s = await setup();
  const disconnect = vi.spyOn(s.transport, "disconnect");
  s.store.importBundle(s.json);
  const report = s.store.controller;
  const dispose = vi.spyOn(report, "dispose");
  s.store.setReviewNote("old");
  s.store.importBundle("{");
  expect(s.store.controller).toBe(report);
  expect(dispose).not.toHaveBeenCalled();
  const invalid = JSON.parse(s.json);
  invalid.schemaVersion = 999;
  s.store.importBundle(JSON.stringify(invalid));
  expect(s.store.controller).toBe(report);
  s.store.importBundle(s.json);
  expect(dispose).toHaveBeenCalledOnce();
  expect(s.store.getSnapshot().reviewNote).toBe("");
  const second = s.store.controller;
  const secondDispose = vi.spyOn(second, "dispose");
  s.store.returnToLiveWorkspace();
  s.store.closeOfflineWorkspace();
  expect(secondDispose).toHaveBeenCalledOnce();
  expect(disconnect).not.toHaveBeenCalled();
  s.store.returnToOfflineWorkspace();
  expect(s.store.controller).toBe(s.runtime);
  await s.store.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(secondDispose).toHaveBeenCalledOnce();
});

it("disconnected live lifetime revokes confirmation and panel certainty while offline", async () => {
  const s = await setup();
  s.store.startGuidedTest("coolledux-graffiti-timing");
  await s.store.confirmGuidedTransfer();
  expect(s.runtime.panelProgram().certainty).toBe("known-active");
  s.store.closeGuidedTest();
  s.runtime.session.enableExperimentalTx();
  s.runtime.session.confirmPlanDigest("old digest");
  s.store.importBundle(s.json);
  const offline = s.store.controller;
  expect(s.runtime.session.confirmedPlanDigest).toBeNull();
  expect(s.runtime.session.experimentalTxEnabled).toBe(false);
  s.runtime.session.enableExperimentalTx();
  s.runtime.session.confirmPlanDigest("retained digest");
  expect(s.runtime.panelProgram().certainty).toBe("known-active");
  s.transport.unexpectedDisconnect();
  expect(s.runtime.panelProgram().certainty).toBe("unknown");
  expect(s.runtime.session.experimentalTxEnabled).toBe(false);
  expect(s.runtime.session.confirmedPlanDigest).toBeNull();
  expect(s.store.controller).toBe(offline);
  expect(s.store.getSnapshot().retainedLiveConnection).toBe("idle");
  expect(s.store.getSnapshot().error).toBeNull();
  s.store.returnToLiveWorkspace();
  expect(s.store.getSnapshot().liveConnected).toBe(false);
  expect(s.store.getSnapshot().content.allowed).toBe(false);
});

it.each(["round-trip", "replacement"])(
  "ignores a late report copy after %s",
  async (kind) => {
    const s = await setup();
    s.store.importBundle(s.json);
    const copying = s.store.copyReport();
    if (kind === "replacement") s.store.importBundle(s.json);
    else {
      s.store.returnToLiveWorkspace();
      s.store.returnToOfflineWorkspace();
    }
    const before = s.store.getSnapshot().info;
    s.copy.resolve(false);
    await copying;
    expect(s.store.getSnapshot().reportError).toBeNull();
    expect(s.store.getSnapshot().error).toBeNull();
    expect(s.store.getSnapshot().info).toBe(before);
  },
);

it("blocks transfers, decode and guided observation but keeps explicit close/recovery", async () => {
  const s = await setup();
  s.store.importBundle(s.json);
  s.store.returnToLiveWorkspace();
  s.store.updateContentSettings({ text: "HI", textDisplayMode: "still" });
  const pending = deferred<Awaited<ReturnType<FakeTransport["write"]>>>();
  const write = vi
    .spyOn(s.transport, "write")
    .mockReturnValueOnce(pending.promise);
  s.store.requestSendText();
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  s.store.returnToOfflineWorkspace();
  expect(s.store.controller).toBe(s.runtime);
  expect(s.store.getSnapshot().error).toMatch(/Finish the current operation/);
  pending.resolve({
    acceptedAt: new Date().toISOString(),
    endpoint: write.mock.calls[0]![0],
    writeMode: "without-response",
    byteLength: 1,
  });
  // Wait for the full paced upload, not only the first deferred packet.
  // Full-suite scheduling can exceed waitFor's one-second default.
  await vi.waitFor(() => expect(s.store.getSnapshot().busy).toBeNull(), {
    timeout: 5000,
  });
  const file = deferred<void>();
  const importing = fileActivity.run(() => file.promise);
  s.store.returnToOfflineWorkspace();
  expect(s.store.controller).toBe(s.runtime);
  expect(s.store.getSnapshot().error).toMatch(/Finish importing/);
  file.resolve();
  await importing;
  s.store.startDevelopInvestigation();
  s.store.startGuidedTest("coolledux-graffiti-timing");
  await s.store.confirmGuidedTransfer();
  expect(s.store.getSnapshot().guidedFlow?.stage).toBe("observe");
  s.store.returnToOfflineWorkspace();
  expect(s.store.controller).toBe(s.runtime);
  expect(s.store.getSnapshot().error).toMatch(/explicitly close/);
  expect(s.store.getSnapshot().guidedFlow?.stage).toBe("observe");
  s.store.closeGuidedTest();
  expect(s.runtime.investigation?.completedTests.at(-1)?.status).toBe(
    "abandoned",
  );
  expect(s.runtime.inProgressAttempts()).toHaveLength(0);
  s.store.returnToOfflineWorkspace();
  expect(s.store.getSnapshot().source).toBe("imported");
});

it("history selects available contexts and rejects retired report generations", async () => {
  const s = await setup();
  // A real router with deterministic browser history publications.
  const events = new Map<string, () => void>();
  const location = { hash: "#/home" } as Location;
  const history = {
    state: null as unknown,
    pushState(state: unknown, _: string, url: string) {
      this.state = state;
      location.hash = url;
    },
    replaceState(state: unknown, _: string, url: string) {
      this.state = state;
      location.hash = url;
    },
  };
  const router = createHashRouter({
    location,
    history: history as unknown as History,
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      events.set(type, listener as () => void);
    },
    removeEventListener: vi.fn(),
  });
  const historyTransport = new FakeTransport(knownIledHatFingerprint());
  const historyRuntime = new ApplicationRuntime(historyTransport);
  await historyRuntime.connect();
  const store = new PresentationStore(historyRuntime, historyTransport, {
    ...createBrowserEnvironment(),
    router,
  });
  stores.push(store);
  store.importBundle(s.json);
  store.setWorkbenchSection("gatt");
  const oldState = history.state;
  const oldHash = location.hash;
  store.returnToLiveWorkspace();
  store.setWorkbenchSection("raw");
  const liveHash = location.hash;
  history.state = oldState;
  location.hash = oldHash;
  events.get("popstate")!();
  expect(store.getSnapshot()).toMatchObject({
    source: "imported",
    workbenchSection: "gatt",
  });
  history.state = null;
  location.hash = liveHash;
  events.get("popstate")!();
  expect(store.controller).toBe(historyRuntime);
  expect(store.getSnapshot().workbenchSection).toBe("raw");
  store.importBundle(s.json);
  history.state = oldState;
  location.hash = oldHash;
  events.get("popstate")!();
  expect(store.getSnapshot().missingContext).toBe("offline");
  // A direct/legacy link can select the currently available report, never create one.
  history.state = null;
  location.hash = parseRoute("#/offline/report").hash;
  events.get("popstate")!();
  expect(store.getSnapshot().missingContext).toBeNull();
  await store.dispose();
  history.state = oldState;
  location.hash = oldHash;
  const reloadedTransport = new FakeTransport();
  const reloadedRouter = createHashRouter({
    location,
    history: history as unknown as History,
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      events.set(type, listener as () => void);
    },
    removeEventListener: vi.fn(),
  });
  const reloaded = new PresentationStore(
    new ApplicationRuntime(reloadedTransport),
    reloadedTransport,
    { ...createBrowserEnvironment(), router: reloadedRouter },
  );
  stores.push(reloaded);
  reloaded.importBundle(s.json);
  history.state = oldState;
  location.hash = oldHash;
  events.get("popstate")!();
  expect(reloaded.getSnapshot().missingContext).toBe("offline");
});

it("inactivates pending experimental confirmation across a context round trip", async () => {
  const s = await setup(true, true);
  s.store.updateContentSettings({ text: "HI", textDisplayMode: "still" });
  s.store.requestSendText();
  expect(s.store.getSnapshot().pendingSend).not.toBeNull();
  s.store.importBundle(s.json);
  expect(s.store.getSnapshot().pendingSend).toBeNull();
  s.store.returnToLiveWorkspace();
  await s.store.confirmPendingSend();
  expect(s.transport.writeAttempts).toHaveLength(0);
  expect(s.store.getSnapshot().pendingSend).toBeNull();
  expect(s.runtime.session.confirmedPlanDigest).toBeNull();
  expect(s.runtime.session.experimentalTxEnabled).toBe(false);
});

it("keeps decoded image/GIF identities on reselect and discards incompatible geometry", async () => {
  const s = await setup();
  vi.spyOn(image, "decodeImageSource").mockResolvedValue({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([255, 0, 0, 255]),
    hasAlpha: false,
    transparentFraction: 0,
  });
  await s.store.loadImage(new Blob(["image"]), "image");
  const sequence = new FrameSequence(
    [new Framebuffer(32, 16)],
    [{ milliseconds: 100 }],
  );
  vi.spyOn(gifCodec, "decodeGif").mockResolvedValue({
    sequence,
    byteLength: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    targetWidth: 32,
    targetHeight: 16,
    frameCount: 1,
    totalDurationMs: 100,
    repetition: "infinite",
    warnings: [],
  });
  await s.store.loadGif(new Blob(["gif"]), "gif");
  const preview = s.store.getSnapshot().content.image;
  const gif = s.store.getSnapshot().content.gif;
  expect(preview).not.toBeNull();
  expect(gif).not.toBeNull();
  s.store.importBundle(s.json);
  expect(s.store.getSnapshot().content.image).toBeNull();
  expect(s.store.getSnapshot().content.gif).toBeNull();
  s.store.returnToLiveWorkspace();
  expect(s.store.getSnapshot().content.image).toBe(preview);
  expect(s.store.getSnapshot().content.gif).toBe(gif);
  s.store.returnToOfflineWorkspace();
  s.runtime.session.profile = { ...s.runtime.session.profile!, width: 16 };
  s.store.returnToLiveWorkspace();
  expect(s.store.getSnapshot().content.image).toBeNull();
  expect(s.store.getSnapshot().content.gif).toBeNull();
  expect(image.decodeImageSource).toHaveBeenCalledOnce();
  expect(gifCodec.decodeGif).toHaveBeenCalledOnce();
});

it("blocks deferred image decoding and ignores retired connection completion", async () => {
  const s = await setup();
  s.store.importBundle(s.json);
  s.store.returnToLiveWorkspace();
  const decoding = deferred<image.DecodedImageSource>();
  vi.spyOn(image, "decodeImageSource").mockReturnValue(decoding.promise);
  const loading = s.store.loadImage(new Blob(["image"]), "image");
  await vi.waitFor(() => expect(image.decodeImageSource).toHaveBeenCalled());
  s.store.returnToOfflineWorkspace();
  expect(s.store.controller).toBe(s.runtime);
  decoding.resolve({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([255, 0, 0, 255]),
    hasAlpha: false,
    transparentFraction: 0,
  });
  await loading;
  s.store.returnToOfflineWorkspace();
  expect(s.store.getSnapshot().source).toBe("imported");
  const other = await setup(false);
  other.store.importBundle(other.json);
  const connecting = deferred<ReturnType<typeof knownIledHatFingerprint>>();
  vi.spyOn(other.liveTransport, "selectAndConnect").mockReturnValue(
    connecting.promise,
  );
  const connect = other.store.connect();
  const changed = vi.fn();
  other.store.subscribe(changed);
  await other.store.dispose();
  changed.mockClear();
  connecting.resolve(knownIledHatFingerprint());
  await connect;
  expect(changed).not.toHaveBeenCalled();
  expect(other.liveTransport.notificationListenerCount).toBe(0);
});

it("retains a disconnected live workspace when a report opens", async () => {
  const s = await setup();
  await s.store.disconnect();
  const dispose = vi.spyOn(s.runtime, "dispose");
  s.store.importBundle(s.json);
  expect(dispose).not.toHaveBeenCalled();
  expect(s.store.getSnapshot()).toMatchObject({
    liveWorkspaceAvailable: true,
    retainedLiveConnection: "idle",
  });
  s.store.returnToLiveWorkspace();
  expect(s.store.controller).toBe(s.runtime);
  expect(s.store.getSnapshot().missingContext).toBeNull();
  expect(s.createLiveWorkspace).not.toHaveBeenCalled();
});
it.each(["success", "failure"])(
  "late manual read %s cannot update replacement notices",
  async (outcome) => {
    const s = await setup();
    const response = deferred<Uint8Array>();
    vi.spyOn(s.transport, "read").mockReturnValueOnce(response.promise);
    const pending = s.store.readCharacteristic({
      serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
      characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
    });
    s.runtime.session.fingerprint = {
      ...s.runtime.session.fingerprint!,
      name: "replacement",
    };
    if (outcome === "success") response.resolve(new Uint8Array([1, 2, 3]));
    else response.reject(new Error("Old read failure"));
    await pending;
    expect(s.store.getSnapshot().info).toBeNull();
    expect(s.store.getSnapshot().error).toBeNull();
    expect(s.runtime.transactions.at(-1)?.source).toBe("gatt-read");
  },
);

it.each(["factory", "adoption", "factory mutation"])(
  "preserves active live and retained review on %s failure and retries",
  async (failure) => {
    const s = await setup();
    s.store.updateContentSettings({ text: "live draft" });
    s.store.importBundle(s.json);
    const retained = s.store.controller;
    const retainedDispose = vi.spyOn(retained, "dispose");
    s.store.setReviewNote("retained review");
    s.store.setTransactionSearch("retained search");
    s.store.returnToLiveWorkspace();
    s.store.setReviewNote("live review");
    s.store.importExternalCapture("bad capture");
    const liveError = s.store.getSnapshot().error;
    const before = s.store.getSnapshot();
    const liveDispose = vi.spyOn(s.runtime, "dispose");
    const disconnect = vi.spyOn(s.transport, "disconnect");
    let replacementDispose: ReturnType<typeof vi.spyOn> | undefined;
    s.createOfflineWorkspace.mockImplementationOnce((fingerprint) => {
      if (failure === "factory") throw new Error("Replacement creation failed");
      if (failure === "factory mutation")
        Object.assign(fingerprint.services[0]!.characteristics[0]!.properties, {
          read: false,
        });
      const transport = new ReplayTransport(fingerprint);
      const controller = new ApplicationRuntime(transport);
      replacementDispose = vi.spyOn(controller, "dispose");
      vi.spyOn(controller, "adoptPreparedBundle").mockImplementationOnce(() => {
        throw new Error("Replacement adoption failed");
      });
      return { transport, controller };
    });
    s.store.importBundle(s.json);
    expect(s.store.controller).toBe(s.runtime);
    expect(s.store.getSnapshot()).toMatchObject({
      source: before.source,
      liveConnected: true,
      offlineWorkspaceAvailable: true,
      reviewNote: "live review",
      content: { settings: { text: "live draft" } },
    });
    expect(s.store.getSnapshot().error).toMatch(/failed|read only/);
    expect(retainedDispose).not.toHaveBeenCalled();
    expect(liveDispose).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    if (replacementDispose) expect(replacementDispose).toHaveBeenCalledOnce();
    // Import failure has its own notice owner; existing errors remain accessible.
    const notices = s.store["noticeStore"];
    notices.setError(null, "diagnostic-import");
    expect(notices.getError()).toBe(liveError);
    s.store.returnToOfflineWorkspace();
    expect(s.store.controller).toBe(retained);
    expect(s.store.getSnapshot()).toMatchObject({
      reviewNote: "retained review",
      transactionSearch: "retained search",
    });
    s.store.returnToLiveWorkspace();
    // Fail again without clearing the import owner, then successfully retry.
    s.store.importBundle("{");
    s.store.importBundle(s.json);
    expect(s.store.controller.session.source).toBe("imported");
    expect(retainedDispose).toHaveBeenCalledOnce();
    s.store.returnToLiveWorkspace();
    expect(s.store.controller).toBe(s.runtime);
    expect(s.transport.state).toBe("connected");
    expect(s.store.getSnapshot().error).toBe(liveError);
  },
);

it("invalid input and pending manual-read ownership reject before factory creation", async () => {
  const s = await setup();
  for (const json of [
    "{",
    '{"schemaVersion":999}',
    " ".repeat(BUNDLE_INPUT_LIMITS.diagnosticBundleBytes + 1),
  ])
    s.store.importBundle(json);
  expect(s.createOfflineWorkspace).not.toHaveBeenCalled();
  expect(s.store.controller).toBe(s.runtime);
  const response = deferred<Uint8Array>();
  vi.spyOn(s.transport, "read").mockReturnValueOnce(response.promise);
  const reading = s.store.readCharacteristic({
    serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
  });
  s.store.importBundle(s.json);
  expect(s.createOfflineWorkspace).not.toHaveBeenCalled();
  expect(s.store.controller).toBe(s.runtime);
  expect(s.store.getSnapshot().error).toMatch(/Finish the current operation/);
  response.resolve(new Uint8Array([1]));
  await reading;
  s.store.importBundle(s.json);
  expect(s.createOfflineWorkspace).toHaveBeenCalledOnce();
});
