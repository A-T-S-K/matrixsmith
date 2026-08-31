import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { MatrixOperation } from "../core/operations";
import type { TransmissionPlan } from "../core/transmission";
import type { DiscoveryHints } from "../transport/types";

export type MatchConfidence = "none" | "weak" | "candidate" | "strong" | "exact";

export interface DriverMatch {
  readonly driverId: string;
  readonly score: number;
  readonly confidence: MatchConfidence;
  readonly reasons: readonly string[];
  readonly contradictions: readonly string[];
}

export interface DriverContext {
  readonly profile: DeviceProfile;
  readonly fingerprint: DeviceFingerprint;
  readonly source: "live" | "imported" | "fake" | "replay";
}

export interface DecodedNotification {
  readonly kind: string;
  readonly summary: string;
  readonly code?: number;
  readonly success?: boolean;
}

export interface MatrixDriver {
  readonly id: string;
  readonly family: string;
  discoveryHints(): DiscoveryHints;
  match(fingerprint: DeviceFingerprint): DriverMatch;
  profiles(): readonly DeviceProfile[];
  resolveProfile(fingerprint: DeviceFingerprint): DeviceProfile | null;
  capabilities(profile: DeviceProfile): readonly Capability[];
  plan(operation: MatrixOperation, context: DriverContext): TransmissionPlan;
  decodeNotification?(packet: Uint8Array, context: DriverContext): DecodedNotification | null;
}
