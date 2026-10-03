import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { PresentationStore } from "../../src/presentation/store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import { NoticeStore } from "../../src/presentation/state/notice-store";
import { ContentEditorStore } from "../../src/presentation/state/content-editor-store";
import * as computations from "../../src/presentation/state/dependencies";
import * as serialization from "../../src/investigation/serialization";
import * as image from "../../src/render/image";
import { unsupportedTextCharacters } from "../../src/render/font";
import {
  INVESTIGATIONS_KEY,
  INVESTIGATION_HISTORY_BYTE_LIMIT,
} from "../../src/storage/keys";

async function setup() {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  Object.assign(runtime.session, { profile: { ...runtime.session.profile! } });
  const data = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
  let changed!: () => void;
  const cleanup = vi.fn();
  const store = new PresentationStore(runtime, transport, {
    ...createBrowserEnvironment(),
    storage,
    onHistoryChange: (listener) => {
      changed = listener;
      return cleanup;
    },
  });
  return { store, runtime, transport, storage, data, changed, cleanup };
}
afterEach(() => vi.restoreAllMocks());

it("reuses content on unrelated publications, invalidates exact inputs and publishes safety immediately", async () => {
  const s = await setup();
  s.store.updateContentSettings({
    text: "HELLO WORLD",
    textDisplayMode: "scroll",
  });
  const first = s.store.getSnapshot().content;
  const render = vi.spyOn(computations, "renderText");
  const scroll = vi.spyOn(computations, "planRasterScroll");
  const demo = vi.spyOn(computations, "diagnosticAnimation");
  s.storage.getItem.mockClear();
  s.store.updateContentSettings({ imageZoom: 2 });
  s.store.setReportOptions({
    ...s.store.getSnapshot().reportOptions,
    includeTextContent: true,
  });
  for (let i = 0; i < 100; i++) s.runtime.trace.record("app.started", {});
  expect(render).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
  expect(demo).not.toHaveBeenCalled();
  expect(s.storage.getItem).not.toHaveBeenCalled();
  expect(s.store.getSnapshot().content.textPreview).toBe(first.textPreview);
  expect(s.store.getSnapshot().content.textScrollPlan).toBe(
    first.textScrollPlan,
  );
  expect(s.store.getSnapshot().content.animationPreview).toBe(
    first.animationPreview,
  );
  s.store.updateContentSettings({ textAlignment: "right" });
  expect(render).toHaveBeenCalledTimes(1);
  expect(scroll).not.toHaveBeenCalled();
  s.store.updateContentSettings({ textColor: "#123456" });
  expect(render).toHaveBeenCalledTimes(2);
  expect(scroll).toHaveBeenCalledTimes(1);
  Object.assign(s.runtime.session, {
    profile: { ...s.runtime.session.profile!, width: 16 },
  });
  s.runtime.trace.record("app.started", {});
  expect(render).toHaveBeenCalledTimes(3);
  expect(scroll).toHaveBeenCalledTimes(2);
  expect(demo).toHaveBeenCalledTimes(1);
  expect(s.store.getSnapshot().content.textPreview?.width).toBe(16);
  const resolved = s.runtime.session.profile;
  Object.assign(s.runtime.session, { profile: null });
  s.runtime.trace.record("app.started", {});
  expect(s.store.getSnapshot().content.textPreview).toBeNull();
  Object.assign(s.runtime.session, { profile: resolved });
  s.runtime.trace.record("app.started", {});
  expect(render).toHaveBeenCalledTimes(4);
  expect(scroll).toHaveBeenCalledTimes(3);
  expect(demo).toHaveBeenCalledTimes(2);
  await s.transport.disconnect();
  expect(s.store.getSnapshot().liveConnected).toBe(false);
  expect(s.store.getSnapshot().content.allowed).toBe(false);
  await s.store.dispose();
});

it("refreshes history on save/forget/navigation/external events but resume validates and demotes anew", async () => {
  const s = await setup();
  s.store.startDevelopInvestigation();
  s.store.stopInvestigation();
  const active = s.runtime.investigation;
  s.runtime.stopActiveInvestigation();
  // Stored history is suppressed while the same investigation is active.
  s.store.goHome();
  const raw = s.data.get(INVESTIGATIONS_KEY)!;
  expect(raw).toBeTruthy();
  Object.assign(s.runtime.session, { investigation: null });
  // An external replacement is displayed only after the explicit lifecycle callback.
  const external = JSON.parse(raw);
  external.investigations[0].investigation.id = "external-investigation";
  external.investigations[0].investigation.claimEvidence = [
    {
      claimId: "stored-program.upload",
      status: "verified",
      scope: "current-session",
      provenance: "observed",
      summary: "Earlier captured upload",
    },
  ];
  expect(active).not.toBeNull();
  s.data.set(INVESTIGATIONS_KEY, JSON.stringify(external));
  s.changed();
  expect(s.store.getSnapshot().storedInvestigation).not.toBeNull();
  s.storage.getItem.mockClear();
  for (let i = 0; i < 100; i++) s.runtime.trace.record("app.started", {});
  expect(s.storage.getItem).not.toHaveBeenCalled();
  s.store.resumeStoredInvestigation();
  expect(s.storage.getItem).toHaveBeenCalled();
  expect(s.runtime.investigation?.claimEvidence).toHaveLength(1);
  expect(
    s.runtime.investigation?.claimEvidence.every(
      (e) => e.scope === "previous-local-session",
    ),
  ).toBe(true);
  expect(s.runtime.panelProgram().certainty).toBe("unknown");
  const valid = JSON.stringify(external).replace(
    "external-investigation",
    "oversized-investigation",
  );
  const oversized =
    valid +
    " ".repeat(
      INVESTIGATION_HISTORY_BYTE_LIMIT -
        new TextEncoder().encode(valid).byteLength +
        1,
    );
  expect(JSON.parse(oversized).investigations[0].investigation.id).toBe(
    "oversized-investigation",
  );
  s.data.set(INVESTIGATIONS_KEY, oversized);
  const parse = vi.spyOn(JSON, "parse");
  const sanitize = vi.spyOn(serialization, "sanitizeInvestigation");
  const adopt = vi.spyOn(s.runtime, "adoptInvestigation");
  const resumed = s.runtime.investigation;
  s.changed();
  expect(s.store.getSnapshot().storedInvestigation).toBeNull();
  expect(parse.mock.calls.length).toBe(0);
  expect(sanitize.mock.calls.length).toBe(0);
  s.store.resumeStoredInvestigation();
  expect(s.store.getSnapshot().error).toMatch(/No stored/);
  expect(parse.mock.calls.length).toBe(0);
  expect(sanitize.mock.calls.length).toBe(0);
  expect(adopt).not.toHaveBeenCalled();
  expect(s.runtime.investigation).toBe(resumed);
  expect(s.data.get(INVESTIGATIONS_KEY)).toBe(oversized);
  expect(s.storage.removeItem).not.toHaveBeenCalled();
  s.store.forgetLocalHistory();
  expect(s.data.has(INVESTIGATIONS_KEY)).toBe(false);
  await s.store.dispose();
  expect(s.cleanup).toHaveBeenCalledOnce();
});

it("failed saves and forgets remain visible through harmless editing and never claim success", async () => {
  const s = await setup();
  s.store.startDevelopInvestigation();
  s.store.stopInvestigation();
  expect(s.store.getSnapshot().info).toMatch(/saved locally/);
  s.storage.setItem.mockImplementation(() => {
    throw new Error("disk full");
  });
  s.store.startDevelopInvestigation();
  s.store.stopInvestigation();
  expect(s.store.getSnapshot().error).toMatch(/not saved/);
  expect(s.store.getSnapshot().info ?? "").not.toMatch(/saved locally/);
  s.storage.setItem.mockImplementation((key, value) => {
    s.data.set(key, value);
  });
  s.store.updateContentSettings({ text: "HI" });
  expect(s.store.getSnapshot().error).toMatch(/not saved/);
  s.storage.removeItem.mockImplementation(() => {
    throw new Error("denied");
  });
  s.store.forgetLocalHistory();
  expect(s.store.getSnapshot().error).toMatch(/could not be removed/);
  await s.store.dispose();
});

it("keeps older current-workspace hardware failures despite newer harmless work, suppresses retired failures", async () => {
  const s = await setup();
  let workspace = s.runtime;
  const notice = new NoticeStore({
    workspaceStore: () => ({ getController: () => workspace }),
    snapshotStore: () => ({ _emit: () => {} }),
  });
  let reject!: (error: Error) => void;
  const pending = notice._run(
    "Sending",
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await notice._run("Editing image", async () => {});
  reject(new Error("write failed"));
  await pending;
  expect(notice.getError()).toBe("write failed");
  await notice._run("Editing image", async () => {});
  expect(notice.getError()).toBe("write failed");
  await notice._run("Sending", async () => {});
  expect(notice.getError()).toBeNull();
  const retired = notice._run(
    "Sending",
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  workspace = new ApplicationRuntime(new FakeTransport());
  reject(new Error("retired failure"));
  await retired;
  expect(notice.getError()).toBeNull();
  await workspace.dispose();
  await s.store.dispose();
});

it("cleans subscriptions and prevents disposed publications", async () => {
  const s = await setup();
  const called = vi.fn();
  const unsubscribe = s.store.subscribe(called);
  s.runtime.trace.record("app.started", {});
  expect(called).toHaveBeenCalledOnce();
  unsubscribe();
  s.runtime.trace.record("app.started", {});
  expect(called).toHaveBeenCalledOnce();
  await s.store.dispose();
  const late = vi.fn();
  s.store.subscribe(late);
  s.store.updateContentSettings({ text: "LATE" });
  expect(late).not.toHaveBeenCalled();
});

it.each(["profile", "geometry", "workspace", "dispose"])(
  "rejects stale image %s work",
  async (kind) => {
    const s = await setup();
    let current = s.runtime;
    let resolve!: (source: image.DecodedImageSource) => void;
    vi.spyOn(image, "decodeImageSource").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const editor = new ContentEditorStore(
      {
        workspaceStore: () => ({ getController: () => current }),
        snapshotStore: () => ({ _emit: () => {} }),
        noticeStore: () => ({
          setInfo: () => {},
          setError: () => {},
          _run: async (_label, action) => {
            await action();
          },
        }),
      },
      { storage: s.storage },
    );
    const pending = editor.loadImage(new Blob(["image"]), "old");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (kind === "profile")
      Object.assign(s.runtime.session, {
        profile: { ...s.runtime.session.profile! },
      });
    if (kind === "geometry")
      Object.assign(s.runtime.session.profile!, { width: 16 });
    if (kind === "workspace")
      current = new ApplicationRuntime(new FakeTransport());
    if (kind === "dispose") editor.dispose();
    resolve({
      width: 1,
      height: 1,
      rgba: new Uint8ClampedArray([255, 0, 0, 255]),
      hasAlpha: false,
      transparentFraction: 0,
    });
    await pending;
    expect(editor.getImageState()).toBeNull();
    editor.dispose();
    if (current !== s.runtime) await current.dispose();
    await s.store.dispose();
  },
);

it("reports unsupported characters according to the embedded font", () => {
  expect(unsupportedTextCharacters("ASCII 123 ~")).toEqual([]);
  expect(unsupportedTextCharacters("éé😀\n")).toEqual(["é", "😀", "\n"]);
});

it("progress publications reuse previews and the cached display never authorizes resume", async () => {
  const s = await setup();
  s.store.updateContentSettings({ text: "SCROLL", textDisplayMode: "scroll" });
  const first = s.store.getSnapshot().content;
  const render = vi.spyOn(computations, "renderText");
  const scroll = vi.spyOn(computations, "planRasterScroll");
  const demo = vi.spyOn(computations, "diagnosticAnimation");
  s.storage.getItem.mockClear();
  const send = vi
    .spyOn(s.runtime, "sendPersistentContent")
    .mockImplementation(async (plan, options) => {
      for (let i = 0; i < 100; i++)
        options?.onProgress?.({
          completedPackets: i,
          totalPackets: 100,
          elapsedMs: i,
          estimatedRemainingMs: 100 - i,
        });
      return {
        planId: plan.id,
        receipts: [],
        packetTimings: [],
        responseRecord: null,
        responseAmbiguous: false,
        completedAt: "2026-10-02T00:00:00Z",
        hostAccepted: true,
        protocolAcknowledged: null,
        deviceStateVerified: false,
        response: null,
        responseTimedOut: false,
        finalWriteAcceptedAt: null,
      };
    });
  s.store.requestSendText();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(s.store.getSnapshot().busy).toBeNull());
  expect(render).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
  expect(demo).not.toHaveBeenCalled();
  expect(s.storage.getItem).not.toHaveBeenCalled();
  expect(s.store.getSnapshot().content.textScrollPlan).toBe(
    first.textScrollPlan,
  );
  // Cold and warm Home can display this bounded summary, but it is deliberately not a valid investigation.
  s.data.set(
    INVESTIGATIONS_KEY,
    JSON.stringify({
      schemaVersion: 2,
      investigations: [
        {
          savedAt: "2026-10-02T00:00:00Z",
          investigation: {
            deviceName: "Display only",
            goal: { kind: "develop" },
            completedTests: [],
          },
        },
      ],
    }),
  );
  s.changed();
  expect(s.store.getSnapshot().storedInvestigation?.deviceName).toBe(
    "Display only",
  );
  s.store.resumeStoredInvestigation();
  expect(s.runtime.investigation).toBeNull();
  expect(s.store.getSnapshot().error).toMatch(/No stored/);
  await s.store.dispose();
});

it("workspace round trips retain live content identity without borrowing offline authority", async () => {
  const s = await setup();
  s.store.updateContentSettings({ text: "HELLO", textDisplayMode: "scroll" });
  const first = s.store.getSnapshot().content;
  s.store.importBundle(s.runtime.exportBundle());
  const offline = s.store.getSnapshot();
  expect(offline.content.textPreview).not.toBe(first.textPreview);
  expect(offline.content.animationPreview).not.toBe(first.animationPreview);
  expect(offline.content.allowed).toBe(false);
  expect(offline.recommended).toMatchObject({
    title: "Review imported evidence",
    action: "none",
  });
  expect(offline.liveWorkspaceAvailable).toBe(true);
  s.store.returnToLiveWorkspace();
  expect(s.store.getSnapshot().content.textPreview).toBe(first.textPreview);
  expect(s.store.getSnapshot().liveConnected).toBe(true);
  await s.store.dispose();
});

it("blocks conflicting Home operations while keeping disconnect available", async () => {
  const s = await setup();
  s.store.updateContentSettings({ text: "HI" });
  let fail!: (error: Error) => void;
  vi.spyOn(s.runtime, "sendPersistentContent").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const connect = vi.spyOn(s.runtime, "connect");
  const reconnect = vi.spyOn(s.runtime, "reconnectAuthorized");
  const disconnect = vi.spyOn(s.runtime, "disconnect");
  s.store.requestSendText();
  await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
  await s.store.connect();
  await s.store.reconnectAuthorized("other");
  s.store.forgetLocalHistory();
  expect(connect).not.toHaveBeenCalled();
  expect(reconnect).not.toHaveBeenCalled();
  expect(s.storage.removeItem).not.toHaveBeenCalled();
  s.store.updateContentSettings({ textColor: "#123456" });
  fail(new Error("current write failed"));
  await vi.waitFor(() =>
    expect(s.store.getSnapshot().sendAttempt?.failure?.message).toBe(
      "current write failed",
    ),
  );
  s.store.updateContentSettings({ textColor: "#abcdef" });
  expect(s.store.getSnapshot().sendAttempt?.failure?.message).toBe(
    "current write failed",
  );
  await s.store.disconnect();
  expect(disconnect).toHaveBeenCalledOnce();
  await s.store.dispose();
});
