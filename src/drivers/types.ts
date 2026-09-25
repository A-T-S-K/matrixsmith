import type { Capability } from "../core/capabilities";
import type {
  DeviceFingerprint,
  DeviceProfile,
  GattEndpoint,
} from "../core/device";
import type { Persistence, RiskClass } from "../core/risk";
import type { MatrixOperation } from "../core/operations";
import type {
  ResponseExpectation,
  TransmissionPlan,
} from "../core/transmission";
import type { DiscoveryHints } from "../application/ports/transport";
import type {
  CapabilityAssessment,
  DeviceAssessment,
  EvidenceSummary,
  OperationSafety,
} from "../domain/device/assessment";
import type { DeviceTarget } from "../domain/device/target";

export type MatchConfidence =
  "none" | "weak" | "candidate" | "strong" | "exact";

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
  interpret(notification: DecodedNotification): {
    readonly matched: boolean;
    readonly confidence: "strong" | "exact";
    readonly summary: string;
  } | null;
}

/** Profile-free context used only for bounded family identification. */
export interface CandidateContext {
  readonly fingerprint: DeviceFingerprint;
  readonly endpoints: readonly GattEndpoint[];
  readonly source: DriverContext["source"];
}

export interface ProbeResult {
  readonly response: DecodedNotification | null;
  readonly responseTimedOut: boolean;
}

export type IdentificationResult =
  | { readonly matched: false; readonly reason: string }
  | {
      readonly matched: true;
      readonly confidence: "strong" | "exact";
      readonly summary: string;
    };

export interface FamilyProbeDefinition {
  readonly id: string;
  readonly label: string;
  readonly safety: OperationSafety;
  /** Atomic claims a successful, strongly identified response establishes. */
  readonly establishesClaims: readonly import("../investigation/claims").ClaimId[];
  plan(context: CandidateContext): TransmissionPlan;
  identify(
    result: ProbeResult,
    context: CandidateContext,
  ): IdentificationResult;
}

export interface OperationalContext {
  readonly target: Extract<
    DeviceTarget,
    { kind: "provisional" | "profile-resolved" }
  >;
  readonly assessment: DeviceAssessment;
}

export interface OperationDefinition {
  readonly id: string;
  /** Semantic operation accepted by `plan`; never an opcode or driver-specific command id. */
  readonly operationId: MatrixOperation["type"];
  readonly label: string;
  readonly capabilityId: Capability["id"];
  readonly safety: OperationSafety;
  readonly availability: "available" | "blocked" | "unsupported";
  readonly confidence: CapabilityAssessment["confidence"];
  readonly reason: string;
  readonly evidence: readonly EvidenceSummary[];
  readonly missingClaims: CapabilityAssessment["missingClaims"];
}

export interface CapabilityOperationDescription {
  readonly id: string;
  readonly operationId: MatrixOperation["type"];
  readonly label: string;
  readonly capabilityId: Capability["id"];
  /** A driver may conservatively narrow a canonically available operation. */
  readonly blockedReason?: string;
}

/**
 * Turn a driver's semantic operation declaration into an application-ready
 * description without copying evidence and safety policy into each driver.
 * The canonical capability assessment is the upper bound: a driver may block
 * an operation, but it cannot promote one past its evidence gate.
 */
export function describeCapabilityOperation(
  context: OperationalContext,
  description: CapabilityOperationDescription,
): OperationDefinition {
  const capability = context.assessment.capabilities[description.capabilityId];
  const driverBlocked = description.blockedReason !== undefined;
  return {
    id: description.id,
    operationId: description.operationId,
    label: description.label,
    capabilityId: description.capabilityId,
    safety: capability.safety,
    availability: driverBlocked ? "blocked" : capability.availability,
    confidence: capability.confidence,
    reason: description.blockedReason ?? capability.reason,
    evidence: capability.evidence,
    missingClaims: capability.missingClaims,
  };
}

export interface MatrixDriver {
  readonly id: string;
  readonly family: string;
  readonly identificationClaimId?: import("../investigation/claims").ClaimId;
  discoveryHints(): DiscoveryHints;
  match(fingerprint: DeviceFingerprint): DriverMatch;
  profiles(): readonly DeviceProfile[];
  resolveProfile(fingerprint: DeviceFingerprint): DeviceProfile | null;
  capabilities(profile: DeviceProfile): readonly Capability[];
  endpoints(profile: DeviceProfile): readonly GattEndpoint[];
  /** Identification probes that do not require a reviewed physical-product profile. */
  familyProbes?(context: CandidateContext): readonly FamilyProbeDefinition[];
  probes?(context: DriverContext): readonly DriverProbe[];
  /** Application-ready operation descriptions; presentation code never reconstructs availability. */
  operations(context: OperationalContext): readonly OperationDefinition[];
  /** Driver-contributed guided hardware tests (ABOUT → RUN → OBSERVE → RESULT workflows). */
  guidedTests?(
    profile: DeviceProfile,
  ): readonly import("../investigation/tests").GuidedTestDefinition[];
  /**
   * Human-facing regions of a diagnostic operation, so questions that name a
   * region can be labelled for people — in the UI and in reports — without
   * either layer knowing anything driver-specific.
   */
  diagnosticRegions?(
    operation: MatrixOperation,
    profile: DeviceProfile,
  ): readonly import("../investigation/regions").DiagnosticRegion[];
  /** Exact driver-authored visual preview of a diagnostic operation. */
  diagnosticPreview?(
    operation: MatrixOperation,
    profile: DeviceProfile,
  ): readonly import("../render/framebuffer").Framebuffer[];
  diagnosticTools?(): readonly import("../diagnostics/workflows").DiagnosticTool[];
  diagnosticRasterStrategy?(
    operation: MatrixOperation,
  ): import("../core/raster-strategy").RasterStrategy | null;
  /**
   * A bounded, numbered set of milestones for characterizing this profile, so
   * guided work can say how much is left instead of offering an open-ended
   * chain of next tests.
   */
  corePlan?(
    profile: DeviceProfile,
  ): import("../investigation/core-plan").CorePlan | null;
  /** Baseline atomic-claim evidence this driver ships for a profile. */
  claimEvidence?(
    profile: DeviceProfile,
  ): readonly import("../investigation/claims").ClaimEvidence[];
  plan(operation: MatrixOperation, context: DriverContext): TransmissionPlan;
  decodeNotification?(
    packet: Uint8Array,
    context: DriverNotificationContext,
  ): DecodedNotification | null;
  responseMatches?(
    notification: DecodedNotification,
    expectation: ResponseExpectation,
  ): boolean;
}

export function notificationMatchesExpectation(
  notification: DecodedNotification,
  expectation: ResponseExpectation,
): boolean {
  if (expectation.type === "none") return false;
  return (
    (expectation.opcode === undefined ||
      notification.opcode === expectation.opcode) &&
    (expectation.kind === undefined || notification.kind === expectation.kind)
  );
}
