import { afterEach, describe, expect, it } from "vitest";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { WebBluetoothTransport } from "../../src/transport/web-bluetooth";
import { DriverRegistry, builtInDrivers } from "../../src/drivers/registry";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
afterEach(() => {
  if (originalNavigator)
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

const HINTS = {
  filters: [{ services: ["0000fff0-0000-1000-8000-00805f9b34fb"] }],
  optionalServices: ["0000fff0-0000-1000-8000-00805f9b34fb"],
  optionalManufacturerData: [0x31ae],
};

function makeDevice(extra: Record<string, unknown> = {}): BluetoothDevice {
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
  const device = Object.assign(
    new EventTarget(),
    { id: "browser-id", name: "iLedHat" },
    extra,
  ) as unknown as BluetoothDevice;
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
  return device;
}

describe("discovery hints", () => {
  it("merges optionalManufacturerData from drivers without narrowing filters", () => {
    const hints = new DriverRegistry(builtInDrivers).discoveryHints();
    expect(hints.optionalManufacturerData).toContain(0x31ae);
    expect(hints.filters.length).toBeGreaterThan(0);
  });
});

describe("advertisement enrichment", () => {
  it("captures a structured observation without fabricating raw bytes", async () => {
    const device = makeDevice({
      watchAdvertisements: async () => {
        queueMicrotask(() => {
          const event = Object.assign(new Event("advertisementreceived"), {
            uuids: ["0000fff0-0000-1000-8000-00805f9b34fb"],
            rssi: -52,
            txPower: 4,
            name: "iLedHat",
            manufacturerData: new Map([
              [0x31ae, new DataView(Uint8Array.of(0x5e, 0xea, 0x07).buffer)],
            ]),
            serviceData: new Map(),
          });
          device.dispatchEvent(event);
        });
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { bluetooth: { requestDevice: async () => device } },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    await transport.selectAndConnect({ mode: "registered", hints: HINTS });
    const observation = await transport.observeAdvertisements(500);
    expect(observation).not.toBeNull();
    expect(observation!.source).toBe("web-bluetooth-watch");
    expect(observation!.rssi).toBe(-52);
    expect(observation!.manufacturerData).toEqual([
      { companyId: 0x31ae, dataHex: "5E EA 07" },
    ]);
    // The fingerprint gains the structured observation but never a fabricated raw stream.
    expect(transport.fingerprint?.advertisementObservation?.rssi).toBe(-52);
    expect(transport.fingerprint?.rawAdvertisementHex).toBeUndefined();
  });

  it("returns null when watchAdvertisements is unsupported and never blocks the connection", async () => {
    const device = makeDevice();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { bluetooth: { requestDevice: async () => device } },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    const fingerprint = await transport.selectAndConnect({
      mode: "registered",
      hints: HINTS,
    });
    expect(fingerprint.services).toHaveLength(1);
    await expect(transport.observeAdvertisements(100)).resolves.toBeNull();
    expect(transport.state).toBe("connected");
  });

  it("returns null on a watch timeout instead of failing", async () => {
    const device = makeDevice({ watchAdvertisements: async () => undefined });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { bluetooth: { requestDevice: async () => device } },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    await transport.selectAndConnect({ mode: "registered", hints: HINTS });
    await expect(transport.observeAdvertisements(50)).resolves.toBeNull();
  });
});

describe("previously authorized reconnect", () => {
  it("reconnects by device id without opening a chooser", async () => {
    const device = makeDevice();
    let chooserOpened = false;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        bluetooth: {
          requestDevice: async () => {
            chooserOpened = true;
            return device;
          },
          getDevices: async () => [device],
        },
      },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    const fingerprint = await transport.reconnectAuthorized("browser-id", {
      mode: "registered",
      hints: HINTS,
    });
    expect(fingerprint.name).toBe("iLedHat");
    expect(chooserOpened).toBe(false);
    expect(transport.state).toBe("connected");
  });

  it("throws a clear error when the device is no longer authorized (caller falls back to the chooser)", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        bluetooth: {
          requestDevice: async () => makeDevice(),
          getDevices: async () => [],
        },
      },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    await expect(
      transport.reconnectAuthorized("browser-id", {
        mode: "registered",
        hints: HINTS,
      }),
    ).rejects.toThrow(/chooser/i);
  });

  it("throws when getDevices is unsupported", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { bluetooth: { requestDevice: async () => makeDevice() } },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    await expect(
      transport.reconnectAuthorized("browser-id", {
        mode: "registered",
        hints: HINTS,
      }),
    ).rejects.toThrow(/does not support/i);
  });
});

describe("unexpected disconnect lifecycle", () => {
  it("invalidates the connection generation and permits a clean reconnect", async () => {
    const device = makeDevice();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { bluetooth: { requestDevice: async () => device } },
    });
    const transport = new WebBluetoothTransport(new TraceRecorder());
    await transport.selectAndConnect({ mode: "registered", hints: HINTS });
    const firstConnectionId = transport.connectionId;
    device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(transport.state).toBe("idle");
    expect(transport.connectionId).toBeNull();
    expect(transport.fingerprint).toBeNull();
    await transport.selectAndConnect({ mode: "registered", hints: HINTS });
    expect(transport.connectionId).not.toBe(firstConnectionId);
  });
});
