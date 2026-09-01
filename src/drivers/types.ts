import type { Capability } from "../core/capabilities";
import type { DeviceFingerprint, DeviceProfile, GattEndpoint } from "../core/device";
import type { Persistence, RiskClass } from "../core/risk";
import type { MatrixOperation } from "../core/operations";
import type { ResponseExpectation, TransmissionPlan } from "../core/transmission";
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
  /**
   * The session's validated static-raster delivery strategy, when one has
   * been physically established. Drivers route ShowFrame/ShowText through it
   * instead of hardcoding one content opcode.
   */
  readonly rasterStrategy?: import("../core/raster-strategy").RasterStrategy;
  /**
   * Behavior established by trusted current-session physical evidence (see
   * investigation/session-behavior.ts). Consulted beside the immutable
   * profile quirks during content compilation.
   */
  readonly resolvedBehavior?: import("../investigation/session-behavior").SessionResolvedBehavior;
}

export interface DriverNotificationContext {
  readonly profile: DeviceProfile | null;
  readonly fingerprint: DeviceFingerprint;
  readonly source: DriverContext["source"];
}

export interface DecodedNotification {
  readonly family: string;
  readonly kind: string;
  readonly opcode?: number;
  readonly summary: string;
  readonly payloadHex: string;
  readonly code?: number;
  readonly success?: boolean;
  readonly status?: number;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  readonly unknownTailHex?: string;
  readonly envelopeError?: string;
}

export interface DriverProbe {
  readonly id: string;
  readonly label: string;
  readonly risk: Extract<RiskClass, "read-only">;
  readonly persistence: Extract<Persistence, "none">;
  readonly validation: "verified" | "experimental";
  plan(context: DriverContext): TransmissionPlan;
  interpret(notification: DecodedNotification): { readonly matched: boolean; readonly confidence: "strong" | "exact"; readonly summary: string } | null;
}

export interface MatrixDriver {
  readonly id: string;
  readonly family: string;
  discoveryHints(): DiscoveryHints;
  match(fingerprint: DeviceFingerprint): DriverMatch;
  profiles(): readonly DeviceProfile[];
  resolveProfile(fingerprint: DeviceFingerprint): DeviceProfile | null;
  capabilities(profile: DeviceProfile): readonly Capability[];
  endpoints(profile: DeviceProfile): readonly GattEndpoint[];
  probes?(context: DriverContext): readonly DriverProbe[];
  /** Driver-contributed guided hardware tests (ABOUT → RUN → OBSERVE → RESULT workflows). */
  guidedTests?(profile: DeviceProfile): readonly import("../investigation/tests").GuidedTestDefinition[];
  /**
   * Human-facing regions of a diagnostic operation, so questions that name a
   * region can be labelled for people — in the UI and in reports — without
   * either layer knowing anything driver-specific.
   */
  diagnosticRegions?(operation: MatrixOperation, profile: DeviceProfile): readonly import("../investigation/regions").DiagnosticRegion[];
  /** Baseline atomic-claim evidence this driver ships for a profile. */
  claimEvidence?(profile: DeviceProfile): readonly import("../investigation/claims").ClaimEvidence[];
  plan(operation: MatrixOperation, context: DriverContext): TransmissionPlan;
  decodeNotification?(packet: Uint8Array, context: DriverNotificationContext): DecodedNotification | null;
  responseMatches?(notification: DecodedNotification, expectation: ResponseExpectation): boolean;
}

export function notificationMatchesExpectation(notification: DecodedNotification, expectation: ResponseExpectation): boolean {
  if (expectation.type === "none") return false;
  return (expectation.opcode === undefined || notification.opcode === expectation.opcode)
    && (expectation.kind === undefined || notification.kind === expectation.kind);
}
