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
