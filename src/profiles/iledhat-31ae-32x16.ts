import type { DeviceProfile } from "../core/device";

export const ILEDHAT_PROFILE_ID = "iledhat-31ae-32x16";
export const ILEDHAT_ADVERTISEMENT_HEX = "0201060303F0FF0EFFAE315EEA07000001100020031E0809694C6564486174";

export const iledHat31aeProfile: DeviceProfile = {
  id: ILEDHAT_PROFILE_ID,
  name: "iLedHat 31AE 32×16",
  driverId: "coolledux",
  width: 32,
  height: 16,
  validation: "verified",
  evidence: [
    { id: "iledhat-advertisement", summary: "Raw advertisement captured from the physical iLedHat on 2026-08-31.", confidence: "observed" },
    { id: "iledhat-gatt", summary: "FFF0/FFF1 READ/NOTIFY/WRITE WITHOUT RESPONSE shape observed with nRF Connect.", confidence: "observed" },
    { id: "iledhat-coolledx-rejected", summary: "Classic 0x08 returned 0x08 0xFE with no visible brightness change; exact 0xFE semantics remain unmapped.", confidence: "observed" },
    { id: "iledhat-coolledux-probe", summary: "CoolLEDUX 0x1F returned structured device info with power and brightness.", confidence: "observed" },
    { id: "iledhat-coolledux-brightness", summary: "0x04 changed brightness to 0x40, echoed, visibly dimmed, and was confirmed by 0x1F readback.", confidence: "corroborated" },
  ],
  metadata: {
    companyId: 0x31ae,
    deviceIdentifierBytes: "5E EA 07 00 00 01",
    height: 16,
    width: 32,
    colorModeRaw: 3,
    firmwareRaw: 30,
    bleAddressObservedByNrfConnect: "01:00:00:21:CC:99",
    identifierSemantics: "unknown; not treated as a MAC address",
    initialBrightnessRaw: 0xcc,
    verifiedBrightnessRaw: 0x40,
  },
};
