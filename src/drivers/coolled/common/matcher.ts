import type { DeviceFingerprint } from "../../../core/device";
import { normalizeUuid } from "../../../core/device";
import type { DriverMatch, MatchConfidence } from "../../types";
import { COOLLED_IO_UUID, COOLLED_SERVICE_UUID } from "./gatt";

export function matchCoolLedGatt(fingerprint: DeviceFingerprint, driverId: string): DriverMatch {
  let score = 0;
  const reasons: string[] = [];
  const contradictions: string[] = [];
  const advertised = fingerprint.advertisedServices.map(normalizeUuid);
  const service = fingerprint.services.find(({ uuid }) => normalizeUuid(uuid) === COOLLED_SERVICE_UUID);
  const characteristic = service?.characteristics.find(({ uuid }) => normalizeUuid(uuid) === COOLLED_IO_UUID);
  if (fingerprint.name?.toLowerCase() === "iledhat") { score += 15; reasons.push("exact observed iLedHat name (profile evidence, not protocol-family proof)"); }
  else if (fingerprint.name?.toLowerCase().includes("coolled")) { score += 5; reasons.push("CoolLED-like name is a weak clue"); }
  if (advertised.includes(COOLLED_SERVICE_UUID)) { score += 10; reasons.push("observed advertisement includes FFF0"); }
  if (fingerprint.manufacturerDataHex?.toUpperCase().startsWith("AE31")) { score += 25; reasons.push("observed manufacturer company field is 0x31AE"); }
  if (service) { score += 15; reasons.push("accessible GATT includes FFF0"); }
  if (characteristic) {
    score += 15; reasons.push("FFF0 exposes FFF1");
    if (characteristic.properties.read && characteristic.properties.notify && characteristic.properties.writeWithoutResponse) {
      score += 25; reasons.push("FFF1 has READ/NOTIFY/WRITE WITHOUT RESPONSE");
    } else { score -= 25; contradictions.push("FFF1 properties differ from the physical iLedHat shape"); }
  }
  score = Math.max(0, Math.min(100, score));
  return { driverId, score, confidence: confidenceFor(score, contradictions.length), reasons, contradictions };
}

function confidenceFor(score: number, contradictions: number): MatchConfidence {
  if (score >= 90 && contradictions === 0) return "exact";
  if (score >= 70 && contradictions === 0) return "strong";
  if (score >= 40) return "candidate";
  if (score > 0) return "weak";
  return "none";
}
