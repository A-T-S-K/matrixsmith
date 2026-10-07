import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";
import { executionTransactionId } from "../../src/application/services/transmission-service";

afterEach(() => vi.restoreAllMocks());

it("retains measured acceptance after a partial failure without losing the draft or resending", async () => {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport, new TraceRecorder());
  const store = createPresentationStore(runtime, transport);
  await store.connect();
  store.updateContentSettings({ text: "RETAINED", textDisplayMode: "still" });
  const before = transport.writeAttempts.length;
  transport.failWriteAt = transport.writes.length + 1;
  store.requestSendText();
  await vi.waitFor(() =>
    expect(store.getSnapshot().sendAttempt?.phase).toBe("failed"),
  );
  const attempt = store.getSnapshot().sendAttempt!;
  expect(attempt.failure).toMatchObject({
    stage: "upload",
    reconnectRequired: false,
  });
  expect(attempt.evidence).toMatchObject({
    hostAccepted: false,
    protocolAcknowledged: null,
    deviceStateVerified: false,
    responseTimedOut: false,
  });
  expect(attempt.evidence?.finalWriteAcceptedAt).toBeDefined();
  expect(attempt.progress?.completedPackets).toBe(1);
  expect(attempt.progress!.totalPackets).toBeGreaterThan(1);
  expect(transport.writeAttempts).toHaveLength(before + 2);
  expect(store.getSnapshot().content.settings.text).toBe("RETAINED");
  store.updateContentSettings({ textColor: "#aabbcc" });
  await Promise.resolve();
  expect(store.getSnapshot().sendAttempt?.evidence).toEqual(attempt.evidence);
  expect(transport.writeAttempts).toHaveLength(before + 2);
  await store.dispose();
});

it("retains each partial send's measured evidence when the same Error is reused", async () => {
  const original = new Error("Repeated partial rejection");
  for (const text of ["FIRST", "SECOND"]) {
    const transport = new FakeTransport(knownIledHatFingerprint());
    const runtime = new ApplicationRuntime(transport, new TraceRecorder());
    const store = createPresentationStore(runtime, transport);
    await store.connect();
    const write = transport.write.bind(transport);
    let dispatches = 0;
    vi.spyOn(transport, "write").mockImplementation(async (...args) => {
      if (++dispatches === 2) throw original;
      return write(...args);
    });
    store.updateContentSettings({ text, textDisplayMode: "still" });
    store.requestSendText();
    await vi.waitFor(() =>
      expect(store.getSnapshot().sendAttempt?.phase).toBe("failed"),
    );
    expect(store.getSnapshot().sendAttempt?.progress?.completedPackets).toBe(1);
    expect(
      store.getSnapshot().sendAttempt?.evidence?.finalWriteAcceptedAt,
    ).toBeTruthy();
    expect(store.getSnapshot().content.settings.text).toBe(text);
    expect(runtime.contentCompilations.at(-1)!.transactionId).toBe(
      runtime.transactions.at(-1)!.id,
    );
    expect(dispatches).toBe(2);
    await store.dispose();
  }
  expect(executionTransactionId(original)).toBeNull();
});
