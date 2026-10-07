import { deferred } from "../helpers/deferred-gatt";
import type { TransportReceipt } from "../../src/application/ports/transport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransmissionExecutor } from "../../src/app/executor";
import {
  packetHex,
  prepareTransmission,
  type AuthorizedTransmission,
  type TransmissionPacket,
} from "../../src/core/transmission";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { NotificationRouter } from "../../src/app/notifications";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { fingerprintIdentityKey } from "../../src/investigation/device-identity";

function packet(index: number, byte: number): TransmissionPacket {
  const bytes = Uint8Array.of(byte);
  return {
    index,
    endpoint: COOLLEDX_ENDPOINT,
    writeMode: "without-response",
    bytes,
    hex: packetHex(bytes),
  };
}

function authorized(
  transport: FakeTransport,
  packets: readonly TransmissionPacket[],
  timeoutMs = 100,
): AuthorizedTransmission {
  const plan = prepareTransmission(
    {
      id: "plan:executor",
      driverId: "coolledx",
      profileId: "iledhat-31ae-32x16",
      operation: { type: "SetBrightness", raw: 0x40 },
      risk: "transient",
      persistence: "unknown",
      validation: "experimental",
      evidenceRefs: [],
      packets,
      responseExpectation: { type: "none" },
      execution: "live",
      purpose: "operation",
      timeoutMs,
      recoveryNotes: [],
      metadata: {},
    },
    {
      connectionId: transport.connectionId!,
      fingerprintKey: fingerprintIdentityKey(transport.fingerprint!),
      browserDeviceId: transport.fingerprint!.browserDeviceId ?? null,
    },
  );
  return {
    authorizedAt: new Date().toISOString(),
    policyDecision: "allow",
    plan,
    targetBinding: plan.targetBinding,
    digest: plan.digest,
  };
}

async function connectedFake(): Promise<FakeTransport> {
  const transport = new FakeTransport(knownIledHatFingerprint());
  await transport.selectAndConnect({
    mode: "registered",
    hints: { filters: [], optionalServices: [] },
  });
  return transport;
}

describe("TransmissionExecutor", () => {
  it("writes packets in order and keeps host acceptance separate from verification", async () => {
    const transport = await connectedFake();
    const trace = new TraceRecorder();
    const result = await new TransmissionExecutor(transport, trace).execute(
      authorized(transport, [packet(0, 1), packet(1, 2)]),
    );
    expect(transport.writes.map(({ bytes }) => bytes[0])).toEqual([1, 2]);
    expect(result.deviceStateVerified).toBe(false);
    expect(trace.events.map(({ type }) => type)).toEqual([
      "tx.packet.started",
      "tx.packet.hostAccepted",
      "tx.packet.started",
      "tx.packet.hostAccepted",
      "tx.completed",
    ]);
  });

  it("reports packet progress from actual host-accepted writes", async () => {
    const transport = await connectedFake();
    const progress: { completedPackets: number; totalPackets: number }[] = [];
    await new TransmissionExecutor(transport, new TraceRecorder()).execute(
      authorized(transport, [packet(0, 1), packet(1, 2), packet(2, 3)]),
      undefined,
      (value) => progress.push(value),
    );
    expect(progress.map(({ completedPackets }) => completedPackets)).toEqual([
      1, 2, 3,
    ]);
    expect(progress.every(({ totalPackets }) => totalPackets === 3)).toBe(true);
  });

  it("aborts after a write failure", async () => {
    const transport = await connectedFake();
    transport.failWriteAt = 1;
    await expect(
      new TransmissionExecutor(transport, new TraceRecorder()).execute(
        authorized(transport, [packet(0, 1), packet(1, 2), packet(2, 3)]),
      ),
    ).rejects.toThrow(/Injected/);
    expect(transport.writes).toHaveLength(1);
  });

  it("rejects disconnected execution", async () => {
    const connected = await connectedFake();
    const value = authorized(connected, [packet(0, 1)]);
    await connected.disconnect();
    await expect(
      new TransmissionExecutor(connected, new TraceRecorder()).execute(value),
    ).rejects.toThrow(/disconnected/);
  });

  it("prevents concurrent transmission", async () => {
    const transport = await connectedFake();
    transport.writeDelayMs = 20;
    const executor = new TransmissionExecutor(transport, new TraceRecorder());
    const first = executor.execute(authorized(transport, [packet(0, 1)]));
    await expect(
      executor.execute(authorized(transport, [packet(0, 2)])),
    ).rejects.toThrow(/already in progress/);
    await first;
  });

  it("takes the timeout path without retry", async () => {
    const transport = await connectedFake();
    transport.writeDelayMs = 30;
    await expect(
      new TransmissionExecutor(transport, new TraceRecorder()).execute(
        authorized(transport, [packet(0, 1)], 1),
      ),
    ).rejects.toThrow(/may still complete/);
    expect(transport.state).toBe("quarantined");
    expect(transport.writeAttempts).toHaveLength(1);
    expect(transport.writes).toHaveLength(0);
  });

  it("rejects an endpoint mismatch before transport write", async () => {
    const transport = await connectedFake();
    const wrong = {
      ...packet(0, 1),
      endpoint: {
        serviceUuid: "00001234-0000-1000-8000-00805f9b34fb",
        characteristicUuid: "00005678-0000-1000-8000-00805f9b34fb",
      },
    };
    await expect(
      new TransmissionExecutor(transport, new TraceRecorder()).execute(
        authorized(transport, [wrong]),
      ),
    ).rejects.toThrow(/endpoint/);
    expect(transport.writeAttempts).toHaveLength(0);
  });

  it("rechecks the digest immediately before writing", async () => {
    const transport = await connectedFake();
    const value = authorized(transport, [packet(0, 1)]);
    value.plan.packets[0]!.bytes[0] = 2;
    await expect(
      new TransmissionExecutor(transport, new TraceRecorder()).execute(value),
    ).rejects.toThrow(/changed after confirmation/i);
    expect(transport.writeAttempts).toHaveLength(0);
  });

  it.each([false, true])(
    "arms a fast operation response (fulfills operation: %s)",
    async (fulfillsOperation) => {
      const transport = await connectedFake();
      const router = new NotificationRouter();
      const context = { connectionId: transport.connectionId!, generation: 1 };
      router.beginConnection(context);
      vi.useFakeTimers();
      const fingerprint = knownIledHatFingerprint();
      await transport.subscribe(COOLLEDX_ENDPOINT, (raw) => {
        const decoded =
          coolLedUxDriver.decodeNotification?.(raw, {
            profile: iledHat31aeProfile,
            fingerprint,
            source: "live",
          }) ?? null;
        router.publish(
          router.recordLive(
            {
              endpoint: COOLLEDX_ENDPOINT,
              timestamp: new Date().toISOString(),
              raw,
              rawHex: "01 00 02 06 04 40 03",
              decoded,
            },
            context,
          ),
        );
      });
      transport.notificationOnWriteEndpoint = COOLLEDX_ENDPOINT;
      transport.notificationOnWrite = Uint8Array.of(
        0x01,
        0x00,
        0x02,
        0x06,
        0x04,
        0x40,
        0x03,
      );
      const value = authorized(transport, [packet(0, 1)]);
      const changed = prepareTransmission(
        {
          ...value.plan,
          driverId: "coolledux",
          validation: "verified",
          responseExpectation: {
            type: "notification",
            endpoints: [COOLLEDX_ENDPOINT],
            dispatchPacketIndex: 0,
            opcode: 0x04,
            kind: "command-echo",
            required: true,
            timeoutMs: 50,
            fulfillsOperation,
          },
        },
        value.targetBinding,
      );
      const withResponse: AuthorizedTransmission = {
        ...value,
        plan: changed,
        targetBinding: changed.targetBinding,
        digest: changed.digest,
      };
      const result = await new TransmissionExecutor(
        transport,
        new TraceRecorder(),
        router,
      ).execute(withResponse, coolLedUxDriver);
      expect(result.protocolAcknowledged).toBe(true);
      expect(result.responseTimedOut).toBe(false);
      expect(result.deviceStateVerified).toBe(fulfillsOperation);
      // Verification follows the declared response; there is no second readback.
      expect(transport.writeAttempts).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

afterEach(() => vi.useRealTimers());
it.each([
  "timeout",
  "reset",
  "write-failure",
  "reset-write-failure",
  "cancel-write-failure",
  "indeterminate",
])("supervises %s while host acceptance is pending", async (scenario) => {
  vi.useFakeTimers();
  const transport = await connectedFake();
  const router = new NotificationRouter();
  router.beginConnection({
    connectionId: transport.connectionId!,
    generation: 1,
  });
  const arm = vi.spyOn(router, "arm");
  const matches = vi.fn(() => false);
  const pending = deferred<TransportReceipt>();
  vi.spyOn(transport, "write").mockReturnValue(pending.promise);
  const base = authorized(transport, [packet(0, 1)], 5000);
  const plan = prepareTransmission(
    {
      ...base.plan,
      driverId: "coolledux",
      responseExpectation: {
        type: "notification",
        endpoints: [COOLLEDX_ENDPOINT],
        dispatchPacketIndex: 0,
        opcode: 4,
        kind: "command-echo",
        required: true,
        timeoutMs: 1500,
        fulfillsOperation: false,
      },
    },
    base.targetBinding,
  );
  const execution = new TransmissionExecutor(
    transport,
    new TraceRecorder(),
    router,
  ).execute(
    { ...base, plan, digest: plan.digest },
    { ...coolLedUxDriver, responseMatches: matches },
  );
  const outcome = execution.then(
    (value) => value,
    (error: unknown) => error,
  );
  if (scenario === "cancel-write-failure") arm.mock.results[0]!.value.cancel();
  else if (scenario === "reset" || scenario === "reset-write-failure")
    router.reset("Disconnected during write");
  else await vi.advanceTimersByTimeAsync(1500);
  if (scenario === "indeterminate") await vi.advanceTimersByTimeAsync(3500);
  if (scenario.includes("write-failure"))
    pending.reject(new Error("Primary write failure"));
  else
    pending.resolve({
      acceptedAt: new Date().toISOString(),
      endpoint: COOLLEDX_ENDPOINT,
      writeMode: "without-response",
      byteLength: 1,
    });
  const result = await outcome;
  if (scenario === "timeout")
    expect(result).toMatchObject({
      responseTimedOut: true,
      hostAccepted: true,
    });
  else
    expect(result).toEqual(
      expect.objectContaining({
        message:
          scenario === "reset"
            ? "Disconnected during write"
            : scenario === "indeterminate"
              ? expect.stringMatching(/write may still complete/)
              : "Primary write failure",
      }),
    );
  expect(vi.getTimerCount()).toBe(0);
  // reset after cleanup must not reject or change the settled armed outcome.
  router.publish({
    timestamp: new Date().toISOString(),
    raw: new Uint8Array(),
    rawHex: "",
    decoded: {
      family: "CoolLEDUX",
      kind: "command-echo",
      summary: "cleanup check",
      payloadHex: "",
      fields: {},
    },
  });
  expect(matches).not.toHaveBeenCalled();
  router.reset("after cleanup");
  expect(arm).toHaveBeenCalledTimes(1);
});

it("opens a multi-packet query only at its reviewed dispatch packet", async () => {
  vi.useFakeTimers();
  const transport = await connectedFake();
  const router = new NotificationRouter();
  const context = { connectionId: transport.connectionId!, generation: 1 };
  router.beginConnection(context);
  const decoded = {
    family: "CoolLEDUX",
    kind: "command-echo",
    opcode: 4,
    summary: "echo",
    payloadHex: "04",
    fields: {},
  };
  const received: import("../../src/app/notifications").NotificationRecord[] =
    [];
  const matches = vi.fn(coolLedUxDriver.responseMatches!);
  const original = transport.write.bind(transport);
  vi.spyOn(transport, "write").mockImplementation(async (...args) => {
    if (received.length) router.publish(received[0]!);
    const record = router.recordLive(
      {
        timestamp: new Date().toISOString(),
        raw: Uint8Array.of(4),
        rawHex: "04",
        decoded,
        endpoint: COOLLEDX_ENDPOINT,
      },
      context,
    );
    received.push(record);
    router.publish(record);
    if (received.length === 1)
      await new Promise((resolve) => setTimeout(resolve, 20));
    return original(...args);
  });
  const base = authorized(transport, [packet(0, 1), packet(1, 1)]);
  const plan = prepareTransmission(
    {
      ...base.plan,
      driverId: "coolledux",
      responseExpectation: {
        type: "notification",
        endpoints: [COOLLEDX_ENDPOINT],
        dispatchPacketIndex: 1,
        opcode: 4,
        kind: "command-echo",
        required: true,
        timeoutMs: 5,
        fulfillsOperation: false,
      },
    },
    base.targetBinding,
  );
  const pending = new TransmissionExecutor(
    transport,
    new TraceRecorder(),
    router,
  ).execute(
    { ...base, plan, digest: plan.digest },
    { ...coolLedUxDriver, responseMatches: matches },
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(matches).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10);
  const result = await pending;
  expect(result.responseRecord).toBe(received[1]);
  expect(result.responseTimedOut).toBe(false);
  expect(matches).toHaveBeenCalledTimes(1);
  expect(transport.writeAttempts.map((attempt) => [...attempt.bytes])).toEqual([
    [1],
    [1],
  ]);
  expect(vi.getTimerCount()).toBe(0);
});
