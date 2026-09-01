import type { Persistence, RiskClass } from "../core/risk";
import type { MatrixOperation } from "../core/operations";
import type { ClaimEvidence, ClaimId, ClaimState, ClaimStatus } from "./claims";
import { claimState } from "./claims";
import type { ObservationFieldSpec, ObservationValue } from "./observations";
import type { GuidedTestStatus } from "./investigation";

/**
 * Driver-contributed guided hardware tests. Each test is one linear
 * ABOUT → RUN → OBSERVE → RESULT mini-flow: the definition declares what to
 * send, what to ask the human, and how observations become atomic claim
 * evidence. The UI renders these generically — a new driver or test never
 * edits view code or recommendation conditionals.
 */

export type GuidedTestCategory = "core" | "recommended" | "advanced" | "optional";

export interface ClaimRequirement {
  readonly claimId: ClaimId;
  /** Statuses that satisfy the requirement. */
  readonly anyOf: readonly ClaimStatus[];
}

export interface GuidedTestOutcomeDescription {
  readonly outcome: string;
  readonly learns: string;
}

export interface GuidedTestAbout {
  /** The question this test answers, in user language. */
  readonly question: string;
  readonly whyRelevant: string;
  readonly whatMatrixSmithDoes: string;
  readonly whatChangesOnDevice: string;
  readonly estimatedObservationTime: string;
  readonly possibleOutcomes: readonly GuidedTestOutcomeDescription[];
  /** Shown before the transfer begins (e.g. "judge the initial image immediately"). */
  readonly preTransferNote?: string;
  /** Shown at the OBSERVE stage. */
  readonly observeInstructions: string;
  /** Protocol-level detail, collapsed behind "technical details". */
  readonly technicalDetails: readonly string[];
}

/** Boolean observation set automatically when a timeline button is tapped. */
export interface TimelineBooleanSet {
  readonly fieldId: string;
  readonly value: "yes" | "no";
}

/**
 * One phase of a measured physical timeline. All durations are measured by
 * MatrixSmith from T0 — the final host-accepted program write — so the human
 * only ever taps a button at the moment something physically happens and
 * never estimates a time.
 */
export interface TimelinePhase {
  readonly id: string;
  /** Instruction shown while this phase is active. */
  readonly prompt: string;
  /** Duration field receiving elapsed-since-T0 when the event button is tapped. */
  readonly fieldId: string;
  readonly eventLabel: string;
  readonly eventSets?: readonly TimelineBooleanSet[];
  /** Optional negative outcome ending the timeline without a duration (e.g. the image never appeared). */
  readonly failLabel?: string;
  readonly failSets?: readonly TimelineBooleanSet[];
  /** Optional "nothing happened" stop ending the observation; elapsed goes to stillDurationFieldId. */
  readonly stillLabel?: string;
  readonly stillDurationFieldId?: string;
  readonly stillSets?: readonly TimelineBooleanSet[];
  /** Seconds (measured from the previous phase's event) after which the still stop satisfies the observation window. */
  readonly minStillSeconds?: number;
}

export interface GuidedTestTimer {
  readonly phases: readonly TimelinePhase[];
}

export interface GuidedTestInterpretation {
  readonly status: GuidedTestStatus;
  readonly established: readonly string[];
  readonly rejected: readonly string[];
  readonly unknowns: readonly string[];
  readonly summary: string;
  /** Claim evidence contributions; the engine stamps scope/test/transactions. */
  readonly claimUpdates: readonly ClaimUpdate[];
  readonly nextHint?: string;
}

export interface ClaimUpdate {
  readonly claimId: ClaimId;
  readonly status: ClaimStatus;
  readonly summary: string;
  readonly provenance?: ClaimEvidence["provenance"];
  /** MatrixSmith-measured quantities backing the update (e.g. visibleStaticHoldMs). */
  readonly metrics?: Readonly<Record<string, number>>;
  /** Structured outcome facts for session-resolved behavior (e.g. zeroBehavior). */
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface GuidedTestDefinition {
  readonly id: string;
  readonly driverId: string;
  readonly title: string;
  readonly category: GuidedTestCategory;
  readonly targetClaims: readonly ClaimId[];
  readonly prerequisites: readonly ClaimRequirement[];
  /** Other guided tests that must have completed first (e.g. the stayTime comparison follows the baseline measurement). */
  readonly requiresCompletedTests: readonly string[];
  readonly risk: RiskClass;
  readonly persistence: Persistence;
  readonly consequence: string;
  readonly about: GuidedTestAbout;
  /** The deterministic operation to transmit. Always a fixed driver-defined program. */
  readonly operation: MatrixOperation;
  /**
   * Optional evidence-aware operation builder. Most tests are fully static;
   * a test whose exact operation depends on already-established evidence
   * (e.g. including high-nibble bands only once a fourth channel is
   * established) derives it here. The result must still be one of the fixed
   * driver-defined diagnostic programs with declared parameters — this is
   * NOT a raw-content escape hatch.
   */
  buildOperation?(context: GuidedOperationContext): MatrixOperation;
  readonly observation: readonly ObservationFieldSpec[];
  readonly timer?: GuidedTestTimer;
  /** Whether the UI should render the plan's region diagram before/while observing. */
  readonly showRegionDiagram: boolean;
  /** Optional cross-field coherence validation beyond the generic structural checks; returns error messages. */
  validate?(values: readonly ObservationValue[]): readonly string[];
  interpret(values: readonly ObservationValue[]): GuidedTestInterpretation;
}

/** Context available to evidence-aware operation builders. */
export interface GuidedOperationContext {
  readonly profile: import("../core/device").DeviceProfile;
  /** Full claim-evidence pool for the session (trust decisions via operationalTrust). */
  readonly evidence: readonly ClaimEvidence[];
}

/** Resolve a guided test's exact operation for the current evidence. */
export function resolveGuidedOperation(test: GuidedTestDefinition, context: GuidedOperationContext): MatrixOperation {
  return test.buildOperation ? test.buildOperation(context) : test.operation;
}

export interface GuidedTestAvailability {
  readonly test: GuidedTestDefinition;
  readonly available: boolean;
  readonly unmetPrerequisites: readonly ClaimRequirement[];
  readonly missingCompletedTests: readonly string[];
  readonly reason: string | null;
}

export function evaluateTestAvailability(
  test: GuidedTestDefinition,
  evidence: readonly ClaimEvidence[],
  completedTestIds: readonly string[],
): GuidedTestAvailability {
  const unmet = test.prerequisites.filter((requirement) => !requirement.anyOf.includes(claimState(requirement.claimId, evidence).status));
  const missing = test.requiresCompletedTests.filter((id) => !completedTestIds.includes(id));
  const available = unmet.length === 0 && missing.length === 0;
  const reason = available ? null : unmet.length > 0
    ? `Needs ${unmet.map((requirement) => `${requirement.claimId} to be ${requirement.anyOf.join(" or ")}`).join("; ")}.`
    : `Run ${missing.join(", ")} first.`;
  return { test, available, unmetPrerequisites: unmet, missingCompletedTests: missing, reason };
}

/**
 * Fields the measured timeline fills in. These are never presented as
 * questions: the human taps a physical event and MatrixSmith writes the
 * value, so asking again would invite an estimate where a measurement
 * already exists.
 */
export function timerDrivenFieldIds(timer: GuidedTestTimer | null | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const phase of timer?.phases ?? []) {
    ids.add(phase.fieldId);
    if (phase.stillDurationFieldId) ids.add(phase.stillDurationFieldId);
    for (const set of [...(phase.eventSets ?? []), ...(phase.failSets ?? []), ...(phase.stillSets ?? [])]) ids.add(set.fieldId);
  }
  return ids;
}

/** Convenience for interpret() implementations. */
export function findValue(values: readonly ObservationValue[], fieldId: string): ObservationValue | undefined {
  return values.find((value) => value.fieldId === fieldId);
}

export function booleanAnswer(values: readonly ObservationValue[], fieldId: string): "yes" | "no" | "unsure" | null {
  const value = findValue(values, fieldId);
  return value?.kind === "boolean" ? value.value : null;
}

export function choiceAnswer(values: readonly ObservationValue[], fieldId: string): string | null {
  const value = findValue(values, fieldId);
  return value?.kind === "choice" ? value.optionId : null;
}

export function durationAnswer(values: readonly ObservationValue[], fieldId: string): number | null {
  const value = findValue(values, fieldId);
  return value?.kind === "duration" ? value.milliseconds : null;
}

/** Only MatrixSmith-measured durations are evidence-grade; user estimates never verify a claim. */
export function measuredDurationAnswer(values: readonly ObservationValue[], fieldId: string): number | null {
  const value = findValue(values, fieldId);
  return value?.kind === "duration" && value.measuredBy === "matrixsmith-timer" ? value.milliseconds : null;
}

export function noteAnswer(values: readonly ObservationValue[], fieldId: string): string | null {
  const value = findValue(values, fieldId);
  if (value?.kind === "note") return value.text;
  return value && "note" in value && value.note ? value.note : null;
}

export type { ClaimState };
