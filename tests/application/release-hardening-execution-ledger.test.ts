import { afterEach, expect, it, vi } from "vitest";
import { IndeterminateWriteError } from "../../src/app/executor";
import { ApplicationRuntime } from "../../src/application/runtime";
import {
  executionTransactionId,
  recordedExecutionEvidence,
  type ApplicationExecutionRecording,
} from "../../src/application/services/transmission-service";
import { INPUT_LIMITS } from "../../src/application/input-limits";
import type { ProtocolTransaction } from "../../src/diagnostics/transactions";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { Framebuffer } from "../../src/render/framebuffer";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { createPresentationStore } from "../helpers/presentation-fixture";
import { ApplicationState } from "../../src/application/state";
import { ProtocolEvidenceService } from "../../src/application/services/protocol-evidence-service";
import { builtInDrivers, DriverRegistry } from "../../src/drivers/registry";
import { parseHexBytes } from "../../src/discovery/advertisement";
import infoCc from "../fixtures/iledhat/coolledux-device-info-cc.json";

afterEach(() => vi.restoreAllMocks());

async function connected() {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport, new TraceRecorder());
  await runtime.connect();
  await runtime.probe();
  return { runtime, transport };
}

/** Fill retained history without dispatching 10,000 hardware operations. */
function saturate(runtime: ApplicationRuntime): string {
  const history = runtime.transactions as ProtocolTransaction[];
  const template = history.at(-1)!;
  history.splice(0, history.length);
  for (let index = 0; index < INPUT_LIMITS.transactions; index++)
    history.push({ ...template, id: `retained-fixture:${index}` });
  return history[0]!.id;
}

it("returns the newly recorded ID and links compilation at the retention cap", async () => {
  const { runtime } = await connected();
  const evicted = saturate(runtime);
  const plan = runtime.plan({
    type: "ShowFrame",
    frame: new Framebuffer(32, 16),
  });
  const result = await runtime.sendPersistentContent(plan, {
    confirmedConsequence: true,
    extras: { transactionId: "caller-supplied-unrelated-id" },
  });
  expect(runtime.transactions).toHaveLength(INPUT_LIMITS.transactions);
  expect(runtime.transactions.some(({ id }) => id === evicted)).toBe(false);
  expect(result.transactionId).toBe(runtime.transactions.at(-1)!.id);
  expect(runtime.contentCompilations.at(-1)!.transactionId).toBe(
    result.transactionId,
  );
});

it("retains the exact failed execution and compilation IDs at the retention cap", async () => {
  const { runtime, transport } = await connected();
  saturate(runtime);
  transport.failWriteAt = transport.writes.length;
  const plan = runtime.plan({
    type: "ShowFrame",
    frame: new Framebuffer(32, 16),
  });
  const error = await runtime
    .sendPersistentContent(plan, {
      confirmedConsequence: true,
    })
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(executionTransactionId(error)).toBe(runtime.transactions.at(-1)!.id);
  expect(
    executionTransactionId({ transactionId: runtime.transactions.at(-1)!.id }),
  ).toBeNull();
  expect(runtime.contentCompilations.at(-1)!.transactionId).toBe(
    runtime.transactions.at(-1)!.id,
  );
});

it("preserves original indeterminate error identity, packet index and quarantine", async () => {
  const { runtime, transport } = await connected();
  const plan = runtime.plan({
    type: "ShowFrame",
    frame: new Framebuffer(32, 16),
  });
  const original = new IndeterminateWriteError(plan.id, 0, 100);
  vi.spyOn(transport, "write").mockImplementation(async () => {
    transport.quarantine("Authored indeterminate outcome");
    throw original;
  });
  const error = await runtime
    .sendPersistentContent(plan, {
      confirmedConsequence: true,
    })
    .catch((error: unknown) => error);
  expect(error).toBe(original);
  expect(transport.state).toBe("quarantined");
  expect(original.packetIndex).toBe(0);
  expect(executionTransactionId(error)).toBe(runtime.transactions.at(-1)!.id);
});

it("records a zero-dispatch execution failure without inventing planned TX", async () => {
  const { runtime, transport } = await connected();
  const before = transport.writeAttempts.length;
  const original = new Error("Authored pre-dispatch failure");
  const plan = runtime.plan({
    type: "ShowFrame",
    frame: new Framebuffer(32, 16),
  });
  await expect(
    runtime.sendPersistentContent(plan, {
      confirmedConsequence: true,
      onExecutionStarted: () => {
        throw original;
      },
    }),
  ).rejects.toBe(original);
  expect(transport.writeAttempts).toHaveLength(before);
  const transaction = runtime.transactions.at(-1)!;
  expect(transaction.error).toBe(original.message);
  expect(
    transaction.packets.filter(({ direction }) => direction === "TX"),
  ).toEqual([]);
  expect(transaction.hostAccepted).toBe(false);
});

it("links concurrent failures locally when transports reuse one Error", async () => {
  const left = await connected();
  const right = await connected();
  const original = new Error("Shared transport rejection");
  for (const { transport } of [left, right])
    vi.spyOn(transport, "write").mockRejectedValue(original);
  const recordings: ApplicationExecutionRecording[] = [];
  const outcomes = await Promise.all(
    [left, right].map(({ runtime }) => {
      const plan = runtime.plan({
        type: "ShowFrame",
        frame: new Framebuffer(32, 16),
      });
      return runtime
        .sendPersistentContent(plan, {
          confirmedConsequence: true,
          onTransactionRecorded: (recording) => {
            recordings.push(recording);
          },
        })
        .catch((error: unknown) => error);
    }),
  );
  expect(outcomes).toEqual([original, original]);
  expect(recordings).toHaveLength(2);
  expect(
    new Set(recordings.map(({ transactionId }) => transactionId)).size,
  ).toBe(2);
  for (const { runtime } of [left, right]) {
    const transaction = runtime.transactions.at(-1)!;
    const recording = recordings.find(
      ({ transactionId }) => transactionId === transaction.id,
    )!;
    expect(recording.evidence?.targetBinding.connectionId).toBe(
      runtime.transport.connectionId,
    );
    expect(recording.evidence?.attempts).toHaveLength(1);
    expect(
      transaction.packets.filter(({ direction }) => direction === "TX"),
    ).toHaveLength(1);
    expect(runtime.contentCompilations.at(-1)!.transactionId).toBe(
      transaction.id,
    );
  }
  expect(executionTransactionId(original)).toBeNull();
  expect(recordedExecutionEvidence(original)).toBeNull();
});

it("isolates recording observers from success and the original failure", async () => {
  const { runtime, transport } = await connected();
  const observer = vi.fn((recording: ApplicationExecutionRecording) => {
    if (recording.evidence) {
      (recording.evidence.attempts as unknown[]).splice(0);
    }
    throw new Error("Recording observer failure");
  });
  const plan = runtime.plan({
    type: "ShowFrame",
    frame: new Framebuffer(32, 16),
  });
  const result = await runtime.sendPersistentContent(plan, {
    confirmedConsequence: true,
    onTransactionRecorded: observer,
  });
  expect(observer).toHaveBeenCalledTimes(1);
  expect(result.evidence?.attempts).toHaveLength(plan.packets.length);
  const original = new Error("Actual transport failure");
  vi.spyOn(transport, "write").mockRejectedValue(original);
  await expect(
    runtime.sendPersistentContent(plan, {
      confirmedConsequence: true,
      onTransactionRecorded: observer,
    }),
  ).rejects.toBe(original);
  expect(observer).toHaveBeenCalledTimes(2);
  expect(recordedExecutionEvidence(original)?.attempts).toHaveLength(1);
  expect(
    runtime.transactions
      .at(-1)!
      .packets.filter(({ direction }) => direction === "TX"),
  ).toHaveLength(1);
});

it("keeps only actual dispatches and accepted prefix after a later rejection", async () => {
  const { runtime, transport } = await connected();
  const plan = runtime.plan({
    type: "ShowFrame",
    frame: new Framebuffer(32, 16),
  });
  expect(plan.packets.length).toBeGreaterThan(1);
  transport.failWriteAt = transport.writes.length + 1;
  await expect(
    runtime.sendPersistentContent(plan, {
      confirmedConsequence: true,
    }),
  ).rejects.toThrow();
  const transaction = runtime.transactions.at(-1)!;
  const tx = transaction.packets.filter(({ direction }) => direction === "TX");
  expect(tx).toHaveLength(2);
  expect(tx[0]!.hostAcceptedAt).toBeDefined();
  expect(tx[1]!.hostAcceptedAt).toBeUndefined();
  expect(transaction.hostAccepted).toBe(false);
  const imported = new ApplicationRuntime(
    new ScriptedCoolLedUxDevice(),
    new TraceRecorder(),
  );
  imported.importBundle(runtime.exportBundle());
  const history = imported.transactions.find(
    ({ id }) => id === transaction.id,
  )!;
  expect(imported.session.source).toBe("imported");
  expect(history.hostAccepted).toBe(false);
  expect(history.packets.filter(({ direction }) => direction === "TX")).toEqual(
    tx,
  );
});

for (const fails of [false, true])
  it(`collects guided ${fails ? "failed" : "successful"} transfer IDs at the retention cap`, async () => {
    const { runtime, transport } = await connected();
    const store = createPresentationStore(runtime, transport);
    saturate(runtime);
    if (fails) transport.failWriteAt = transport.writes.length;
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const transaction = runtime.transactions.at(-1)!;
    const transfer = runtime.transfers.at(-1)!;
    expect(transfer.transactionIds).toEqual([transaction.id]);
    expect(Boolean(transfer.failureReason)).toBe(fails);
    await store.dispose();
  });

it("retains each guided failure ID when executions reuse one Error", async () => {
  const original = new Error("Repeated guided rejection");
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const { runtime, transport } = await connected();
    vi.spyOn(transport, "write").mockRejectedValue(original);
    const store = createPresentationStore(runtime, transport);
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const transaction = runtime.transactions.at(-1)!;
    expect(runtime.transfers.at(-1)!.transactionIds).toEqual([transaction.id]);
    expect(runtime.transfers.at(-1)!.failureReason).toContain(original.message);
    ids.push(transaction.id);
    await store.dispose();
  }
  expect(ids[0]).not.toBe(ids[1]);
  expect(executionTransactionId(original)).toBeNull();
});

it("settles response ownership before a throwing trace observer and preserves its error", async () => {
  const session = new ApplicationState();
  session.fingerprint = knownIledHatFingerprint();
  const trace = new TraceRecorder();
  const registry = new DriverRegistry(builtInDrivers);
  const service = new ProtocolEvidenceService(
    {
      connection: () => ({ getSession: () => session }),
      identification: () => ({
        getRegistry: () => registry,
        _resolveProtocol: () => {},
      }),
    },
    trace,
  );
  const context = { connectionId: "authored-observer-fixture", generation: 1 };
  const endpoint = {
    serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
  };
  const router = service.getNotificationRouter();
  router.beginConnection(context);
  const armed = router.arm(
    {
      type: "notification",
      endpoints: [endpoint],
      dispatchPacketIndex: 0,
      required: true,
      timeoutMs: 100,
      fulfillsOperation: true,
      kind: "device-info",
    },
    (notification) => notification.kind === "device-info",
    context.connectionId,
  );
  armed.dispatch();
  trace.subscribe((event) => {
    if (event.type !== "notification.raw") return;
    expect(session.notifications).toHaveLength(1);
    expect(router.receiveSequence).toBe(1);
    throw new Error("Authored observer failure");
  });
  expect(() =>
    service._recordIncoming(
      parseHexBytes(infoCc.rxHex),
      true,
      endpoint,
      "2026-10-06T20:00:00.000Z",
      context,
    ),
  ).toThrow("Authored observer failure");
  const response = await armed.promise;
  expect(response).toBe(session.notifications[0]);
  expect(response.timestamp).toBe("2026-10-06T20:00:00.000Z");
});
