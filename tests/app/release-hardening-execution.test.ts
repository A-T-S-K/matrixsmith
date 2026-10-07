import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IndeterminateWriteError,
  TransmissionExecutor,
} from "../../src/app/executor";
import { executionEvidence } from "../../src/app/execution-evidence";
import * as transmission from "../../src/core/transmission";
import type { AuthorizedTransmission } from "../../src/core/transmission";
import type { TransportReceipt } from "../../src/application/ports/transport";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { FakeTransport } from "../../src/transport/fake";
import { fingerprintIdentityKey } from "../../src/investigation/device-identity";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { deferred } from "../helpers/deferred-gatt";
import { Framebuffer } from "../../src/render/framebuffer";
import { FrameSequence } from "../../src/render/frame-sequence";
import { NotificationRouter } from "../../src/app/notifications";
import { coolLedUxDriver } from "../../src/drivers/coolledux";

function withResponse(value: AuthorizedTransmission): AuthorizedTransmission {
  const plan = transmission.prepareTransmission(
    {
      ...value.plan,
      driverId: "coolledux",
      responseExpectation: {
        type: "notification",
        endpoints: [{ ...COOLLEDX_ENDPOINT }],
        dispatchPacketIndex: 0,
        required: true,
        timeoutMs: 50,
        opcode: 4,
        kind: "command-echo",
        fulfillsOperation: false,
      },
    },
    value.targetBinding,
  );
  return { ...value, plan, digest: plan.digest };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture(count = 3) {
  const transport = new FakeTransport(knownIledHatFingerprint());
  await transport.selectAndConnect({
    mode: "registered",
    hints: { filters: [], optionalServices: [] },
  });
  const targetBinding = {
    connectionId: transport.connectionId!,
    fingerprintKey: fingerprintIdentityKey(transport.fingerprint!),
    browserDeviceId: transport.fingerprint!.browserDeviceId ?? null,
  };
  const frame = new Framebuffer(2, 2);
  frame.fill(1, 2, 3);
  const plan = transmission.prepareTransmission(
    {
      id: "plan:private-execution",
      driverId: "coolledx",
      profileId: "iledhat-31ae-32x16",
      operation: {
        type: "ShowAnimation",
        sequence: new FrameSequence([frame], [{ milliseconds: 50 }]),
      },
      risk: "persistent",
      persistence: "persistent",
      validation: "experimental",
      evidenceRefs: ["reviewed-source"],
      packets: Array.from({ length: count }, (_, index) => ({
        index,
        endpoint: { ...COOLLEDX_ENDPOINT },
        writeMode: "without-response" as const,
        bytes: Uint8Array.of(index + 1),
        hex: transmission.packetHex(Uint8Array.of(index + 1)),
        delayAfterMs: 0,
      })),
      responseExpectation: { type: "none" },
      execution: "live",
      purpose: "operation",
      timeoutMs: 500,
      recoveryNotes: ["Reconnect before recovery"],
      metadata: { consequence: "confirmed-animation" },
    },
    targetBinding,
  );
  const authorized: AuthorizedTransmission = {
    plan,
    targetBinding,
    digest: plan.digest,
    authorizedAt: new Date().toISOString(),
    policyDecision: "allow",
  };
  return { transport, authorized };
}

function mutateConsequence(authorized: AuthorizedTransmission) {
  if (authorized.plan.operation.type !== "ShowAnimation") throw new Error();
  authorized.plan.operation.sequence.frames[0]!.data.fill(255);
  Object.assign(authorized.plan.operation.sequence.timing[0]!, {
    milliseconds: 999,
  });
  Object.assign(authorized.plan.metadata, { consequence: "different" });
  Object.assign(authorized.plan.recoveryNotes, { 0: "unsafe restoration" });
}

describe("executor private command ownership", () => {
  const tampering: [string, (value: AuthorizedTransmission) => void][] = [
    ["packet bytes", (v) => v.plan.packets[0]!.bytes.fill(255)],
    [
      "packet endpoint",
      (v) =>
        Object.assign(v.plan.packets[0]!.endpoint, {
          characteristicUuid: "1234",
        }),
    ],
    ["packet index", (v) => Object.assign(v.plan.packets[0]!, { index: 99 })],
    [
      "write mode",
      (v) => Object.assign(v.plan.packets[0]!, { writeMode: "with-response" }),
    ],
    ["pacing", (v) => Object.assign(v.plan.packets[0]!, { delayAfterMs: 1 })],
    ["driver identity", (v) => Object.assign(v.plan, { driverId: "other" })],
    ["profile identity", (v) => Object.assign(v.plan, { profileId: "other" })],
    [
      "evidence references",
      (v) => Object.assign(v.plan.evidenceRefs, { 0: "other" }),
    ],
    ["risk", (v) => Object.assign(v.plan, { risk: "transient" })],
    ["persistence", (v) => Object.assign(v.plan, { persistence: "volatile" })],
    ["validation", (v) => Object.assign(v.plan, { validation: "verified" })],
    [
      "execution intent",
      (v) => Object.assign(v.plan, { execution: "dry-run-only" }),
    ],
    ["purpose", (v) => Object.assign(v.plan, { purpose: "probe" })],
    ["timeout", (v) => Object.assign(v.plan, { timeoutMs: 1 })],
    ["operation/consequences", mutateConsequence],
    [
      "operation type",
      (v) => Object.assign(v.plan.operation, { type: "ShowFrame" }),
    ],
    [
      "animation geometry",
      (v) => {
        if (v.plan.operation.type === "ShowAnimation")
          Object.assign(v.plan.operation.sequence, { width: 3 });
      },
    ],
    [
      "frame geometry",
      (v) => {
        if (v.plan.operation.type === "ShowAnimation")
          Object.assign(v.plan.operation.sequence.frames[0]!, { height: 3 });
      },
    ],
    [
      "frame bytes",
      (v) => {
        if (v.plan.operation.type === "ShowAnimation")
          v.plan.operation.sequence.frames[0]!.data.fill(255);
      },
    ],
    [
      "frame timing",
      (v) => {
        if (v.plan.operation.type === "ShowAnimation")
          Object.assign(v.plan.operation.sequence.timing[0]!, {
            milliseconds: 999,
          });
      },
    ],
    [
      "recovery notes",
      (v) => Object.assign(v.plan.recoveryNotes, { 0: "unsafe restoration" }),
    ],
    [
      "metadata consequences",
      (v) => Object.assign(v.plan.metadata, { consequence: "different" }),
    ],
    [
      "outer target",
      (v) => Object.assign(v.targetBinding, { connectionId: "other" }),
    ],
    [
      "target fingerprint",
      (v) => Object.assign(v.targetBinding, { fingerprintKey: "other" }),
    ],
    [
      "target device",
      (v) => Object.assign(v.targetBinding, { browserDeviceId: "other" }),
    ],
    [
      "prepared target",
      (v) => Object.assign(v.plan.targetBinding, { browserDeviceId: "other" }),
    ],
    [
      "authorization decision",
      (v) => Object.assign(v, { policyDecision: "deny" }),
    ],
    ["authorization digest", (v) => Object.assign(v, { digest: "other" })],
    ["prepared digest", (v) => Object.assign(v.plan, { digest: "other" })],
  ];
  it.each(tampering)("rejects pre-entry tampering of %s", async (_, mutate) => {
    const { transport, authorized } = await fixture();
    mutate(authorized);
    await expect(
      new TransmissionExecutor(transport, new TraceRecorder()).execute(
        authorized,
      ),
    ).rejects.toThrow(/changed after confirmation/);
    expect(transport.writeAttempts).toHaveLength(0);
  });

  it("keeps the authorized command when callers mutate during a pending write", async () => {
    const { transport, authorized } = await fixture();
    const pending = deferred<TransportReceipt>();
    const original = transport.write.bind(transport);
    vi.spyOn(transport, "write").mockImplementationOnce(async (...args) => {
      const receipt = await original(...args);
      await pending.promise;
      return receipt;
    });
    const execution = new TransmissionExecutor(
      transport,
      new TraceRecorder(),
    ).execute(authorized);
    authorized.plan.packets[1]!.bytes.fill(255);
    Object.assign(authorized.plan.packets[1]!.endpoint, {
      characteristicUuid: "1234",
    });
    Object.assign(authorized.plan.packets[1]!, { delayAfterMs: 999 });
    mutateConsequence(authorized);
    pending.resolve({
      acceptedAt: new Date().toISOString(),
      endpoint: COOLLEDX_ENDPOINT,
      writeMode: "without-response",
      byteLength: 1,
    });
    const result = await execution;
    expect(transport.writes.map((write) => [...write.bytes])).toEqual([
      [1],
      [2],
      [3],
    ]);
    expect(
      result.packetTimings.map((timing) => timing.scheduledDelayMs),
    ).toEqual([0, 0, 0]);
  });

  it("isolates future packets from trace, transport and progress mutation", async () => {
    const { transport, authorized } = await fixture();
    const trace = new TraceRecorder();
    const record = trace.record.bind(trace);
    vi.spyOn(trace, "record").mockImplementation((type, metadata, bytes) => {
      const event = record(type, metadata, bytes);
      bytes?.fill(255);
      authorized.plan.packets[1]!.bytes.fill(255);
      return event;
    });
    const write = transport.write.bind(transport);
    vi.spyOn(transport, "write").mockImplementation(
      async (endpoint, bytes, mode) => {
        const receipt = await write(endpoint, bytes, mode);
        bytes.fill(255);
        Object.assign(endpoint, { characteristicUuid: "1234" });
        authorized.plan.packets[2]!.bytes.fill(255);
        return receipt;
      },
    );
    await new TransmissionExecutor(transport, trace).execute(
      authorized,
      undefined,
      () => {
        mutateConsequence(authorized);
        Object.assign(authorized.plan, { timeoutMs: 1 });
      },
    );
    expect(transport.writes.map((value) => [...value.bytes])).toEqual([
      [1],
      [2],
      [3],
    ]);
  });

  it("copies before invoking a target provider that mutates caller data", async () => {
    const { transport, authorized } = await fixture();
    const binding = { ...authorized.targetBinding };
    await new TransmissionExecutor(
      transport,
      new TraceRecorder(),
      undefined,
      () => {
        authorized.plan.packets[0]!.bytes.fill(255);
        return binding;
      },
    ).execute(authorized);
    expect(transport.writes[0]!.bytes).toEqual(Uint8Array.of(1));
  });

  it("rechecks the current connection after a synchronous trace observer", async () => {
    const { transport, authorized } = await fixture();
    const trace = new TraceRecorder();
    trace.subscribe((event) => {
      if (event.type === "tx.packet.started")
        transport.connectionId = "replacement";
    });
    await expect(
      new TransmissionExecutor(transport, trace).execute(authorized),
    ).rejects.toThrow(/different connection/);
    expect(transport.writeAttempts).toHaveLength(0);
  });

  it.each([1, 10, 100])(
    "performs one complete digest for %i packets",
    async (count) => {
      const { transport, authorized } = await fixture(count);
      const digest = vi.spyOn(transmission, "transmissionDigest");
      const result = await new TransmissionExecutor(
        transport,
        new TraceRecorder(),
      ).execute(authorized);
      expect(digest).toHaveBeenCalledTimes(1);
      expect(transport.writeAttempts).toHaveLength(count);
      expect(result.packetTimings).toHaveLength(count);
      expect(result.evidence!.wholePlanDigestCount).toBe(1);
      expect(result.evidence!.targetCheckCount).toBe(3 * count + 3);
    },
  );

  it.each([
    { type: "none" },
    { endpoints: [{ ...COOLLEDX_ENDPOINT, characteristicUuid: "1234" }] },
    { dispatchPacketIndex: 1 },
    { required: false },
    { timeoutMs: 1 },
    { opcode: 5 },
    { kind: "device-info" },
    { fulfillsOperation: true },
  ])("rejects a response contract changed before entry: %j", async (change) => {
    const { transport, authorized } = await fixture();
    const value = withResponse(authorized);
    Object.assign(value.plan.responseExpectation, change);
    const router = new NotificationRouter();
    const arm = vi.spyOn(router, "arm");
    await expect(
      new TransmissionExecutor(transport, new TraceRecorder(), router).execute(
        value,
        coolLedUxDriver,
      ),
    ).rejects.toThrow(/changed after confirmation/);
    expect(arm).not.toHaveBeenCalled();
    expect(transport.writeAttempts).toHaveLength(0);
  });

  it("isolates reviewed response consequences from caller and matcher mutation", async () => {
    const { transport, authorized } = await fixture(1);
    const value = withResponse(authorized);
    const router = new NotificationRouter();
    const context = { connectionId: transport.connectionId!, generation: 1 };
    router.beginConnection(context);
    const pending = deferred<TransportReceipt>();
    vi.spyOn(transport, "write").mockReturnValue(pending.promise);
    const driver = {
      ...coolLedUxDriver,
      responseMatches: vi.fn<
        NonNullable<typeof coolLedUxDriver.responseMatches>
      >((_decoded, expected) => {
        Object.assign(expected, { fulfillsOperation: true, opcode: 99 });
        if (expected.type === "notification")
          Object.assign(expected.endpoints[0]!, { characteristicUuid: "1234" });
        return true;
      }) as NonNullable<typeof coolLedUxDriver.responseMatches>,
    };
    const execution = new TransmissionExecutor(
      transport,
      new TraceRecorder(),
      router,
    ).execute(value, driver);
    Object.assign(value.plan.responseExpectation, {
      fulfillsOperation: true,
      opcode: 99,
    });
    driver.responseMatches = () => false;
    const record = router.recordLive(
      {
        timestamp: new Date().toISOString(),
        raw: Uint8Array.of(4),
        rawHex: "04",
        decoded: {
          family: "CoolLEDUX",
          kind: "command-echo",
          opcode: 4,
          summary: "echo",
          payloadHex: "04",
          fields: {},
        },
        endpoint: COOLLEDX_ENDPOINT,
      },
      context,
    );
    router.publish(record);
    pending.resolve({
      acceptedAt: new Date().toISOString(),
      endpoint: COOLLEDX_ENDPOINT,
      writeMode: "without-response",
      byteLength: 1,
    });
    const result = await execution;
    expect(result.responseRecord).toBe(record);
    expect(result.protocolAcknowledged).toBe(true);
    expect(result.deviceStateVerified).toBe(false);
  });
});

describe("executor-authored partial outcomes", () => {
  it.each([0, 1, 2])(
    "retains actual acceptance and original failure at packet %i",
    async (failedIndex) => {
      const { transport, authorized } = await fixture();
      const cause = new Error("transport cause");
      const failure = new Error("Primary write failure", { cause });
      const write = transport.write.bind(transport);
      vi.spyOn(transport, "write").mockImplementation((...args) => {
        if (transport.writes.length === failedIndex)
          return Promise.reject(failure);
        return write(...args);
      });
      const result = await new TransmissionExecutor(
        transport,
        new TraceRecorder(),
      )
        .execute(authorized)
        .catch((error: unknown) => error);
      expect(result).toBe(failure);
      expect(failure.cause).toBe(cause);
      const evidence = executionEvidence(result)!;
      expect(evidence).toMatchObject({
        planId: authorized.plan.id,
        digest: authorized.digest,
        targetBinding: authorized.targetBinding,
        authorizedAt: authorized.authorizedAt,
        totalPackets: 3,
        failedPacketIndex: failedIndex,
        failedStage: "write",
        outcome: "failed",
        responseStatus: "none",
      });
      expect(evidence.receipts).toHaveLength(failedIndex);
      expect(evidence.packetTimings).toHaveLength(failedIndex);
      expect(evidence.attempts.map((attempt) => attempt.settlement)).toEqual([
        ...Array.from({ length: failedIndex }, () => "accepted"),
        "failed",
      ]);
      expect(evidence.attempts.at(-1)!.receipt).toBeNull();
      expect(evidence.attempts.map((attempt) => [...attempt.bytes])).toEqual(
        Array.from({ length: failedIndex + 1 }, (_, index) => [index + 1]),
      );
      expect(evidence.attempts.at(-1)).toMatchObject({
        endpoint: COOLLEDX_ENDPOINT,
        writeMode: "without-response",
        hex: transmission.packetHex(Uint8Array.of(failedIndex + 1)),
      });
      expect(
        evidence.attempts.every(
          (attempt) => attempt.writeStartedAt && attempt.settledAt,
        ),
      ).toBe(true);
      expect(evidence.finalWriteAcceptedAt).toBe(
        evidence.receipts.at(-1)?.acceptedAt ?? null,
      );
    },
  );

  it.each(["target", "trace", "progress"])(
    "keeps the accepted receipt when %s fails after acceptance",
    async (scenario) => {
      const { transport, authorized } = await fixture();
      const failure = new Error("Observer failure");
      const trace = new TraceRecorder();
      if (scenario === "target") {
        const write = transport.write.bind(transport);
        vi.spyOn(transport, "write").mockImplementation(async (...args) => {
          const receipt = await write(...args);
          transport.connectionId = "replacement";
          return receipt;
        });
      } else if (scenario === "trace")
        trace.subscribe((event) => {
          if (event.type === "tx.packet.hostAccepted") throw failure;
        });
      const error = await new TransmissionExecutor(transport, trace)
        .execute(authorized, undefined, () => {
          if (scenario === "progress") throw failure;
        })
        .catch((error: unknown) => error);
      if (scenario !== "target") expect(error).toBe(failure);
      const evidence = executionEvidence(error)!;
      expect(evidence.receipts).toHaveLength(1);
      expect(evidence.packetTimings).toHaveLength(1);
      expect(evidence.attempts).toHaveLength(1);
      expect(evidence.attempts[0]!.settlement).toBe("accepted");
      expect(evidence.failedStage).toBe(
        scenario === "target"
          ? "authorization"
          : scenario === "trace"
            ? "observer"
            : "progress",
      );
      expect(transport.writeAttempts).toHaveLength(1);
    },
  );

  it("does not fabricate a write attempt for a predispatch observer failure", async () => {
    const { transport, authorized } = await fixture();
    const failure = new Error("Observer failed before dispatch");
    const trace = new TraceRecorder();
    trace.subscribe(() => {
      throw failure;
    });
    const error = await new TransmissionExecutor(transport, trace)
      .execute(authorized)
      .catch((error: unknown) => error);
    expect(error).toBe(failure);
    expect(executionEvidence(error)).toMatchObject({
      attempts: [],
      receipts: [],
      packetTimings: [],
      failedStage: "observer",
    });
    expect(transport.writeAttempts).toHaveLength(0);
  });

  it("preserves the primary write error when failure reporting also throws", async () => {
    const { transport, authorized } = await fixture();
    const primary = new Error("Primary transport failure");
    vi.spyOn(transport, "write").mockRejectedValue(primary);
    const trace = new TraceRecorder();
    trace.subscribe((event) => {
      if (event.type === "tx.packet.failed")
        throw new Error("Secondary observer failure");
    });
    await expect(
      new TransmissionExecutor(transport, trace).execute(authorized),
    ).rejects.toBe(primary);
    expect(executionEvidence(primary)!.failedStage).toBe("write");
  });

  it("returns independent evidence and rejects caller-provided lookalikes", async () => {
    const { transport, authorized } = await fixture();
    transport.failWriteAt = 1;
    const error = await new TransmissionExecutor(transport, new TraceRecorder())
      .execute(authorized)
      .catch((error: unknown) => error);
    const first = executionEvidence(error)!;
    Object.assign(first.targetBinding, { connectionId: "forged" });
    Object.assign(first.receipts[0]!.endpoint, { characteristicUuid: "1234" });
    Object.assign(first.attempts[0]!, { settlement: "failed" });
    first.attempts[0]!.bytes.fill(255);
    Object.assign(first.attempts[0]!.endpoint, { characteristicUuid: "1234" });
    const second = executionEvidence(error)!;
    expect(second.targetBinding).toEqual(authorized.targetBinding);
    expect(second.receipts[0]!.endpoint).toEqual(COOLLEDX_ENDPOINT);
    expect(second.attempts[0]!.settlement).toBe("accepted");
    expect(second.attempts[0]!.bytes).toEqual(Uint8Array.of(1));
    expect(second.attempts[0]!.endpoint).toEqual(COOLLEDX_ENDPOINT);
    expect(executionEvidence({ evidence: second })).toBeNull();
    expect(executionEvidence(new Error("arbitrary"))).toBeNull();
  });

  it("preserves a primitive rejection as cause with its actual attempt", async () => {
    const { transport, authorized } = await fixture();
    vi.spyOn(transport, "write").mockRejectedValue("original rejection");
    const error = await new TransmissionExecutor(transport, new TraceRecorder())
      .execute(authorized)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: "original rejection" });
    expect(executionEvidence(error)!.attempts).toHaveLength(1);
  });

  it("retains rejected retired-connection acceptance separately from current success", async () => {
    const { transport, authorized } = await fixture();
    const lateReceipt = {
      acceptedAt: new Date().toISOString(),
      endpoint: { ...COOLLEDX_ENDPOINT },
      writeMode: "without-response" as const,
      byteLength: 1,
    };
    const retired = Object.assign(
      new Error("Retired connection accepted late"),
      { lateReceipt },
    );
    vi.spyOn(transport, "write").mockRejectedValue(retired);
    const trace = new TraceRecorder();
    await expect(
      new TransmissionExecutor(transport, trace).execute(authorized),
    ).rejects.toBe(retired);
    const evidence = executionEvidence(retired)!;
    expect(evidence.receipts).toHaveLength(0);
    expect(evidence.packetTimings).toHaveLength(0);
    expect(evidence.attempts[0]).toMatchObject({
      settlement: "failed",
      receipt: null,
      lateReceipt,
    });
    expect(evidence.finalWriteAcceptedAt).toBeNull();
    expect(
      trace.events.find((event) => event.type === "tx.packet.lateHostAccepted")!
        .metadata,
    ).toMatchObject({ planId: authorized.plan.id, packetIndex: 0 });
  });

  it("exposes response timeout while preserving the simultaneous primary write failure", async () => {
    vi.useFakeTimers();
    const { transport, authorized } = await fixture(1);
    const value = withResponse(authorized);
    const router = new NotificationRouter();
    router.beginConnection({
      connectionId: transport.connectionId!,
      generation: 1,
    });
    const pending = deferred<TransportReceipt>();
    vi.spyOn(transport, "write").mockReturnValue(pending.promise);
    const failure = new Error("Write failed after response timeout");
    const outcome = new TransmissionExecutor(
      transport,
      new TraceRecorder(),
      router,
    )
      .execute(value, coolLedUxDriver)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    pending.reject(failure);
    expect(await outcome).toBe(failure);
    expect(executionEvidence(failure)).toMatchObject({
      responseStatus: "timeout",
      responseTimedOut: true,
      receipts: [],
      failedStage: "write",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps indeterminate attribution and does not rewrite it after late acceptance", async () => {
    vi.useFakeTimers();
    const { transport, authorized } = await fixture();
    const pending = deferred<TransportReceipt>();
    vi.spyOn(transport, "write").mockReturnValue(pending.promise);
    const trace = new TraceRecorder();
    const executor = new TransmissionExecutor(transport, trace);
    const outcome = executor
      .execute(authorized)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    const error = await outcome;
    expect(error).toBeInstanceOf(IndeterminateWriteError);
    expect(executionEvidence(error)).toMatchObject({
      outcome: "indeterminate",
      failedPacketIndex: 0,
      receipts: [],
      attempts: [{ settlement: "indeterminate", receipt: null }],
    });
    expect(transport.state).toBe("quarantined");
    expect(executor.busy).toBe(false);
    await expect(executor.execute(authorized)).rejects.toThrow(/disconnected/);
    const receipt = {
      acceptedAt: new Date().toISOString(),
      endpoint: COOLLEDX_ENDPOINT,
      writeMode: "without-response" as const,
      byteLength: 1,
    };
    pending.resolve(receipt);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      trace.events.find((event) => event.type === "tx.packet.lateHostAccepted")!
        .metadata,
    ).toMatchObject({
      planId: authorized.plan.id,
      packetIndex: 0,
      acceptedAt: receipt.acceptedAt,
    });
    expect(executionEvidence(error)!.receipts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.write).toHaveBeenCalledTimes(1);
  });

  it.each(["revoked-authority", "replacement", "quarantine-observer"])(
    "retains timeout ownership with %s",
    async (scenario) => {
      vi.useFakeTimers();
      const { transport, authorized } = await fixture(1);
      const pending = deferred<TransportReceipt>();
      vi.spyOn(transport, "write").mockReturnValue(pending.promise);
      let binding: typeof authorized.targetBinding | null = {
        ...authorized.targetBinding,
      };
      if (scenario === "quarantine-observer")
        vi.spyOn(transport, "quarantine").mockImplementation(() => {
          throw new Error("Quarantine observer failure");
        });
      const executor = new TransmissionExecutor(
        transport,
        new TraceRecorder(),
        undefined,
        () => binding,
      );
      const outcome = executor
        .execute(authorized)
        .catch((error: unknown) => error);
      if (scenario === "replacement") {
        transport.connectionId = "replacement";
        binding = { ...authorized.targetBinding, connectionId: "replacement" };
      } else if (scenario === "revoked-authority") binding = null;
      await vi.advanceTimersByTimeAsync(500);
      expect(await outcome).toBeInstanceOf(IndeterminateWriteError);
      expect(transport.state).toBe(
        scenario === "revoked-authority" ? "quarantined" : "connected",
      );
      if (scenario === "quarantine-observer")
        await expect(executor.execute(authorized)).rejects.toThrow(
          /may still complete/,
        );
      expect(transport.write).toHaveBeenCalledTimes(1);
      pending.reject(new Error("Retired pending write rejected"));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
