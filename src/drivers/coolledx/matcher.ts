import type { DeviceFingerprint } from "../../core/device";
import { normalizeUuid } from "../../core/device";
import type { DriverMatch, MatchConfidence } from "../types";
import { COOLLEDX_IO_UUID, COOLLEDX_SERVICE_UUID } from "./gatt";

export function matchCoolLedX(fingerprint: DeviceFingerprint): DriverMatch {
  let score = 0;
  const reasons: string[] = [];
  const contradictions: string[] = [];
  const advertised = fingerprint.advertisedServices.map(normalizeUuid);
  const service = fingerprint.services.find(({ uuid }) => normalizeUuid(uuid) === COOLLEDX_SERVICE_UUID);
  const characteristic = service?.characteristics.find(({ uuid }) => normalizeUuid(uuid) === COOLLEDX_IO_UUID);

  if (fingerprint.name?.toLowerCase() === "iledhat") { score += 15; reasons.push("exact observed iLedHat name"); }
  else if (fingerprint.name?.toLowerCase().includes("coolled")) { score += 5; reasons.push("CoolLED-like name is a weak clue"); }
  if (advertised.includes(COOLLEDX_SERVICE_UUID)) { score += 10; reasons.push("advertises FFF0"); }
  if (fingerprint.manufacturerDataHex?.toUpperCase().startsWith("AE31")) { score += 25; reasons.push("manufacturer bytes begin AE31"); }
  if (service) { score += 15; reasons.push("primary fingerprint includes FFF0"); }
  if (characteristic) {
    score += 15;
    reasons.push("FFF0 exposes FFF1");
    const properties = characteristic.properties;
    if (properties.read && properties.notify && properties.writeWithoutResponse) {
      score += 25;
      reasons.push("FFF1 has the observed READ/NOTIFY/WRITE WITHOUT RESPONSE shape");
    } else {
      score -= 25;
      contradictions.push("FFF1 properties do not match the observed iLedHat shape");
    }
    if (properties.write && !properties.writeWithoutResponse) {
      score -= 10;
      contradictions.push("FFF1 uses write-with-response instead of the observed write-without-response path");
    }
  }
  if (service && service.characteristics.length !== 1) {
    score -= 10;
    contradictions.push("FFF0 characteristic count differs from the single-characteristic iLedHat observation");
  }

  score = Math.max(0, Math.min(100, score));
  return { driverId: "coolledx", score, confidence: confidenceFor(score, contradictions.length), reasons, contradictions };
}

function confidenceFor(score: number, contradictions: number): MatchConfidence {
  if (score >= 90 && contradictions === 0) return "exact";
  if (score >= 70 && contradictions === 0) return "strong";
  if (score >= 40) return "candidate";
  if (score > 0) return "weak";
  return "none";
}
