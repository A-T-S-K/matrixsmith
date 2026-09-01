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

export interface GuidedTestTimer {
  /** Duration observation field the stopwatch feeds. */
  readonly fieldId: string;
  readonly startLabel: string;
  readonly stopLabel: string;
  /** Milestone hold times, in seconds, offered as "still unchanged" shortcuts. */
  readonly milestoneSeconds: readonly number[];
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
  readonly observation: readonly ObservationFieldSpec[];
  readonly timer?: GuidedTestTimer;
  /** Whether the UI should render the plan's region diagram before/while observing. */
  readonly showRegionDiagram: boolean;
  interpret(values: readonly ObservationValue[]): GuidedTestInterpretation;
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

export function noteAnswer(values: readonly ObservationValue[], fieldId: string): string | null {
  const value = findValue(values, fieldId);
  if (value?.kind === "note") return value.text;
  return value && "note" in value && value.note ? value.note : null;
}

export type { ClaimState };
