import { describe, expect, it } from "vitest";
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

  it("arms the response waiter before a synchronous fast notification", async () => {
    const transport = await connectedFake();
    const router = new NotificationRouter();
    const fingerprint = knownIledHatFingerprint();
    await transport.subscribe(COOLLEDX_ENDPOINT, (raw) => {
      const decoded =
        coolLedUxDriver.decodeNotification?.(raw, {
          profile: iledHat31aeProfile,
          fingerprint,
          source: "live",
        }) ?? null;
      router.publish({
        timestamp: new Date().toISOString(),
        raw,
        rawHex: "01 00 02 06 04 40 03",
        decoded,
      });
    });
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
          opcode: 0x04,
          kind: "command-echo",
          required: true,
          timeoutMs: 50,
          fulfillsOperation: false,
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
  });
});
