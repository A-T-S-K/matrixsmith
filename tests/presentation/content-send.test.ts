import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";
import { ContentSendStore } from "../../src/presentation/state/content-send-store";
import { ContentEditorStore } from "../../src/presentation/state/content-editor-store";
import { createBrowserEnvironment } from "../../src/adapters/presentation/browser-environment";
import { experimentalRegistry } from "../../src/dev/experimental-registry";
import { TraceRecorder } from "../../src/diagnostics/trace";
import type { ExecutionResult } from "../../src/app/executor";
import type { ApplicationExecutionResult } from "../../src/application/services/transmission-service";
import type { PreparedTransmission } from "../../src/core/transmission";
import * as image from "../../src/render/image";

const result = (
  patch: Partial<ExecutionResult> = {},
): ApplicationExecutionResult => ({
  transactionId: "transaction:send-fixture",
  planId: "test",
  receipts: [],
  packetTimings: [],
  responseRecord: null,
  responseAmbiguous: false,
  completedAt: "2026-10-02T20:00:00.000Z",
  hostAccepted: true,
  protocolAcknowledged: null,
  deviceStateVerified: false,
  response: null,
  responseTimedOut: false,
  finalWriteAcceptedAt: "2026-10-02T19:59:59.000Z",
  ...patch,
});
async function setup(experimental = false) {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(
    transport,
    new TraceRecorder(),
    experimental ? experimentalRegistry() : undefined,
  );
  const store = createPresentationStore(runtime, transport);
  await store.connect();
  store.updateContentSettings({ text: "HI", textDisplayMode: "still" });
  return { runtime, transport, store };
}
afterEach(() => vi.restoreAllMocks());

it("retains actual host, protocol, readback and response timeout facts separately", async () => {
  const s = await setup();
  s.store.requestSendText();
  await vi.waitFor(
    () => expect(s.store.getSnapshot().sendAttempt?.phase).toBe("completed"),
    { timeout: 10000 },
  );
  expect(s.store.getSnapshot().sendAttempt?.evidence).toMatchObject({
    hostAccepted: true,
    protocolAcknowledged: null,
    deviceStateVerified: false,
    responseTimedOut: false,
  });
  expect(s.store.getSnapshot().info).toBeNull();
  const send = vi
    .spyOn(s.runtime, "sendPersistentContent")
    .mockResolvedValue(result({ protocolAcknowledged: true }));
  s.store.requestSendText();
  await vi.waitFor(() =>
    expect(
      s.store.getSnapshot().sendAttempt?.evidence?.protocolAcknowledged,
    ).toBe(true),
  );
  expect(s.store.getSnapshot().sendAttempt?.evidence?.deviceStateVerified).toBe(
    false,
  );
  send.mockResolvedValue(
    result({ responseTimedOut: true, protocolAcknowledged: false }),
  );
  s.store.requestSendText();
  await vi.waitFor(() =>
    expect(s.store.getSnapshot().sendAttempt?.evidence?.responseTimedOut).toBe(
      true,
    ),
  );
  await s.store.dispose();
});

it("keeps preflight rejection distinct, preserves draft/cache, and does not fabricate writes", async () => {
  const s = await setup();
  const preview = s.store.getSnapshot().content.textPreview;
  const plan = vi.spyOn(s.runtime, "plan").mockImplementation(() => {
    throw new Error("Planning rejected");
  });
  s.store.requestSendText();
  expect(s.store.getSnapshot().sendAttempt?.failure).toMatchObject({
    stage: "preflight",
    message: "Planning rejected",
    reconnectRequired: false,
  });
  expect(s.transport.writeAttempts).toHaveLength(0);
  expect(s.store.getSnapshot().content.textPreview).toBe(preview);
  plan.mockRestore();
  s.transport.failWriteAt = 0;
  s.store.requestSendText();
  await vi.waitFor(() =>
    expect(s.store.getSnapshot().sendAttempt?.failure?.stage).toBe("upload"),
  );
  expect(s.store.getSnapshot().sendAttempt?.evidence).toBeNull();
  expect(s.store.getSnapshot().sendAttempt?.progress).toBeNull();
  expect(s.store.getSnapshot().sendAttempt?.failure?.reconnectRequired).toBe(
    false,
  );
  s.store.updateContentSettings({ textColor: "#abcdef" });
  expect(s.store.getSnapshot().sendAttempt?.failure?.stage).toBe("upload");
  expect(s.store.getSnapshot().content.settings.text).toBe("HI");
  await s.store.dispose();
});

it("blocks indeterminate failure until explicit reconnect; recovery preserves image and never sends", async () => {
  const s = await setup(true);
  vi.spyOn(image, "decodeImageSource").mockResolvedValue({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([255, 0, 0, 255]),
    hasAlpha: false,
    transparentFraction: 0,
  });
  await s.store.loadImage(new Blob(["image"]), "retained.png");
  const preview = s.store.getSnapshot().content.image!.preview;
  const plans: PreparedTransmission[] = [];
  const actual = s.runtime.sendPersistentContent.bind(s.runtime);
  const send = vi
    .spyOn(s.runtime, "sendPersistentContent")
    .mockImplementation(async (plan, options) => {
      plans.push(plan as PreparedTransmission);
      options?.onExecutionStarted?.();
      s.transport.quarantine("indeterminate authored failure");
      throw new Error("Write may still complete");
    });
  s.store.requestSendImage();
  expect(s.store.getSnapshot().pendingSend).not.toBeNull();
  await s.store.confirmPendingSend();
  expect(s.store.getSnapshot().sendAttempt?.failure).toMatchObject({
    stage: "upload",
    reconnectRequired: true,
  });
  const oldConnection = s.transport.connectionId;
  const failure = s.store.getSnapshot().sendAttempt;
  s.store.requestSendImage();
  expect(s.store.getSnapshot().sendAttempt).toBe(failure);
  expect(send).toHaveBeenCalledTimes(1);
  send.mockImplementation(async (plan, options) => {
    plans.push(plan as PreparedTransmission);
    return actual(plan, options);
  });
  await s.store.reconnectAndReviewDraft();
  expect(s.transport.connectionId).not.toBe(oldConnection);
  expect(s.store.getSnapshot().sendAttempt?.phase).toBe("review");
  expect(s.store.getSnapshot().content.image?.preview).toBe(preview);
  expect(send).toHaveBeenCalledTimes(1);
  expect(s.transport.writes).toHaveLength(0);
  expect(s.runtime.session.confirmedPlanDigest).toBeNull();
  expect(s.runtime.session.experimentalTxEnabled).toBe(false);
  s.store.requestSendImage();
  expect(s.store.getSnapshot().pendingSend).not.toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  await s.store.confirmPendingSend();
  expect(plans[1]?.digest).not.toBe(plans[0]?.digest);
  expect(plans[1]?.targetBinding?.connectionId).toBe(s.transport.connectionId);
  expect(s.store.getSnapshot().pendingSend).toBeNull();
  await s.store.dispose();
});

it.each(
  ["workspace", "generation", "target", "confirmation"].flatMap((context) =>
    ["completion", "failure"].map((outcome) => ({ context, outcome })),
  ),
)(
  "stale $context $outcome/progress/cleanup cannot touch replacement state or resources",
  async ({ context, outcome }) => {
    const a = await setup();
    const b = await setup(context === "confirmation");
    let current = a.runtime;
    const environment = createBrowserEnvironment();
    const editor = new ContentEditorStore(
      {
        workspaceStore: () => ({ getController: () => current }),
        snapshotStore: () => ({ _emit: () => {} }),
        noticeStore: () => ({
          setError: () => {},
          setInfo: () => {},
          _run: async (_label, action) => action(),
        }),
      },
      environment,
    );
    editor.updateContentSettings({ text: "HI", textDisplayMode: "still" });
    const wakeLock = {
      supported: true,
      acquire: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const close = vi.fn();
    const owner = new ContentSendStore(
      {
        contentEditorStore: () => editor,
        workspaceStore: () => ({ getController: () => current }),
        snapshotStore: () => ({ _emit: () => {} }),
        navigationStore: () => ({
          _closeOverlay: close,
          _openOverlay: () => {},
        }),
        noticeStore: () => ({
          getBusy: () => null,
          setError: () => {},
          setInfo: () => {},
          _run: async (_label, action) => action(),
        }),
        connectionStore: () => ({
          disconnect: async () => {},
          connect: async () => {},
        }),
      },
      { wakeLock },
    );
    let complete!: (value: ApplicationExecutionResult) => void;
    let fail!: (error: Error) => void;
    let oldProgress!: NonNullable<
      Parameters<ApplicationRuntime["sendPersistentContent"]>[1]
    >["onProgress"];
    vi.spyOn(a.runtime, "sendPersistentContent").mockImplementation(
      (_plan, options) => {
        oldProgress = options?.onProgress;
        return new Promise((resolve, reject) => {
          complete = resolve;
          fail = reject;
        });
      },
    );
    owner.requestSendText();
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    if (context === "generation") {
      await a.runtime.disconnect();
      await a.runtime.connect();
    } else if (context === "target") {
      Object.assign(a.runtime.session, {
        profile: { ...a.runtime.session.profile! },
      });
    } else current = b.runtime;
    expect(owner.getSendAttempt()).toBeNull();
    let nextComplete!: (value: ApplicationExecutionResult) => void;
    vi.spyOn(current, "sendPersistentContent").mockImplementation(
      (_plan, options) => {
        options?.onProgress?.({
          completedPackets: 2,
          totalPackets: 4,
          elapsedMs: 1,
          estimatedRemainingMs: 1,
        });
        return new Promise((resolve) => {
          nextComplete = resolve;
        });
      },
    );
    owner.requestSendText();
    if (context === "confirmation")
      expect(owner.getPendingSend()).not.toBeNull();
    else if (context !== "target")
      await vi.waitFor(() => expect(nextComplete).toBeTypeOf("function"));
    else expect(owner.getSendAttempt()?.phase).toBe("failed");
    const pending = owner.getPendingSend();
    const latest = owner.getSendAttempt();
    oldProgress?.({
      completedPackets: 9,
      totalPackets: 10,
      elapsedMs: 1,
      estimatedRemainingMs: 1,
    });
    if (outcome === "completion") complete(result());
    else fail(new Error("old failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owner.getSendAttempt()).toBe(latest);
    expect(owner.getPendingSend()).toBe(pending);
    if (context === "confirmation") {
      expect(owner.getSendAttempt()?.phase).toBe("confirming");
      expect(close).toHaveBeenCalledOnce();
      expect(wakeLock.acquire).toHaveBeenCalledOnce();
      expect(wakeLock.release).toHaveBeenCalledOnce();
    } else if (context === "target") {
      // Replacing a reviewed definition with a copy withdraws physical trust.
      expect(owner.getSendAttempt()?.phase).toBe("failed");
      expect(nextComplete).toBeUndefined();
    } else {
      expect(owner.getSendProgress()?.completedPackets).toBe(2);
      expect(wakeLock.release).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(2);
      nextComplete(result());
      await vi.waitFor(() =>
        expect(owner.getSendAttempt()?.phase).toBe("completed"),
      );
      expect(wakeLock.release).toHaveBeenCalledOnce();
    }
    await owner.dispose();
    editor.dispose();
    await a.store.dispose();
    await b.store.dispose();
  },
);

it("a new connection invalidates pending experimental confirmation before execution", async () => {
  const s = await setup(true);
  s.store.requestSendText();
  expect(s.store.getSnapshot().pendingSend).not.toBeNull();
  await s.runtime.disconnect();
  await s.runtime.connect();
  await s.store.confirmPendingSend();
  expect(s.transport.writes).toHaveLength(0);
  expect(s.store.getSnapshot().pendingSend).toBeNull();
  s.store.requestSendText();
  expect(s.store.getSnapshot().pendingSend).not.toBeNull();
  await s.store.dispose();
});

it("projects short completion and failure wording without physical acceptance claims", async () => {
  const { sendMessage } = await import("../../src/presentation/store");
  const s = await setup();
  s.store.requestSendText();
  await vi.waitFor(
    () => expect(s.store.getSnapshot().sendAttempt?.phase).toBe("completed"),
    { timeout: 10000 },
  );
  const attempt = s.store.getSnapshot().sendAttempt!;
  expect(sendMessage(attempt)).toEqual({
    headline: "Upload sent.",
    guidance: "Check the display. Its appearance was not confirmed.",
  });
  for (const patch of [
    { protocolAcknowledged: true },
    { protocolAcknowledged: true, deviceStateVerified: true },
  ]) {
    expect(sendMessage({ ...attempt, evidence: result(patch) })).toEqual(
      sendMessage(attempt),
    );
  }
  expect(
    sendMessage({ ...attempt, evidence: result({ responseTimedOut: true }) })
      ?.headline,
  ).toBe("Upload sent; response timed out.");
  expect(
    sendMessage({
      ...attempt,
      evidence: null,
      phase: "failed",
      failure: {
        stage: "preflight",
        message: "Rejected",
        reconnectRequired: false,
      },
    })?.headline,
  ).toBe("Send could not start.");
  expect(
    sendMessage({
      ...attempt,
      evidence: null,
      phase: "failed",
      failure: {
        stage: "upload",
        message: "Write failed",
        reconnectRequired: true,
      },
    }),
  ).toEqual({
    headline: "Upload did not finish.",
    guidance: "Check the display before sending again.",
  });
  await s.store.dispose();
});

it("failed reconnect retains the image draft and permits another explicit recovery without sending", async () => {
  const s = await setup();
  vi.spyOn(image, "decodeImageSource").mockResolvedValue({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([255, 0, 0, 255]),
    hasAlpha: false,
    transparentFraction: 0,
  });
  await s.store.loadImage(new Blob(["image"]), "retained.png");
  const preview = s.store.getSnapshot().content.image!.preview;
  const send = vi
    .spyOn(s.runtime, "sendPersistentContent")
    .mockImplementation(async (_plan, options) => {
      options?.onExecutionStarted?.();
      s.transport.quarantine("indeterminate");
      throw new Error("Unknown write outcome");
    });
  s.store.requestSendImage();
  await vi.waitFor(() =>
    expect(s.store.getSnapshot().sendAttempt?.failure?.reconnectRequired).toBe(
      true,
    ),
  );
  vi.spyOn(s.runtime, "connect").mockRejectedValueOnce(
    new Error("Reconnect unavailable"),
  );
  await s.store.reconnectAndReviewDraft();
  expect(s.store.getSnapshot().content.image?.preview).toBe(preview);
  expect(s.store.getSnapshot().sendAttempt?.failure?.reconnectRequired).toBe(
    true,
  );
  expect(s.store.getSnapshot().error).toBe("Reconnect unavailable");
  expect(s.store.getSnapshot().liveConnected).toBe(false);
  await s.store.reconnectAndReviewDraft();
  expect(s.store.getSnapshot().sendAttempt?.phase).toBe("review");
  expect(s.store.getSnapshot().content.image?.preview).toBe(preview);
  expect(send).toHaveBeenCalledOnce();
  await s.store.dispose();
});
