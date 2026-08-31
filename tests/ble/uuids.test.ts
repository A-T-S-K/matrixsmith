import { describe, expect, it } from "vitest";
import { CCCD_UUID, IO_CHARACTERISTIC_UUID, SERVICE_UUID } from "../../src/ble/uuids";

describe("BLE UUIDs", () => {
  it("pins the confirmed iLedHat GATT identifiers", () => {
    expect(SERVICE_UUID).toBe("0000fff0-0000-1000-8000-00805f9b34fb");
    expect(IO_CHARACTERISTIC_UUID).toBe("0000fff1-0000-1000-8000-00805f9b34fb");
    expect(CCCD_UUID).toBe("00002902-0000-1000-8000-00805f9b34fb");
  });
});
