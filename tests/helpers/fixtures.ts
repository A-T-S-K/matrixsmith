import type { DeviceFingerprint } from "../../src/core/device";
import { ILEDHAT_ADVERTISEMENT_HEX } from "../../src/drivers/coolledx/profiles/iledhat-31ae-32x16";

export function knownIledHatFingerprint(): DeviceFingerprint {
  return {
    schemaVersion: 1,
    transportKind: "web-bluetooth",
    browserDeviceId: "fixture-device",
    name: "iLedHat",
    advertisedServices: ["0000fff0-0000-1000-8000-00805f9b34fb"],
    rawAdvertisementHex: ILEDHAT_ADVERTISEMENT_HEX,
    manufacturerDataHex: "AE315EEA07000001100020031E",
    services: [{
      uuid: "0000fff0-0000-1000-8000-00805f9b34fb",
      isPrimary: true,
      characteristics: [{
        uuid: "0000fff1-0000-1000-8000-00805f9b34fb",
        properties: { read: true, notify: true, indicate: false, write: false, writeWithoutResponse: true },
      }],
    }],
    manuallyConfirmedGeometry: { width: 32, height: 16 },
    evidenceRefs: ["iledhat-advertisement", "iledhat-gatt", "manual-geometry"],
    notes: ["Read returned zero bytes.", "Notifications enabled.", "No pairing required."],
  };
}
