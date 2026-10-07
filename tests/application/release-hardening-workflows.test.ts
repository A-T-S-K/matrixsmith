import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TransmissionService } from "../../src/application/services/transmission-service";
import { WorkflowReservation } from "../../src/application/workflow-context";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";

const tool = "coolledux-brightness-round-trip";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  await runtime.probe();
  return { transport, runtime };
}
function holdStep(step: number) {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  const execute = TransmissionService.prototype._execute;
  let count = 0;
  vi.spyOn(TransmissionService.prototype, "_execute").mockImplementation(
    async function (this: TransmissionService, ...args) {
      const result = await execute.apply(this, args);
      if (++count === step) {
        enter();
        await held;
      }
      return result;
    },
  );
  return { entered, release };
}

it.each([1, 2, 3, 4, 5])(
  "retires at step %i without applying an old baseline or follow-up to replacement B",
  async (phase) => {
    const { runtime, transport } = await setup();
    const gate = holdStep(phase);
    const pending = runtime.runDiagnostic(tool);
    await gate.entered;
    const attempts = transport.writeAttempts.length;
    await runtime.disconnect();
    transport.fingerprint = {
      ...knownIledHatFingerprint(),
      browserDeviceId: "replacement-B",
    };
    await runtime.connect();
    const replacement = runtime.session.fingerprint;
    gate.release();
    const run = await pending;
    expect(run.status).not.toBe("passed");
    expect(run.restorationVerified).toBe(false);
    expect(run.restorationAttempted).toBe(phase >= 4);
    expect(transport.writeAttempts).toHaveLength(attempts);
    expect(runtime.session.fingerprint).toBe(replacement);
    expect(runtime.session.latestDeviceInfo).toBeNull();
    expect(runtime.session.experimentalTxEnabled).toBe(false);
    expect(runtime.diagnosticRuns).toContain(run);
    await runtime.dispose();
  },
);

it("retires even if the same authorized device reconnects with an identical fingerprint and connection ID", async () => {
  const { runtime, transport } = await setup();
  const oldConnection = transport.connectionId;
  const fingerprint = transport.fingerprint;
  const gate = holdStep(2);
  const pending = runtime.runDiagnostic(tool);
  await gate.entered;
  const attempts = transport.writeAttempts.length;
  await runtime.disconnect();
  transport.fingerprint = fingerprint;
  Object.defineProperty(transport, "reconnectAuthorized", {
    value: (
      _id: string,
      options: Parameters<typeof transport.selectAndConnect>[0],
    ) => transport.selectAndConnect(options),
  });
  await runtime.reconnectAuthorized("fixture-device");
  transport.connectionId = oldConnection;
  gate.release();
  const run = await pending;
  expect(run.restorationAttempted).toBe(false);
  expect(run.restorationVerified).toBe(false);
  expect(transport.writeAttempts).toHaveLength(attempts);
  await runtime.dispose();
});

it.each(["geometry", "profile", "authority", "disposal"] as const)(
  "retires on %s replacement before preparing another command",
  async (boundary) => {
    const { runtime, transport } = await setup();
    const gate = holdStep(2);
    const pending = runtime.runDiagnostic(tool);
    await gate.entered;
    const attempts = transport.writeAttempts.length;
    if (boundary === "geometry") runtime.session.geometryRevision += 1;
    if (boundary === "profile")
      runtime.session.profile = { ...runtime.session.profile! };
    if (boundary === "authority") runtime.session.enableExperimentalTx();
    if (boundary === "disposal") await runtime.dispose();
    gate.release();
    const run = await pending;
    expect(run.status).toBe("failed");
    expect(run.restorationAttempted).toBe(false);
    expect(transport.writeAttempts).toHaveLength(attempts);
    await runtime.dispose();
  },
);

it("keeps a reservation between commands while disconnect recovery remains available", async () => {
  const { runtime, transport } = await setup();
  const gate = holdStep(1);
  const pending = runtime.runDiagnostic(tool);
  await gate.entered;
  expect(runtime.executionBusy).toBe(true);
  expect(() => runtime.send(runtime.plan({ type: "GetDeviceInfo" }))).toThrow(
    /workflow owns execution/,
  );
  expect(() => runtime.runDiagnostic(tool)).toThrow(/workflow owns execution/);
  expect(() => runtime.startDiscovery()).toThrow(/workflow owns execution/);
  expect(() => runtime.importBundle(runtime.exportBundle())).toThrow(
    /workflow owns execution/,
  );
  await runtime.disconnect();
  await runtime.connect();
  gate.release();
  await pending;
  expect(runtime.executionBusy).toBe(false);
  await runtime.probe();
  expect(transport.writeAttempts.length).toBeGreaterThan(1);
  await runtime.dispose();
});

it("does not let stale cleanup release a replacement reservation", () => {
  const reservation = new WorkflowReservation();
  let originalCurrent = true;
  const first = { current: () => originalCurrent, assertCurrent: () => {} };
  const releaseFirst = reservation.acquire(first);
  originalCurrent = false;
  const second = { current: () => true, assertCurrent: () => {} };
  const releaseSecond = reservation.acquire(second);
  releaseFirst();
  expect(reservation.busy).toBe(true);
  expect(() => reservation.guard()).toThrow(/workflow owns execution/);
  releaseSecond();
  expect(reservation.busy).toBe(false);
});

it("retains successful restoration in the same uninterrupted context", async () => {
  const { runtime, transport } = await setup();
  const run = await runtime.runDiagnostic(tool);
  expect(run).toMatchObject({
    status: "passed",
    restorationAttempted: true,
    restorationVerified: true,
  });
  expect(transport.brightness).toBe(0xcc);
  expect(runtime.executionBusy).toBe(false);
  await runtime.dispose();
});

it("restores after a safe same-context readback mismatch", async () => {
  const { runtime, transport } = await setup();
  transport.ignoreBrightnessState = true;
  const run = await runtime.runDiagnostic(tool);
  expect(run).toMatchObject({
    status: "failed",
    restorationAttempted: true,
    restorationVerified: true,
  });
  expect(run.steps.find((step) => step.id === "verify-test")?.status).toBe(
    "failed",
  );
  await runtime.dispose();
});

it("never retries or restores an indeterminate quarantined write", async () => {
  const { runtime, transport } = await setup();
  vi.useFakeTimers();
  const write = transport.write.bind(transport);
  vi.spyOn(transport, "write").mockImplementation((...args) => {
    if (args[1][4] === 0x04) transport.writeDelayMs = 6000;
    return write(...args);
  });
  const attempts = transport.writeAttempts.length;
  const pending = runtime.runDiagnostic(tool);
  await vi.runAllTimersAsync();
  const run = await pending;
  expect(run).toMatchObject({
    status: "failed",
    restorationAttempted: false,
    restorationVerified: false,
  });
  expect(transport.state).toBe("quarantined");
  expect(transport.writeAttempts).toHaveLength(attempts + 2);
  await runtime.disconnect();
  expect(transport.state).toBe("idle");
  await runtime.dispose();
});

it("does not restore device A's baseline onto B when replacement happens during the test write", async () => {
  const { runtime, transport } = await setup();
  const write = transport.write.bind(transport);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(transport, "write").mockImplementation(async (...args) => {
    const receipt = await write(...args);
    if (args[1][4] === 0x04) {
      enter();
      await held;
    }
    return receipt;
  });
  const pending = runtime.runDiagnostic(tool);
  await entered;
  const attempts = transport.writeAttempts.length;
  await runtime.disconnect();
  transport.fingerprint = {
    ...knownIledHatFingerprint(),
    browserDeviceId: "replacement-B",
  };
  await runtime.connect();
  release();
  const run = await pending;
  expect(run).toMatchObject({
    status: "failed",
    restorationAttempted: false,
    restorationVerified: false,
  });
  expect(transport.writeAttempts).toHaveLength(attempts);
  expect(transport.state).toBe("connected");
  expect(runtime.session.latestDeviceInfo).toBeNull();
  await runtime.dispose();
});

it("rejects diagnostic startup while a characteristic read retains connection ownership", async () => {
  const { runtime, transport } = await setup();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => (finish = resolve));
  vi.spyOn(transport, "read").mockImplementation(async () => {
    await held;
    return new Uint8Array();
  });
  const endpoint = runtime.availableEndpoints()[0]!;
  const read = runtime.read(endpoint);
  expect(() => runtime.runDiagnostic(tool)).toThrow(
    /pending connection operation/,
  );
  finish();
  await read;
  expect((await runtime.runDiagnostic(tool)).status).toBe("passed");
  await runtime.dispose();
});

it("old diagnostic cleanup cannot free a new diagnostic on the replacement connection", async () => {
  const { runtime } = await setup();
  const execute = TransmissionService.prototype._execute;
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
  };
  const gates = [deferred(), deferred()];
  const entered = [deferred(), deferred()];
  let step = 0;
  vi.spyOn(TransmissionService.prototype, "_execute").mockImplementation(
    async function (this: TransmissionService, ...args) {
      const result = await execute.apply(this, args);
      const index = step++;
      if (index < 2) {
        entered[index]!.resolve();
        await gates[index]!.promise;
      }
      return result;
    },
  );
  const old = runtime.runDiagnostic(tool);
  await entered[0]!.promise;
  await runtime.disconnect();
  await runtime.connect();
  await runtime.probe();
  const replacement = runtime.runDiagnostic(tool);
  await entered[1]!.promise;
  gates[0]!.resolve();
  expect((await old).restorationAttempted).toBe(false);
  expect(runtime.executionBusy).toBe(true);
  expect(() => runtime.send(runtime.plan({ type: "GetDeviceInfo" }))).toThrow(
    /workflow owns execution/,
  );
  gates[1]!.resolve();
  expect((await replacement).status).toBe("passed");
  expect(runtime.executionBusy).toBe(false);
  await runtime.dispose();
});

it("never revives a diagnostic after its captured identity authority was withdrawn and old values restored", async () => {
  const { runtime, transport } = await setup();
  const original = {
    fingerprint: runtime.session.fingerprint,
    selection: runtime.session.selection,
    profile: runtime.session.profile,
    protocolResolution: runtime.session.protocolResolution,
  };
  const gate = holdStep(2);
  const pending = runtime.runDiagnostic(tool);
  await gate.entered;
  const attempts = transport.writeAttempts.length;
  runtime.session.withdrawIdentityTrust();
  // Old values cannot reconstitute uninterrupted workflow authority.
  Object.assign(runtime.session, original);
  gate.release();
  const run = await pending;
  expect(run).toMatchObject({
    status: "failed",
    restorationAttempted: false,
    restorationVerified: false,
  });
  expect(transport.writeAttempts).toHaveLength(attempts);
  expect(runtime.session.latestDeviceInfo).toBeNull();
  await runtime.dispose();
});
