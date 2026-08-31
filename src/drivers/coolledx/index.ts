import type { Capability } from "../../core/capabilities";
import type { DeviceFingerprint, DeviceProfile } from "../../core/device";
import type { MatrixOperation } from "../../core/operations";
import type { Persistence, RiskClass } from "../../core/risk";
import { createPlanId, packetHex, type TransmissionPlan } from "../../core/transmission";
import type { DriverContext, MatrixDriver } from "../types";
import { COOLLEDX_ENDPOINT, COOLLEDX_SERVICE_UUID } from "./gatt";
import { matchCoolLedX } from "./matcher";
import { decodeCoolLedNotification } from "./notifications";
import { packCoolLedPixels } from "./pixels";
import { COOLLEDX_OPCODES, encodeBrightness, encodeMode, encodeSpeed, encodeSwitch } from "./protocol";
import { createAnimationTransferPayload, createImageTransferPayload, encodeTransferPackets } from "./transfer";
import { ILEDHAT_PROFILE_ID, iledHat31aeProfile } from "./profiles/iledhat-31ae-32x16";

const modeBytes: Readonly<Record<string, number>> = {
  static: 0x01, left: 0x02, right: 0x03, up: 0x04, down: 0x05, snowflake: 0x06, picture: 0x07, laser: 0x08,
};

export const coolLedXDriver: MatrixDriver = {
  id: "coolledx",
  family: "CoolLEDX",
  discoveryHints: () => ({ filters: [{ services: [COOLLEDX_SERVICE_UUID] }], optionalServices: [COOLLEDX_SERVICE_UUID] }),
  match: matchCoolLedX,
  profiles: () => [iledHat31aeProfile],
  resolveProfile(fingerprint: DeviceFingerprint): DeviceProfile | null {
    const match = matchCoolLedX(fingerprint);
    const geometry = fingerprint.manuallyConfirmedGeometry;
    const compatibleGeometry = !geometry || (geometry.width === 32 && geometry.height === 16);
    return match.score >= 70 && compatibleGeometry && fingerprint.name?.toLowerCase() === "iledhat" ? iledHat31aeProfile : null;
  },
  capabilities: coolLedCapabilities,
  plan: planCoolLedOperation,
  decodeNotification: (packet) => decodeCoolLedNotification(packet),
};

export function coolLedCapabilities(profile: DeviceProfile): readonly Capability[] {
  const shared = { evidenceConfidence: "corroborated" as const, evidenceRefs: ["coolledx-primary-sources"] };
  return [
    { id: "brightness", label: "Brightness", supported: true, live: profile.id === ILEDHAT_PROFILE_ID, risk: "transient", persistence: "unknown", validation: "experimental", ...shared },
    { id: "scroll-speed", label: "Scroll speed", supported: true, live: false, risk: "transient", persistence: "unknown", validation: "unverified", ...shared },
    { id: "display-mode", label: "Display mode", supported: true, live: false, risk: "transient", persistence: "unknown", validation: "unverified", ...shared },
    { id: "power", label: "Display switch", supported: true, live: false, risk: "transient", persistence: "unknown", validation: "unverified", ...shared },
    { id: "static-frame", label: "Static frame", supported: true, live: false, risk: "persistent", persistence: "unknown", validation: "unverified", ...shared },
    { id: "animation", label: "Animation", supported: true, live: false, risk: "persistent", persistence: "unknown", validation: "unverified", ...shared },
    { id: "text", label: "Text banner", supported: true, live: false, risk: "persistent", persistence: "unknown", validation: "unverified", ...shared },
  ];
}

export function planCoolLedOperation(operation: MatrixOperation, context: DriverContext): TransmissionPlan {
  if (context.profile.driverId !== "coolledx") throw new Error("CoolLEDX cannot plan for a profile owned by another driver.");
  let bytes: readonly Uint8Array[];
  let risk: RiskClass = "transient";
  let persistence: Persistence = "unknown";
  let validation: TransmissionPlan["validation"] = "unverified";

  switch (operation.type) {
    case "SetBrightness":
      bytes = [encodeBrightness(operation.raw)];
      validation = context.profile.id === ILEDHAT_PROFILE_ID ? "experimental" : "unverified";
      break;
    case "SetScrollSpeed": bytes = [encodeSpeed(operation.raw)]; break;
    case "SetDisplayMode": bytes = [encodeMode(modeBytes[operation.mode] ?? 0x01)]; break;
    case "SetPower": bytes = [encodeSwitch(operation.on)]; break;
    case "ShowFrame":
      bytes = encodeTransferPackets(COOLLEDX_OPCODES.image, createImageTransferPayload(packCoolLedPixels(operation.frame)));
      risk = "persistent";
      break;
    case "ShowAnimation": {
      const packed = operation.sequence.frames.map(packCoolLedPixels);
      const size = packed.reduce((total, frame) => total + frame.length, 0);
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const frame of packed) { joined.set(frame, offset); offset += frame.length; }
      const speed = operation.sequence.timing[0]?.milliseconds ?? 500;
      bytes = encodeTransferPackets(COOLLEDX_OPCODES.animation, createAnimationTransferPayload(joined, packed.length, speed));
      risk = "persistent";
      break;
    }
    case "ShowText":
      if (!operation.frame) throw new Error("ShowText needs a separately rendered logical banner before CoolLEDX planning.");
      bytes = encodeTransferPackets(COOLLEDX_OPCODES.text, createTextPayload(operation.text, packCoolLedPixels(operation.frame)));
      risk = "persistent";
      break;
  }

  const packets = bytes.map((packetBytes, index) => ({ index, endpoint: COOLLEDX_ENDPOINT, writeMode: "without-response" as const, bytes: packetBytes, hex: packetHex(packetBytes) }));
  return Object.freeze({
    id: createPlanId("coolledx"), driverId: "coolledx", profileId: context.profile.id, operation,
    risk, persistence, validation, evidenceRefs: ["coolled1248-rs@55d0082", "coolledx-driver@ba24137"],
    packets: Object.freeze(packets), ackPolicy: packets.length > 1 ? "per-packet" : "none",
    retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs: 5000,
    recoveryNotes: ["No automatic retry is enabled.", "Disconnect power if the device behaves unexpectedly."],
    metadata: { family: "CoolLEDX", dryRunOnly: operation.type !== "SetBrightness" },
  });
}

function createTextPayload(text: string, pixels: Uint8Array): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const metadataLength = encoded.length > 0xff ? 81 : 81;
  const payload = new Uint8Array(24 + metadataLength + 2 + pixels.length);
  payload[24] = Math.min(encoded.length, 0xff);
  payload.fill(0x30, 25, 25 + Math.min(encoded.length, 80));
  const lengthOffset = 24 + metadataLength;
  payload[lengthOffset] = pixels.length >>> 8;
  payload[lengthOffset + 1] = pixels.length & 0xff;
  payload.set(pixels, lengthOffset + 2);
  return payload;
}
