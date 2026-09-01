import { normalizeUuid, type DeviceFingerprint } from "../core/device";
import { COOLLED_IO_UUID, COOLLED_SERVICE_UUID } from "../drivers/coolled/common/gatt";
import { ILEDHAT_PROFILE_ID } from "./iledhat-31ae-32x16";

/**
 * Recognizing a display MatrixSmith has already characterized.
 *
 * CoolLEDX and CoolLEDUX share the FFF0/FFF1 transport, so the shape alone
 * cannot decide the protocol family — which is why an active 0x1F probe was
 * the discriminator. That is the right default for an unknown display and the
 * wrong one for a display whose physical behavior is already in the profile:
 * a user should not have to re-derive facts we measured.
 *
 * The rule this file implements is narrow on purpose. A known profile is only
 * recognized from the strongest evidence the browser actually exposes, and any
 * EXPLICIT contradiction — a different geometry, a different manufacturer, the
 * wrong characteristic properties — withdraws recognition entirely rather than
 * being outvoted. Absent evidence is not contradiction: Web Bluetooth often
 * surfaces no manufacturer data at all, and refusing to recognize a display on
 * that basis would make the whole mechanism useless in the browser it targets.
 *
 * Nothing here weakens unknown-device handling. A display that does not match
 * a signature gets exactly the conservative treatment it got before.
 */

export interface KnownProfileSignature {
  readonly profileId: string;
  /** Exact observed device name, compared case-insensitively. */
  readonly name: string;
  readonly serviceUuid: string;
  readonly characteristicUuid: string;
  /** Manufacturer company identifier, as observed in the advertisement. */
  readonly companyId: number;
  readonly width: number;
  readonly height: number;
  /** Driver this profile's own physical evidence assigns. */
  readonly driverId: string;
  /** Drivers this profile's evidence physically ruled out, with the reason. */
  readonly rejectedDrivers: Readonly<Record<string, string>>;
}

export interface KnownProfileVerdict {
  readonly signature: KnownProfileSignature;
  /**
   * True only when every piece of evidence the browser exposed is consistent
   * with the signature and the identifying core (name plus exact GATT shape)
   * is present.
   */
  readonly matched: boolean;
  readonly reasons: readonly string[];
  /** Explicit disagreements. Any of these withdraws recognition. */
  readonly contradictions: readonly string[];
}

/** Little-endian company id as it appears at the head of manufacturer data. */
function companyPrefix(companyId: number): string {
  return `${(companyId & 0xff).toString(16).padStart(2, "0")}${((companyId >> 8) & 0xff).toString(16).padStart(2, "0")}`.toUpperCase();
}

/**
 * The physically characterized 32×16 iLedHat.
 *
 * The classic CoolLEDX assignment is not merely unlikely here, it was tested:
 * opcode 0x08 returned 0x08 0xFE with no visible brightness change, while the
 * CoolLEDUX 0x1F query returned structured device info. That is a profile
 * fact, so it travels with the profile rather than living as a special case
 * inside a matcher.
 */
export const ILEDHAT_SIGNATURE: KnownProfileSignature = Object.freeze({
  profileId: ILEDHAT_PROFILE_ID,
  name: "iledhat",
  serviceUuid: COOLLED_SERVICE_UUID,
  characteristicUuid: COOLLED_IO_UUID,
  companyId: 0x31ae,
  width: 32,
  height: 16,
  driverId: "coolledux",
  rejectedDrivers: Object.freeze({
    coolledx: "Classic CoolLEDX brightness semantics were physically rejected on this exact profile: 0x08 returned 0x08 0xFE with no visible change, while the CoolLEDUX 0x1F query answered with structured device info.",
  }),
});

export const KNOWN_PROFILE_SIGNATURES: readonly KnownProfileSignature[] = Object.freeze([ILEDHAT_SIGNATURE]);

export function evaluateKnownProfile(signature: KnownProfileSignature, fingerprint: DeviceFingerprint): KnownProfileVerdict {
  const reasons: string[] = [];
  const contradictions: string[] = [];

  // The name is the entry condition. Without it this is simply a different
  // display that happens to share a transport, and nothing below applies.
  if (fingerprint.name?.trim().toLowerCase() !== signature.name) {
    return { signature, matched: false, reasons: [], contradictions: [] };
  }
  reasons.push(`exact observed device name "${fingerprint.name}"`);

  const service = fingerprint.services.find(({ uuid }) => normalizeUuid(uuid) === signature.serviceUuid);
  const characteristic = service?.characteristics.find(({ uuid }) => normalizeUuid(uuid) === signature.characteristicUuid);
  if (!service || !characteristic) {
    // Not a contradiction: the browser may not have granted the service yet.
    // It is simply not enough to recognize the profile.
    return { signature, matched: false, reasons, contradictions };
  }
  const { read, notify, writeWithoutResponse } = characteristic.properties;
  if (!read || !notify || !writeWithoutResponse) {
    contradictions.push("the FFF1 characteristic does not expose READ + NOTIFY + WRITE WITHOUT RESPONSE as the characterized profile does");
  } else {
    reasons.push("exact FFF0/FFF1 GATT shape with READ + NOTIFY + WRITE WITHOUT RESPONSE");
  }

  // Manufacturer data and geometry are corroborating when present and
  // disqualifying when they disagree. Absence proves nothing either way.
  const manufacturer = fingerprint.manufacturerDataHex?.toUpperCase();
  if (manufacturer) {
    if (manufacturer.startsWith(companyPrefix(signature.companyId))) {
      reasons.push(`observed manufacturer company field 0x${signature.companyId.toString(16).toUpperCase()}`);
    } else {
      contradictions.push(`the observed manufacturer company field contradicts 0x${signature.companyId.toString(16).toUpperCase()}`);
    }
  }
  const geometry = fingerprint.manuallyConfirmedGeometry;
  if (geometry) {
    if (geometry.width === signature.width && geometry.height === signature.height) {
      reasons.push(`confirmed ${signature.width}×${signature.height} geometry`);
    } else {
      contradictions.push(`the confirmed ${geometry.width}×${geometry.height} geometry contradicts the characterized ${signature.width}×${signature.height} profile`);
    }
  }
  return { signature, matched: contradictions.length === 0, reasons, contradictions };
}

/** The known profile this fingerprint identifies, if any. */
export function identifyKnownProfile(fingerprint: DeviceFingerprint | null | undefined): KnownProfileVerdict | null {
  if (!fingerprint) return null;
  for (const signature of KNOWN_PROFILE_SIGNATURES) {
    const verdict = evaluateKnownProfile(signature, fingerprint);
    if (verdict.matched || verdict.contradictions.length > 0) return verdict;
  }
  return null;
}

/** Whether a fingerprint is the recognized, physically characterized profile. */
export function matchesKnownProfile(signature: KnownProfileSignature, fingerprint: DeviceFingerprint | null | undefined): boolean {
  return Boolean(fingerprint) && evaluateKnownProfile(signature, fingerprint!).matched;
}
