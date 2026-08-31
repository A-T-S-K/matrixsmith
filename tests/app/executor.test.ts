import { describe, expect, it } from "vitest";
import { TransmissionExecutor } from "../../src/app/executor";
import { packetHex, type AuthorizedTransmission, type TransmissionPacket } from "../../src/core/transmission";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";

function packet(index: number, byte: number): TransmissionPacket {
  const bytes = Uint8Array.of(byte);
  return { index, endpoint: COOLLEDX_ENDPOINT, writeMode: "without-response", bytes, hex: packetHex(bytes) };
}

function authorized(packets: readonly TransmissionPacket[], timeoutMs = 100): AuthorizedTransmission {
  return { authorizedAt: new Date().toISOString(), policyDecision: "allow", plan: {
    id: "plan:executor", driverId: "coolledx", profileId: "iledhat-31ae-32x16", operation: { type: "SetBrightness", raw: 0x40 },
    risk: "transient", persistence: "unknown", validation: "experimental", evidenceRefs: [], packets,
    ackPolicy: "none", retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs, recoveryNotes: [], metadata: {},
  } };
}

async function connectedFake(): Promise<FakeTransport> {
  const transport = new FakeTransport(knownIledHatFingerprint());
  await transport.selectAndConnect({ mode: "registered", hints: { filters: [], optionalServices: [] } });
  return transport;
}

describe("TransmissionExecutor", () => {
  it("writes packets in order and keeps host acceptance separate from verification", async () => {
    const transport = await connectedFake();
    const trace = new TraceRecorder();
    const result = await new TransmissionExecutor(transport, trace).execute(authorized([packet(0, 1), packet(1, 2)]));
    expect(transport.writes.map(({ bytes }) => bytes[0])).toEqual([1, 2]);
    expect(result.deviceVerified).toBe(false);
    expect(trace.events.map(({ type }) => type)).toEqual(["tx.packet.started", "tx.packet.hostAccepted", "tx.packet.started", "tx.packet.hostAccepted", "tx.completed"]);
  });

  it("aborts after a write failure", async () => {
    const transport = await connectedFake();
    transport.failWriteAt = 1;
    await expect(new TransmissionExecutor(transport, new TraceRecorder()).execute(authorized([packet(0, 1), packet(1, 2), packet(2, 3)]))).rejects.toThrow(/Injected/);
    expect(transport.writes).toHaveLength(1);
  });

  it("rejects disconnected execution", async () => {
    const transport = new FakeTransport(knownIledHatFingerprint());
    await expect(new TransmissionExecutor(transport, new TraceRecorder()).execute(authorized([packet(0, 1)]))).rejects.toThrow(/disconnected/);
  });

  it("prevents concurrent transmission", async () => {
    const transport = await connectedFake();
    transport.writeDelayMs = 20;
    const executor = new TransmissionExecutor(transport, new TraceRecorder());
    const first = executor.execute(authorized([packet(0, 1)]));
    await expect(executor.execute(authorized([packet(0, 2)]))).rejects.toThrow(/already in progress/);
    await first;
  });

  it("takes the timeout path without retry", async () => {
    const transport = await connectedFake();
    transport.writeDelayMs = 30;
    await expect(new TransmissionExecutor(transport, new TraceRecorder()).execute(authorized([packet(0, 1)], 1))).rejects.toThrow(/timed out/);
    expect(transport.writes).toHaveLength(0);
  });
});
