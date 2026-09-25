import type { DeviceFingerprint, DeviceProfile } from "../../core/device";
import type { DriverMatch } from "../../drivers/types";
import type { ClaimEvidence } from "../../investigation/claims";

export interface Geometry {
  readonly width: number;
  readonly height: number;
}

export interface DriverCandidate {
  readonly driverId: string;
  readonly score: number;
  readonly confidence: DriverMatch["confidence"];
  readonly reasons: readonly string[];
  readonly contradictions: readonly string[];
}

export type DeviceTarget =
  | {
      readonly kind: "unresolved";
      readonly fingerprint: DeviceFingerprint;
      readonly candidates: readonly DriverCandidate[];
    }
  | {
      readonly kind: "protocol-identified";
      readonly fingerprint: DeviceFingerprint;
      readonly driverId: string;
      readonly identificationEvidence: ClaimEvidence;
      readonly geometry: Geometry | null;
    }
  | {
      readonly kind: "provisional";
      readonly fingerprint: DeviceFingerprint;
      readonly driverId: string;
      readonly geometry: Geometry;
      readonly geometrySource:
        "device-info" | "advertisement" | "user-confirmed";
      /** Claims established by the successful family probe for this session. */
      readonly identificationEvidence: readonly ClaimEvidence[];
    }
  | {
      readonly kind: "profile-resolved";
      readonly fingerprint: DeviceFingerprint;
      readonly driverId: string;
      readonly profile: DeviceProfile;
    };

export function targetGeometry(target: DeviceTarget): Geometry | null {
  if (target.kind === "profile-resolved")
    return { width: target.profile.width, height: target.profile.height };
  if (target.kind === "unresolved")
    return target.fingerprint.manuallyConfirmedGeometry ?? null;
  return target.geometry;
}

export function targetDriverId(target: DeviceTarget): string | null {
  return target.kind === "unresolved" ? null : target.driverId;
}

export function targetCanPlanContent(
  target: DeviceTarget,
): target is Extract<
  DeviceTarget,
  { kind: "provisional" | "profile-resolved" }
> {
  return target.kind === "provisional" || target.kind === "profile-resolved";
}

export function unresolvedTarget(
  fingerprint: DeviceFingerprint,
  matches: readonly DriverMatch[],
): DeviceTarget {
  return {
    kind: "unresolved",
    fingerprint,
    candidates: matches.map(
      ({ driverId, score, confidence, reasons, contradictions }) => ({
        driverId,
        score,
        confidence,
        reasons: [...reasons],
        contradictions: [...contradictions],
      }),
    ),
  };
}
