import type { Capability } from "../../core/capabilities";
import type { DeviceFingerprint, DeviceProfile } from "../../core/device";
import type { MatrixOperation } from "../../core/operations";
import { createPlanId, packetHex, type TransmissionPlan } from "../../core/transmission";
import { ILEDHAT_PROFILE_ID, iledHat31aeProfile } from "../../profiles/iledhat-31ae-32x16";
import { COOLLED_ENDPOINT, COOLLED_SERVICE_UUID } from "../coolled/common/gatt";
import { notificationMatchesExpectation, type DriverContext, type MatrixDriver } from "../types";
import { matchCoolLedUx } from "./matcher";
import { decodeCoolLedUxNotification } from "./notifications";
import { COOLLEDUX_OPCODES, encodeBrightness, encodeDeviceInfoQuery, encodePower } from "./protocol";

export const coolLedUxDriver: MatrixDriver = {
  id: "coolledux", family: "CoolLEDUX",
  discoveryHints: () => ({ filters: [{ services: [COOLLED_SERVICE_UUID] }], optionalServices: [COOLLED_SERVICE_UUID] }),
  match: matchCoolLedUx, profiles: () => [iledHat31aeProfile], resolveProfile: resolveIledHatProfile,
  capabilities: coolLedUxCapabilities, endpoints: () => [COOLLED_ENDPOINT],
  probes: () => [{
    id: "get-device-info", label: "Identify CoolLEDUX with device info", risk: "read-only", persistence: "none", validation: "verified",
    plan: (context) => createCoolLedUxPlan({ type: "GetDeviceInfo" }, context, "probe"),
    interpret: (notification) => notification.family === "CoolLEDUX" && notification.kind === "device-info" && notification.opcode === COOLLEDUX_OPCODES.deviceInfo
      ? { matched: true, confidence: "exact", summary: "Valid structured 0x1F device-info response identifies CoolLEDUX for this session." } : null,
  }],
  plan: (operation, context) => createCoolLedUxPlan(operation, context),
  decodeNotification: decodeCoolLedUxNotification,
  responseMatches: notificationMatchesExpectation,
};

function resolveIledHatProfile(fingerprint: DeviceFingerprint): DeviceProfile | null {
  const geometry = fingerprint.manuallyConfirmedGeometry;
  const compatible = !geometry || (geometry.width === 32 && geometry.height === 16);
  // Browser sessions may expose name + granted GATT but no advertisement bytes.
  // That is enough to choose the physical profile for a safe probe, not enough to choose the protocol family.
  return fingerprint.name?.toLowerCase() === "iledhat" && compatible && matchCoolLedUx(fingerprint).score >= 50 ? iledHat31aeProfile : null;
}

export function coolLedUxCapabilities(profile: DeviceProfile): readonly Capability[] {
  const exact = profile.id === ILEDHAT_PROFILE_ID;
  return [
    { id: "device-info", label: "Device information", supported: true, live: exact, risk: "read-only", persistence: "none", evidenceConfidence: "observed", validation: exact ? "verified" : "experimental", evidenceRefs: ["iledhat-coolledux-probe", "coolledux-ble@4f5656d"] },
    { id: "brightness", label: "Brightness", supported: true, live: exact, risk: "transient", persistence: "unknown", evidenceConfidence: "corroborated", validation: exact ? "verified" : "experimental", evidenceRefs: ["iledhat-coolledux-brightness", "coolledux-ble@4f5656d"] },
    { id: "power", label: "Power", supported: true, live: false, risk: "transient", persistence: "unknown", evidenceConfidence: "corroborated", validation: "experimental", evidenceRefs: ["coolledux-ble@4f5656d"] },
  ];
}

export function createCoolLedUxPlan(operation: MatrixOperation, context: DriverContext, purpose: "operation" | "probe" = "operation"): TransmissionPlan {
  if (context.profile.driverId !== "coolledux") throw new Error("CoolLEDUX cannot plan for a profile owned by another driver.");
  let bytes: Uint8Array;
  let risk: TransmissionPlan["risk"] = "transient";
  let persistence: TransmissionPlan["persistence"] = "unknown";
  let validation: TransmissionPlan["validation"] = "unverified";
  let execution: TransmissionPlan["execution"] = "dry-run-only";
  let responseExpectation: TransmissionPlan["responseExpectation"] = { type: "none" };
  switch (operation.type) {
    case "GetDeviceInfo":
      bytes = encodeDeviceInfoQuery(); risk = "read-only"; persistence = "none"; validation = "verified"; execution = "live";
      responseExpectation = { type: "notification", kind: "device-info", opcode: COOLLEDUX_OPCODES.deviceInfo, required: true, timeoutMs: 1500, fulfillsOperation: true };
      break;
    case "SetBrightness":
      bytes = encodeBrightness(operation.raw); validation = "verified"; execution = "live";
      responseExpectation = { type: "notification", kind: "command-echo", opcode: COOLLEDUX_OPCODES.brightness, required: true, timeoutMs: 1500, fulfillsOperation: false };
      break;
    case "SetPower": bytes = encodePower(operation.on); validation = "experimental"; break;
    default: throw new Error(`${operation.type} is outside the CoolLEDUX direct-command scope of this branch.`);
  }
  const packet = { index: 0, endpoint: COOLLED_ENDPOINT, writeMode: "without-response" as const, bytes, hex: packetHex(bytes) };
  return Object.freeze({
    id: createPlanId(purpose === "probe" ? "coolledux-probe" : "coolledux"), driverId: "coolledux", profileId: context.profile.id, operation,
    risk, persistence, validation, execution, purpose, evidenceRefs: ["coolledux-ble@4f5656d", ...(context.profile.id === ILEDHAT_PROFILE_ID ? ["iledhat-nrf-2026-08-31"] : [])],
    packets: Object.freeze([packet]), ackPolicy: "none", responseExpectation,
    retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs: 5000,
    recoveryNotes: ["No automatic retry is enabled.", "Power and mirror remain dry-run-only on this exact hardware."],
    metadata: { family: "CoolLEDUX", dryRunOnly: execution === "dry-run-only" },
  });
}
