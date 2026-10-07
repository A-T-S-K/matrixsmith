import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { WebBluetoothTransport } from "../../src/transport/web-bluetooth";
import { TraceRecorder } from "../../src/diagnostics/trace";
import {
  deferred,
  endpoint,
  gattDevice,
  installBluetooth,
} from "../helpers/deferred-gatt";
afterEach(() => vi.unstubAllGlobals());
it("shares startup, reports active only on success, and retries failures", async () => {
  const mock = gattDevice();
  installBluetooth(mock.device);
  const runtime = new ApplicationRuntime(
    new WebBluetoothTransport(new TraceRecorder()),
  );
  await runtime.connect();
  const pending = deferred<typeof mock.characteristic>();
  mock.characteristic.startNotifications.mockReturnValueOnce(pending.promise);
  const first = runtime.enableNotifications(endpoint);
  const second = runtime.enableNotifications({
    ...endpoint,
    serviceUuid: endpoint.serviceUuid.toUpperCase(),
  });
  await vi.waitFor(() =>
    expect(mock.characteristic.startNotifications).toHaveBeenCalledTimes(1),
  );
  expect(runtime.isNotificationActive(endpoint)).toBe(false);
  const outcomes = Promise.allSettled([first, second]);
  pending.reject(new Error("startup failed"));
  expect((await outcomes).every((value) => value.status === "rejected")).toBe(
    true,
  );
  expect(mock.listeners.size).toBe(0);
  await runtime.enableNotifications(endpoint);
  expect(runtime.isNotificationActive(endpoint)).toBe(true);
  expect(mock.listeners.size).toBe(1);
  await runtime.disconnect();
  expect(runtime.isNotificationActive(endpoint)).toBe(false);
});
it.each([false, true])(
  "retires startup without waiting and old cleanup cannot stop new subscription (same: %s)",
  async (same) => {
    const old = gattDevice();
    installBluetooth(old.device);
    const transport = new WebBluetoothTransport(new TraceRecorder());
    const runtime = new ApplicationRuntime(transport);
    await runtime.connect();
    const pending = deferred<typeof old.characteristic>();
    old.characteristic.startNotifications.mockReturnValueOnce(pending.promise);
    const outcome = runtime
      .enableNotifications(endpoint)
      .catch((error) => error);
    await vi.waitFor(() => expect(old.listeners.size).toBe(1));
    await runtime.disconnect();
    expect(old.listeners.size).toBe(0);
    expect(runtime.isNotificationActive(endpoint)).toBe(false);
    const fresh = same ? old : gattDevice("replacement");
    fresh.server.connected = true;
    installBluetooth(fresh.device);
    await runtime.reconnectAuthorized(fresh.device.id);
    await runtime.enableNotifications(endpoint);
    pending.resolve(old.characteristic);
    expect(await outcome).toBeInstanceOf(Error);
    expect(runtime.isNotificationActive(endpoint)).toBe(true);
    expect(fresh.listeners.size).toBe(1);
    expect(old.characteristic.stopNotifications).not.toHaveBeenCalled();
    expect(fresh.characteristic.stopNotifications).not.toHaveBeenCalled();
  },
);
it("explicit disconnect is not blocked by stopNotifications", async () => {
  const mock = gattDevice();
  installBluetooth(mock.device);
  const runtime = new ApplicationRuntime(
    new WebBluetoothTransport(new TraceRecorder()),
  );
  await runtime.connect();
  await runtime.enableNotifications(endpoint);
  mock.characteristic.stopNotifications.mockReturnValueOnce(
    deferred<typeof mock.characteristic>().promise,
  );
  await runtime.disconnect();
  expect(runtime.isNotificationActive(endpoint)).toBe(false);
  expect(mock.listeners.size).toBe(0);
});
it("unexpected disconnect preserves desired endpoints and reconnect restores exactly one callback", async () => {
  const mock = gattDevice();
  installBluetooth(mock.device);
  const runtime = new ApplicationRuntime(
    new WebBluetoothTransport(new TraceRecorder()),
  );
  await runtime.connect();
  await runtime.enableNotifications(endpoint);
  mock.emit();
  expect(runtime.session.notifications).toHaveLength(1);
  mock.device.dispatchEvent(new Event("gattserverdisconnected"));
  expect(runtime.isNotificationActive(endpoint)).toBe(false);
  expect(mock.listeners.size).toBe(0);
  await runtime.reconnectAuthorized(mock.device.id);
  mock.emit();
  expect(runtime.isNotificationActive(endpoint)).toBe(true);
  expect(mock.listeners.size).toBe(1);
  expect(runtime.session.notifications).toHaveLength(1);
  await runtime.dispose();
});
