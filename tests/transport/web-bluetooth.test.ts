import { afterEach, describe, expect, it } from "vitest";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { WebBluetoothTransport } from "../../src/transport/web-bluetooth";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
afterEach(() => {
  if (originalNavigator)
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

describe("WebBluetoothTransport evidence integrity", () => {
  it("keeps request filters separate from observed advertisement services", async () => {
    const characteristic = {
      uuid: "0000fff1-0000-1000-8000-00805f9b34fb",
      properties: {
        read: true,
        notify: true,
        indicate: false,
        write: false,
        writeWithoutResponse: true,
      },
    } as unknown as BluetoothRemoteGATTCharacteristic;
    const device = Object.assign(new EventTarget(), {
      id: "browser-id",
      name: "iLedHat",
    }) as BluetoothDevice;
    const service = {
      uuid: "0000fff0-0000-1000-8000-00805f9b34fb",
      isPrimary: true,
      device,
      getCharacteristics: async () => [characteristic],
    } as unknown as BluetoothRemoteGATTService;
    const server = {
      connected: true,
      getPrimaryServices: async () => [service],
    } as unknown as BluetoothRemoteGATTServer;
    Object.defineProperty(device, "gatt", {
      value: {
        connect: async () => server,
        disconnect: () => undefined,
        connected: true,
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { bluetooth: { requestDevice: async () => device } },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    const fingerprint = await transport.selectAndConnect({
      mode: "registered",
      hints: {
        filters: [{ services: ["0000fff0-0000-1000-8000-00805f9b34fb"] }],
        optionalServices: ["0000fff0-0000-1000-8000-00805f9b34fb"],
      },
    });
    expect(fingerprint.advertisedServices).toEqual([]);
    expect(fingerprint.requestedServices).toEqual([
      "0000fff0-0000-1000-8000-00805f9b34fb",
    ]);
    expect(fingerprint.browserGrantedServices).toEqual([
      "0000fff0-0000-1000-8000-00805f9b34fb",
    ]);
    expect(fingerprint.services).toHaveLength(1);
  });
});
it("retains a late browser read in its original connection context after disconnect", async () => {
  let resolveRead!: (value: DataView) => void;
  const endpoint = {
    serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
  };
  const characteristic = {
    uuid: endpoint.characteristicUuid,
    properties: { read: true },
    readValue: () =>
      new Promise<DataView>((resolve) => {
        resolveRead = resolve;
      }),
  } as unknown as BluetoothRemoteGATTCharacteristic;
  const device = Object.assign(new EventTarget(), {
    id: "scripted",
    name: "scripted",
  }) as BluetoothDevice;
  const service = {
    uuid: endpoint.serviceUuid,
    isPrimary: true,
    device,
    getCharacteristics: async () => [characteristic],
  };
  Object.defineProperty(device, "gatt", {
    value: {
      connected: true,
      connect: async () => ({
        connected: true,
        getPrimaryServices: async () => [service],
      }),
      disconnect: () => {},
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { bluetooth: { requestDevice: async () => device } },
  });
  const trace = new TraceRecorder();
  const transport = new WebBluetoothTransport(trace);
  await transport.selectAndConnect({
    mode: "inspection",
    hints: { filters: [], optionalServices: [endpoint.serviceUuid] },
  });
  const originalConnection = transport.connectionId;
  const pending = transport.read(endpoint);
  await Promise.resolve();
  await Promise.resolve();
  await transport.disconnect();
  resolveRead(new DataView(new Uint8Array([16, 1, 8, 4, 18]).buffer));
  expect(await pending).toEqual(new Uint8Array([16, 1, 8, 4, 18]));
  expect(trace.events.at(-1)).toMatchObject({
    type: "gatt.read",
    metadata: { connectionId: originalConnection, retired: true },
    rawBytes: new Uint8Array([16, 1, 8, 4, 18]),
  });
});
