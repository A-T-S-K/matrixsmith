import type { DeviceProfile } from "../../../core/device";

export const ILEDHAT_PROFILE_ID = "iledhat-31ae-32x16";
export const ILEDHAT_ADVERTISEMENT_HEX = "0201060303F0FF0EFFAE315EEA07000001100020031E0809694C6564486174";

export const iledHat31aeProfile: DeviceProfile = {
  id: ILEDHAT_PROFILE_ID,
  name: "iLedHat 31AE 32×16",
  driverId: "coolledx",
  width: 32,
  height: 16,
  validation: "experimental",
  evidence: [
    { id: "iledhat-advertisement", summary: "Raw advertisement captured from the physical iLedHat.", confidence: "observed" },
    { id: "iledhat-gatt", summary: "FFF0/FFF1 GATT shape and properties observed with nRF Connect.", confidence: "observed" },
    { id: "coolledx-family", summary: "CoolLEDX framing and 16×32 precedent corroborated by pinned licensed sources.", confidence: "corroborated" },
    { id: "iledhat-reset", summary: "A long-ish power-button action displayed reset and restored scrolling text coolled; timing and reset class remain unknown.", confidence: "observed" },
  ],
  metadata: {
    bootIdentifier: "31AE",
    advertisedService: "FFF0",
    manufacturerDataHex: "AE315EEA07000001100020031E",
    originalMessage: "FREE LLM TOKENS :-)",
    resetDefaultText: "coolled",
    readResult: "zero bytes",
    pairingRequired: false,
    orientation: "unverified",
    transferSizeLimit: "unknown",
    geometryCorrelation: "0x10 and 0x20 correlate with 16×32 but are not parsed as dimensions",
    batteryNote: "0x1E remained unchanged near full charge and is not treated as battery state of charge",
  },
};
