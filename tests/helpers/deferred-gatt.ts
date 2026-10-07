import { vi } from "vitest";
import { COOLLEDX_ENDPOINT as endpoint } from "../../src/drivers/coolledx/gatt";
export { endpoint };
export const options = {
  mode: "registered",
  hints: { filters: [], optionalServices: [] },
} as const;
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function gattDevice(id = "device") {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const device = Object.assign(new EventTarget(), { id, name: "iLedHat" });
  const characteristic = Object.assign(new EventTarget(), {
    uuid: endpoint.characteristicUuid,
    properties: {
      read: true,
      notify: true,
      indicate: false,
      write: true,
      writeWithoutResponse: true,
    },
    value: new DataView(new Uint8Array([1]).buffer),
    addEventListener: vi.fn(
      (type: string, callback: EventListenerOrEventListenerObject) => {
        if (type === "characteristicvaluechanged") listeners.add(callback);
      },
    ),
    removeEventListener: vi.fn(
      (type: string, callback: EventListenerOrEventListenerObject) => {
        if (type === "characteristicvaluechanged") listeners.delete(callback);
      },
    ),
    writeValueWithoutResponse: vi.fn(
      async (_bytes: BufferSource): Promise<void> => undefined,
    ),
    writeValueWithResponse: vi.fn(
      async (_bytes: BufferSource): Promise<void> => undefined,
    ),
    startNotifications: vi.fn(async () => characteristic),
    stopNotifications: vi.fn(async () => characteristic),
  });
  const service = {
    uuid: endpoint.serviceUuid,
    isPrimary: true,
    device,
    getCharacteristics: vi.fn(async () => [characteristic]),
    getCharacteristic: vi.fn(async () => characteristic),
  };
  const server = {
    connected: true,
    connect: vi.fn(async () => server),
    disconnect: vi.fn(() => {
      server.connected = false;
    }),
    getPrimaryServices: vi.fn(async () => [service]),
    getPrimaryService: vi.fn(async () => service),
  };
  Object.assign(device, { gatt: server });
  Object.assign(characteristic, { service });
  return {
    device: device as unknown as BluetoothDevice,
    characteristic,
    service,
    server,
    listeners,
    emit: () => {
      for (const listener of listeners)
        if (typeof listener === "function")
          listener({ target: characteristic } as unknown as Event);
    },
  };
}
export function installBluetooth(device: BluetoothDevice) {
  vi.stubGlobal("navigator", {
    bluetooth: {
      requestDevice: async () => device,
      getDevices: async () => [device],
    },
  });
}
