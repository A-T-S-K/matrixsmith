import { afterEach, expect, it, vi } from "vitest";
import { WebBluetoothTransport } from "../../src/transport/web-bluetooth";
import { TraceRecorder } from "../../src/diagnostics/trace";
import {
  deferred,
  endpoint,
  gattDevice,
  installBluetooth,
  options,
} from "../helpers/deferred-gatt";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "retires pending and queued writes across replacement (same device: %s)",
  async (same) => {
    const old = gattDevice();
    const pending = deferred<void>();
    old.characteristic.writeValueWithoutResponse.mockImplementationOnce(
      () => pending.promise,
    );
    installBluetooth(old.device);
    const transport = new WebBluetoothTransport(new TraceRecorder());
    await transport.selectAndConnect(options);
    const first = transport.write(
      endpoint,
      Uint8Array.of(1),
      "without-response",
    );
    const firstOutcome = first.catch((error) => error);
    const queued = transport
      .write(endpoint, Uint8Array.of(2), "without-response")
      .catch((error) => error);
    await vi.waitFor(() =>
      expect(
        old.characteristic.writeValueWithoutResponse,
      ).toHaveBeenCalledTimes(1),
    );
    transport.quarantine("pending write");
    await transport.disconnect();
    const fresh = same ? old : gattDevice("replacement");
    fresh.server.connected = true;
    installBluetooth(fresh.device);
    await transport.reconnectAuthorized(fresh.device.id, options);
    await transport.write(endpoint, Uint8Array.of(3), "without-response");
    expect(
      fresh.characteristic.writeValueWithoutResponse,
    ).toHaveBeenLastCalledWith(Uint8Array.of(3));
    expect(await queued).toBeInstanceOf(Error);
    pending.resolve();
    expect(await firstOutcome).toBeInstanceOf(Error);
    expect(await queued).toBeInstanceOf(Error);
    expect(old.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(
      same ? 2 : 1,
    );
    expect(transport.state).toBe("connected");
  },
);
it("rolls back failed notification startup and retries with one listener", async () => {
  const mock = gattDevice();
  installBluetooth(mock.device);
  const transport = new WebBluetoothTransport(new TraceRecorder());
  await transport.selectAndConnect(options);
  for (let i = 0; i < 2; i++) {
    mock.characteristic.startNotifications.mockRejectedValueOnce(
      new Error("startup failed"),
    );
    await expect(
      transport.subscribe(endpoint, () => undefined),
    ).rejects.toThrow("startup failed");
    expect(mock.listeners.size).toBe(0);
  }
  const callback = vi.fn();
  await transport.subscribe(endpoint, callback);
  mock.emit();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(mock.listeners.size).toBe(1);
});

it("a late old write rejection does not quarantine the replacement", async () => {
  const old = gattDevice();
  const pending = deferred<void>();
  old.characteristic.writeValueWithoutResponse.mockImplementationOnce(
    () => pending.promise,
  );
  installBluetooth(old.device);
  const trace = new TraceRecorder();
  const transport = new WebBluetoothTransport(trace);
  await transport.selectAndConnect(options);
  const outcome = transport
    .write(endpoint, Uint8Array.of(1), "without-response")
    .catch((error) => error);
  await vi.waitFor(() =>
    expect(old.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(
      1,
    ),
  );
  old.device.dispatchEvent(new Event("gattserverdisconnected"));
  const fresh = gattDevice("new");
  installBluetooth(fresh.device);
  await transport.selectAndConnect(options);
  pending.reject(new Error("old radio rejection"));
  expect(await outcome).toHaveProperty("message", "old radio rejection");
  await transport.write(endpoint, Uint8Array.of(2), "without-response");
  expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(
    1,
  );
  expect(transport.state).toBe("connected");
  expect(
    trace.events.find((event) => event.type === "gatt.write.lateRejected")
      ?.metadata.message,
  ).toBe("old radio rejection");
});
it("retired endpoint resolution cannot call hardware or populate the new cache", async () => {
  const old = gattDevice();
  old.service.getCharacteristics.mockResolvedValue([]);
  const pending = deferred<typeof old.characteristic>();
  old.service.getCharacteristic.mockReturnValue(pending.promise);
  installBluetooth(old.device);
  const transport = new WebBluetoothTransport(new TraceRecorder());
  await transport.selectAndConnect(options);
  const outcome = transport
    .write(endpoint, Uint8Array.of(1), "without-response")
    .catch((error) => error);
  await vi.waitFor(() =>
    expect(old.service.getCharacteristic).toHaveBeenCalledTimes(1),
  );
  await transport.disconnect();
  const fresh = gattDevice("new");
  installBluetooth(fresh.device);
  await transport.selectAndConnect(options);
  pending.resolve(old.characteristic);
  expect(await outcome).toBeInstanceOf(Error);
  await transport.write(endpoint, Uint8Array.of(2), "without-response");
  expect(old.characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
  expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledWith(
    Uint8Array.of(2),
  );
});
it.each(["resolve", "reject"])(
  "stale connection setup %s leaves the replacement intact",
  async (settlement) => {
    const old = gattDevice();
    const pending = deferred<typeof old.server>();
    old.server.connect.mockReturnValueOnce(pending.promise);
    installBluetooth(old.device);
    const transport = new WebBluetoothTransport(new TraceRecorder());
    const outcome = transport.selectAndConnect(options).catch((error) => error);
    await vi.waitFor(() => expect(old.server.connect).toHaveBeenCalledTimes(1));
    await transport.disconnect();
    const fresh = gattDevice("new");
    installBluetooth(fresh.device);
    await transport.selectAndConnect(options);
    if (settlement === "resolve") {
      old.server.connected = true;
      pending.resolve(old.server);
    } else pending.reject(new Error("old setup"));
    expect(await outcome).toBeInstanceOf(Error);
    expect(transport.fingerprint?.browserDeviceId).toBe("new");
    expect(fresh.server.disconnect).not.toHaveBeenCalled();
    expect(old.server.connected).toBe(false);
  },
);
it.each(["resolve", "reject"])(
  "real transport recovers from an executor-indeterminate write and scopes late %s diagnostics",
  async (settlement) => {
    const { TransmissionExecutor } = await import("../../src/app/executor");
    const { prepareTransmission } = await import("../../src/core/transmission");
    const { fingerprintIdentityKey } =
      await import("../../src/investigation/device-identity");
    vi.useFakeTimers();
    try {
      const old = gattDevice();
      const pending = deferred<void>();
      old.characteristic.writeValueWithoutResponse.mockReturnValueOnce(
        pending.promise,
      );
      installBluetooth(old.device);
      const trace = new TraceRecorder();
      const transport = new WebBluetoothTransport(trace);
      await transport.selectAndConnect(options);
      const plan = prepareTransmission(
        {
          id: "old",
          driverId: "coolledux",
          profileId: "test",
          operation: { type: "SetBrightness", raw: 64 },
          risk: "transient",
          persistence: "none",
          validation: "verified",
          evidenceRefs: [],
          packets: [
            {
              index: 0,
              endpoint,
              bytes: Uint8Array.of(1),
              hex: "01",
              writeMode: "without-response",
            },
          ],
          responseExpectation: { type: "none" },
          execution: "live",
          purpose: "operation",
          timeoutMs: 5000,
          recoveryNotes: [],
          metadata: {},
        },
        {
          connectionId: transport.connectionId!,
          fingerprintKey: fingerprintIdentityKey(transport.fingerprint!),
          browserDeviceId: old.device.id,
        },
      );
      const outcome = new TransmissionExecutor(transport, trace)
        .execute({
          plan,
          digest: plan.digest,
          targetBinding: plan.targetBinding,
          policyDecision: "allow",
          authorizedAt: new Date().toISOString(),
        })
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await outcome).toHaveProperty("indeterminate", true);
      expect(transport.state).toBe("quarantined");
      await transport.disconnect();
      old.server.connected = true;
      await transport.reconnectAuthorized(old.device.id, options);
      await transport.write(endpoint, Uint8Array.of(2), "without-response");
      if (settlement === "resolve") pending.resolve();
      else pending.reject(new Error("old rejection"));
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.state).toBe("connected");
      expect(
        old.characteristic.writeValueWithoutResponse,
      ).toHaveBeenCalledTimes(2);
      expect(
        trace.events.filter(
          (event) =>
            event.type ===
            (settlement === "resolve"
              ? "tx.packet.lateHostAccepted"
              : "tx.packet.lateRejected"),
        ),
      ).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);
