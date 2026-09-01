import type { ObservationValue } from "./observations";
import type { ObservationAttempt } from "./timing";
import type { GuidedTestStatus } from "./investigation";
import type { CycleVerdict, RecommendationTrailEntry } from "./recommendations";

/**
 * The semantic execution model for guided work.
 *
 * Protocol transactions are the wrong unit for a guided workflow: a single
 * experiment can transmit several times (a human missed the moment and asked
 * to measure again), and two byte-identical transmissions can mean completely
 * different things. Reading the wire alone, a legitimate retry and a workflow
 * bug look the same — which is exactly the confusion this model removes.
 *
 *   Investigation
 *     orchestration       — everything below belongs to ONE physical device
 *       CorePlan          — a bounded, numbered set of milestones
 *         ExperimentRun   — one experiment: a definition plus its parameters
 *           ExperimentAttempt — one attempt at running and observing it
 *             TransferRecord    — one transmission, with a reason
 *
 * Ownership is the point of the nesting. Orchestration evidence is evidence
 * about a physical display, so it lives on the Investigation that is bound to
 * that display and crosses the device boundary with it — never independently.
 * Nothing here duplicates protocol transactions; records link to them by id.
 */

/**
 * Why a guided diagnostic is being transmitted.
 *
 * Closed on purpose. Retransmitting persistent content to someone's display
 * is a real side effect, so every one must be attributable to an intent the
 * product actually offers. There is deliberately no generic "send again":
 * if no reason applies, the transmission is a defect and is blocked.
 */
export type TransferReason =
  | "initial-experiment"
  | "explicit-retry-missed-observation"
  | "explicit-measure-again"
  | "confirmation-run"
  | "controlled-variant"
  | "explicit-reopen";

export const TRANSFER_REASON_LABELS: Readonly<Record<TransferReason, string>> = Object.freeze({
  "initial-experiment": "initial experiment",
  "explicit-retry-missed-observation": "explicit retry after a missed observation",
  "explicit-measure-again": "user asked to measure again",
  "confirmation-run": "confirmation run",
  "controlled-variant": "controlled variant",
  "explicit-reopen": "explicit reopen of a completed experiment",
});

/** Reasons that repeat an experiment rather than starting or varying one. */
const REPEAT_REASONS: readonly TransferReason[] = Object.freeze([
  "explicit-retry-missed-observation",
  "explicit-measure-again",
  "confirmation-run",
  "explicit-reopen",
]);

export function isRepeatTransfer(reason: TransferReason): boolean {
  return REPEAT_REASONS.includes(reason);
}

/**
 * How strongly the physical display in an execution identity is known.
 *
 * Only the browser's per-authorization device id identifies a physical unit.
 * A fingerprint shape identifies a KIND of display — two identical panels
 * share it — and is recorded as exactly that, never promoted.
 */
export type DeviceIdentityBasis = "browser-authorized-device" | "fingerprint-shape" | "unidentified";

/**
 * Identity of one concrete diagnostic execution.
 *
 * Two transmissions share a fingerprint when they are genuinely the same
 * experiment on the same physical device. CRC alone is not identity — the same
 * bytes can belong to different experiments, and the same experiment can be a
 * legitimate repeat — so the fingerprint carries the semantic inputs and keeps
 * the CRC as corroborating evidence.
 *
 * The device segment is the physical display, NOT the profile. A profile
 * identifies a model; two units of the same model share it, and treating that
 * as identity let one panel's execution history speak for another's.
 */
export interface DiagnosticExecutionFingerprint {
  /** Browser-authorized physical device id, when the transport exposes one. */
  readonly physicalDeviceKey: string | null;
  readonly deviceIdentityBasis: DeviceIdentityBasis;
  /** The device MODEL. Recorded for reports; never used as physical identity. */
  readonly profileId: string | null;
  readonly testId: string;
  readonly diagnosticId: string;
  /** Resolved parameters, serialized in a stable order. */
  readonly parameterKey: string;
  readonly programCrc32: string | null;
  readonly rasterStrategy: string | null;
  /** Stable string identity, for comparison and reporting. */
  readonly key: string;
}

export function buildExecutionFingerprint(input: {
  /** Browser-authorized physical device id. Null when the browser exposes none. */
  readonly physicalDeviceKey?: string | null;
  /** Deterministic fingerprint-shape key; identifies a device KIND only. */
  readonly fingerprintShapeKey?: string | null;
  readonly profileId?: string | null;
  readonly testId: string;
  readonly diagnosticId: string;
  readonly parameters?: Readonly<Record<string, number>> | undefined;
  readonly programCrc32?: string | null;
  readonly rasterStrategy?: string | null;
}): DiagnosticExecutionFingerprint {
  const parameterKey = Object.entries(input.parameters ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const physicalDeviceKey = input.physicalDeviceKey ?? null;
  // Honest degradation: a browser device id is a physical unit; a fingerprint
  // shape is a device kind and says so; anything less is unidentified and
  // never gets a fabricated stable identity.
  const basis: DeviceIdentityBasis = physicalDeviceKey
    ? "browser-authorized-device"
    : input.fingerprintShapeKey
      ? "fingerprint-shape"
      : "unidentified";
  const deviceSegment = physicalDeviceKey
    ? `device:${physicalDeviceKey}`
    : input.fingerprintShapeKey
      ? `shape:${input.fingerprintShapeKey}`
      : "unidentified-device";
  return {
    physicalDeviceKey,
    deviceIdentityBasis: basis,
    profileId: input.profileId ?? null,
    testId: input.testId,
    diagnosticId: input.diagnosticId,
    parameterKey,
    programCrc32: input.programCrc32 ?? null,
    rasterStrategy: input.rasterStrategy ?? null,
    key: [deviceSegment, input.testId, input.diagnosticId, parameterKey, input.rasterStrategy ?? "-"].join("|"),
  };
}

export function sameExecution(a: DiagnosticExecutionFingerprint, b: DiagnosticExecutionFingerprint): boolean {
  return a.key === b.key;
}

export interface TransferRecord {
  readonly transferId: string;
  readonly attemptId: string;
  readonly diagnosticId: string;
  readonly reason: TransferReason;
  readonly fingerprint: DiagnosticExecutionFingerprint;
  /** Existing protocol transactions this transmission produced. */
  readonly transactionIds: readonly string[];
  readonly startedAt: string;
  readonly finalWriteAcceptedAt: string | null;
  /**
   * Set when the transmission did not complete. Partial packet transmission
   * is preserved in transactionIds: the display may well have been altered.
   */
  readonly failureReason: string | null;
}

/**
 * Why an attempt could not be used.
 *
 * A transport failure and a mistimed human tap both invalidate an attempt but
 * mean entirely different things, and a report that cannot tell them apart
 * blames the person for the radio dropping out.
 */
export type AttemptFailureKind =
  | "transfer-failed"
  | "human-missed"
  | "user-restarted"
  | "observation-incomplete";

export const ATTEMPT_FAILURE_LABELS: Readonly<Record<AttemptFailureKind, string>> = Object.freeze({
  "transfer-failed": "the diagnostic transfer failed before any physical observation",
  "human-missed": "the moment being measured was missed",
  "user-restarted": "superseded by a later attempt of the same experiment",
  "observation-incomplete": "the observation ended before the timeline finished",
});

/**
 * One attempt at running and observing an experiment.
 *
 * This is the ONE authoritative attempt identity. Timing-specific detail is
 * nested under it rather than numbered separately: two independently numbered
 * attempt lists drift the moment one of them gains an entry the other cannot
 * see — a failed transfer, for instance.
 *
 * Attempts are numbered within their experiment, monotonically and without
 * recycling, and never advance the investigation: three attempts at Test 2
 * leave the user on Test 2.
 */
export interface ExperimentAttempt {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly reason: TransferReason;
  readonly startedAt: string;
  readonly transferIds: readonly string[];
  /** Present once the attempt supplied observations to a result. */
  readonly observations: readonly ObservationValue[];
  /** Timing detail for attempts that measured a physical timeline. */
  readonly timing: ObservationAttempt | null;
  readonly validity: "valid" | "invalid" | "in-progress";
  readonly invalidationReason: string | null;
  readonly failureKind: AttemptFailureKind | null;
}

/**
 * What an experiment's outcome means for the plan.
 *
 * Status ("passed"/"partial"/"inconclusive") describes the hardware. This
 * describes the EXPERIMENT: whether its question was answered, or whether the
 * measurement simply did not gather enough to answer it. Collapsing the two
 * is what let a seven-second observation of a fifteen-second requirement
 * permanently retire the only test that could settle the question.
 */
export type ExperimentResolution =
  /** The question was answered. Positive and negative both count. */
  | "settled"
  /** Not enough usable observation. Repeating the SAME experiment is justified. */
  | "retryable-incomplete"
  /** Measurement or transfer failed. No claim conclusion; retry allowed. */
  | "invalid"
  /** The user stopped observing. Transmission evidence is kept. */
  | "abandoned";

export const EXPERIMENT_RESOLUTION_LABELS: Readonly<Record<ExperimentResolution, string>> = Object.freeze({
  settled: "settled",
  "retryable-incomplete": "not enough observation",
  invalid: "invalid measurement",
  abandoned: "abandoned",
});

/** Only a settled experiment leaves the automatic recommendation rotation. */
export function leavesAutomaticRotation(resolution: ExperimentResolution): boolean {
  return resolution === "settled";
}

export interface ExperimentRun {
  readonly experimentRunId: string;
  readonly definitionId: string;
  readonly title: string;
  /** Core-plan milestone this experiment belongs to, when it belongs to one. */
  readonly corePlanStepId: string | null;
  /** Human label for the controlled variable, when this is a variant. */
  readonly variant: string | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly fingerprint: DiagnosticExecutionFingerprint;
  readonly status: GuidedTestStatus | "in-progress";
  /** What the outcome means for the plan. See ExperimentResolution. */
  readonly resolution: ExperimentResolution | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly attempts: readonly ExperimentAttempt[];
  readonly conclusion: string | null;
  /** Set when a completed experiment was deliberately run again. */
  readonly reopenReason: string | null;
}

/**
 * What MatrixSmith believes is on the physical display right now.
 *
 * A stored-program display holds exactly one program, and every persistent
 * write replaces it. Tracking only guided transfers meant an image sent from
 * Create left the guard convinced a diagnostic was still showing — so a
 * legitimate initial run of that diagnostic was refused as a duplicate.
 *
 * Certainty is never overclaimed. Anything that makes the panel's contents
 * genuinely unknown — a failed write, a device change, an import, a browser
 * restart — reports "unknown" rather than the last thing we happened to send.
 */
export type PanelProgramCertainty =
  /** This exact program was written and the write was accepted. */
  | "known-active"
  /** Something else was written since; whatever was here is gone. */
  | "known-replaced"
  /** The panel's contents cannot be established from this session. */
  | "unknown";

export type PanelProgramKind = "guided-diagnostic" | "ordinary-content" | "validation" | "none";

export interface PanelProgramState {
  readonly certainty: PanelProgramCertainty;
  readonly kind: PanelProgramKind;
  /** Execution identity, for guided diagnostics only. */
  readonly fingerprint: DiagnosticExecutionFingerprint | null;
  /** Human description of the last program MatrixSmith wrote. */
  readonly label: string;
  /** When the transfer began. Not when the panel changed. */
  readonly startedAt: string | null;
  /**
   * The final host-accepted write — the moment the panel's stored program
   * actually changed. Null while a write is staged but not yet accepted.
   * Reports must use this, never startedAt: labelling transfer-start as
   * "written at" reports a time the display had not been touched.
   */
  readonly writtenAt: string | null;
  /** Why certainty was lost, when it was. */
  readonly uncertaintyReason: string | null;
}

export const UNKNOWN_PANEL_PROGRAM: PanelProgramState = Object.freeze({
  certainty: "unknown",
  kind: "none",
  fingerprint: null,
  label: "unknown",
  startedAt: null,
  writtenAt: null,
  uncertaintyReason: "Nothing has been written to the display in this session.",
});

/**
 * Whether this exact guided diagnostic is presumed to be on the panel now.
 *
 * The question the duplicate guard must ask. "Has MatrixSmith ever sent these
 * bytes?" is a different — and wrong — question: after any intervening
 * persistent write, resending them is a legitimate initial experiment.
 */
export function isGuidedProgramActive(state: PanelProgramState, fingerprint: DiagnosticExecutionFingerprint): boolean {
  return state.certainty === "known-active"
    && state.kind === "guided-diagnostic"
    && state.fingerprint !== null
    && state.fingerprint.key === fingerprint.key;
}

/** Lose certainty about the panel without discarding what was last written. */
export function invalidatePanelProgram(state: PanelProgramState, reason: string): PanelProgramState {
  if (state.certainty === "unknown" && state.uncertaintyReason === reason) return state;
  return { ...state, certainty: "unknown", uncertaintyReason: reason };
}

export interface ReopenedExperiment {
  readonly testId: string;
  readonly reason: string;
  readonly at: string;
}

/**
 * All guided orchestration state for ONE investigation, and therefore for one
 * physical device. Held by the Investigation so it can never outlive, or be
 * inherited across, the device boundary that owns it.
 */
export interface InvestigationOrchestration {
  readonly experiments: readonly ExperimentRun[];
  readonly transfers: readonly TransferRecord[];
  readonly panelProgram: PanelProgramState;
  readonly reopened: readonly ReopenedExperiment[];
  readonly recommendationTrail: readonly RecommendationTrailEntry[];
  readonly cycleVerdict: CycleVerdict;
}

export function emptyOrchestration(): InvestigationOrchestration {
  return {
    experiments: [], transfers: [],
    panelProgram: UNKNOWN_PANEL_PROGRAM,
    reopened: [], recommendationTrail: [],
    cycleVerdict: { cycling: false, testIds: [], detail: null },
  };
}

/**
 * Strip every operational claim from orchestration state crossing a trust
 * boundary. The semantic history is real and stays; the belief that a program
 * is physically on a panel does not survive a restart, an import, or a device
 * change, because nothing in this session observed it.
 */
export function demoteOrchestration(orchestration: InvestigationOrchestration, reason: string): InvestigationOrchestration {
  return { ...orchestration, panelProgram: invalidatePanelProgram(orchestration.panelProgram, reason) };
}

export function newId(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${value}`;
}

/** Attempts that produced usable observations. */
export function validExperimentAttempts(run: ExperimentRun): readonly ExperimentAttempt[] {
  return run.attempts.filter((attempt) => attempt.validity === "valid");
}

/** An experiment whose measurement can legitimately be repeated as-is. */
export function isRetryableIncomplete(run: ExperimentRun): boolean {
  return run.resolution === "retryable-incomplete";
}

export interface TransferClassification {
  readonly total: number;
  readonly byReason: Readonly<Record<TransferReason, number>>;
  readonly failed: number;
  /** Repeated payloads, grouped by execution identity. */
  readonly repeatedExecutions: readonly {
    readonly key: string;
    readonly testId: string;
    readonly programCrc32: string | null;
    readonly transfers: number;
    readonly byReason: Readonly<Record<string, number>>;
  }[];
  /**
   * Transmissions that repeated an execution without an intent that explains
   * it. Legitimate retries are NOT counted here — identical bytes are
   * expected when a human asks to measure the same thing again.
   */
  readonly unclassifiedDuplicates: number;
}

export function classifyTransfers(transfers: readonly TransferRecord[]): TransferClassification {
  const byReason = Object.fromEntries(
    (Object.keys(TRANSFER_REASON_LABELS) as TransferReason[]).map((reason) => [reason, 0]),
  ) as Record<TransferReason, number>;
  const groups = new Map<string, { testId: string; crc: string | null; transfers: TransferRecord[] }>();
  for (const transfer of transfers) {
    byReason[transfer.reason] += 1;
    const group = groups.get(transfer.fingerprint.key)
      ?? { testId: transfer.fingerprint.testId, crc: transfer.fingerprint.programCrc32, transfers: [] };
    group.transfers.push(transfer);
    groups.set(transfer.fingerprint.key, group);
  }
  const repeated = [...groups.entries()]
    .filter(([, group]) => group.transfers.length > 1)
    .map(([key, group]) => ({
      key,
      testId: group.testId,
      programCrc32: group.crc,
      transfers: group.transfers.length,
      byReason: group.transfers.reduce<Record<string, number>>((totals, transfer) => {
        totals[transfer.reason] = (totals[transfer.reason] ?? 0) + 1;
        return totals;
      }, {}),
    }));
  // A repeat is only unexplained when it claims to be an initial run or a
  // controlled variant of an execution that already happened — those reasons
  // assert novelty the bytes contradict. A transmission that FAILED asserts
  // nothing: the next initial attempt is genuinely the first that landed.
  const unclassified = [...groups.values()].reduce((total, group) => {
    const novelClaims = group.transfers.filter((transfer) => !isRepeatTransfer(transfer.reason) && transfer.failureReason === null).length;
    return total + Math.max(0, novelClaims - 1);
  }, 0);
  return {
    total: transfers.length,
    byReason,
    failed: transfers.filter((transfer) => transfer.failureReason !== null).length,
    repeatedExecutions: repeated,
    unclassifiedDuplicates: unclassified,
  };
}
