import { isValidObservationValue, type ObservationValue } from "./observations";
import type { CompletedGuidedTest, Investigation, InvestigationGoal, SymptomId } from "./investigation";
import { CLAIM_DEFINITIONS, type ClaimEvidence, type ClaimId, type ClaimStatus, type EvidenceProvenance, type EvidenceScope } from "./claims";
import {
  emptyOrchestration, invalidatePanelProgram, UNKNOWN_PANEL_PROGRAM,
  type AttemptFailureKind, type DiagnosticExecutionFingerprint, type ExperimentAttempt,
  type ExperimentResolution, type ExperimentRun, type InvestigationOrchestration,
  type PanelProgramKind, type PanelProgramState, type ReopenedExperiment,
  type TransferReason, type TransferRecord,
} from "./orchestration";
import type { AttemptValidity, ObservationAttempt, PhysicalTimingMark, TimingMarkSource } from "./timing";
import type { RecommendationOrigin, RecommendationTrailEntry } from "./recommendations";

/**
 * One structural validator for Investigations arriving from outside memory.
 *
 * Local storage and diagnostic bundles are both user-controlled, untrusted
 * input, and they were being treated differently: storage sanitized field by
 * field while bundle parsing type-asserted an arbitrary object into an
 * Investigation. Two validators for the same shape means one of them is
 * always the weaker one, so there is now exactly one.
 *
 * Nothing here grants authority. Scope demotion still happens at the boundary
 * that owns it, and the panel-program belief is always rebuilt as UNKNOWN
 * regardless of what the record claims — a file asserting that a diagnostic
 * is live on someone's display must not be able to suppress a transmission.
 * Malformed entries are dropped individually rather than taking the record
 * down with them: a corrupt attempt should cost that attempt, not the whole
 * investigation.
 */

const CLAIM_IDS: ReadonlySet<string> = new Set(CLAIM_DEFINITIONS.map((definition) => definition.id));
const CLAIM_STATUSES: readonly string[] = ["verified", "source-supported", "unresolved", "rejected", "unknown"];
const EVIDENCE_SCOPES: readonly string[] = ["source-reference", "built-in-profile", "current-session", "previous-local-session", "imported-external"];
const PROVENANCES: readonly string[] = ["observed", "corroborated", "source-derived", "inferred", "speculative"];
const GUIDED_STATUSES: readonly string[] = ["passed", "failed", "partial", "inconclusive", "abandoned"];
const TRANSFER_REASONS: readonly string[] = [
  "initial-experiment", "explicit-retry-missed-observation", "explicit-measure-again",
  "confirmation-run", "controlled-variant", "explicit-reopen",
];
const ATTEMPT_VALIDITIES: readonly string[] = ["valid", "missed-t1", "missed-t2", "accidental-tap", "user-restarted", "incomplete", "transfer-failed"];
const FAILURE_KINDS: readonly string[] = ["transfer-failed", "human-missed", "user-restarted", "observation-incomplete"];
const RESOLUTIONS: readonly string[] = ["settled", "retryable-incomplete", "invalid", "abandoned"];
const MARK_SOURCES: readonly string[] = ["automatic-transport", "human-observed", "derived-human-observed"];
const PANEL_KINDS: readonly string[] = ["guided-diagnostic", "ordinary-content", "validation", "none"];
const PANEL_CERTAINTIES: readonly string[] = ["known-active", "known-replaced", "unknown"];
const ORIGINS: readonly string[] = ["automatic-recommendation", "explicit-retry", "explicit-reopen", "manual-selection"];
const GOAL_KINDS: readonly string[] = ["develop", "troubleshoot"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberRecord(source: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isObject(source)) return result;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function stringRecord(source: unknown): Record<string, string | number | boolean> | undefined {
  if (!isObject(source)) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validate and normalize an Investigation from untrusted input.
 *
 * Returns null when the value is not recognizably an investigation at all.
 * `panelUncertaintyReason` describes why this record cannot say what is on
 * the display — every path through here has one.
 */
export function sanitizeInvestigation(value: unknown, panelUncertaintyReason: string): Investigation | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== "string" || !isObject(value.goal)) return null;
  if (value.status !== "active" && value.status !== "stopped") return null;
  if (!Array.isArray(value.completedTests) || !Array.isArray(value.claimEvidence)) return null;
  return {
    id: value.id,
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    profileId: typeof value.profileId === "string" ? value.profileId : null,
    deviceName: typeof value.deviceName === "string" ? value.deviceName : null,
    deviceBinding: sanitizeDeviceBinding(value.deviceBinding),
    goal: sanitizeGoal(value.goal),
    status: value.status,
    completedTests: value.completedTests.map(sanitizeCompletedTest).filter((test): test is CompletedGuidedTest => test !== null),
    claimEvidence: value.claimEvidence.map(sanitizeClaimEvidence).filter((entry): entry is ClaimEvidence => entry !== null),
    notes: Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === "string") : [],
    orchestration: sanitizeOrchestration(value.orchestration, panelUncertaintyReason),
  };
}

function sanitizeGoal(value: Record<string, unknown>): InvestigationGoal {
  const kind = GOAL_KINDS.includes(text(value.kind)) ? (value.kind as InvestigationGoal["kind"]) : "develop";
  return {
    kind,
    description: text(value.description),
    ...(typeof value.symptomId === "string" ? { symptomId: value.symptomId as SymptomId } : {}),
  };
}

function sanitizeDeviceBinding(value: unknown): Investigation["deviceBinding"] {
  if (!isObject(value) || typeof value.fingerprintKey !== "string") return null;
  return {
    ...(typeof value.browserDeviceId === "string" ? { browserDeviceId: value.browserDeviceId } : {}),
    profileId: typeof value.profileId === "string" ? value.profileId : null,
    fingerprintKey: value.fingerprintKey,
  };
}

function sanitizeClaimEvidence(value: unknown): ClaimEvidence | null {
  if (!isObject(value)) return null;
  if (typeof value.claimId !== "string" || !CLAIM_IDS.has(value.claimId)) return null;
  if (!CLAIM_STATUSES.includes(text(value.status))) return null;
  if (!EVIDENCE_SCOPES.includes(text(value.scope))) return null;
  const metrics = numberRecord(value.metrics);
  const details = stringRecord(value.details);
  return {
    claimId: value.claimId as ClaimId,
    status: value.status as ClaimStatus,
    scope: value.scope as EvidenceScope,
    provenance: (PROVENANCES.includes(text(value.provenance)) ? value.provenance : "inferred") as EvidenceProvenance,
    summary: text(value.summary),
    ...(typeof value.recordedAt === "string" ? { recordedAt: value.recordedAt } : {}),
    ...(typeof value.testId === "string" ? { testId: value.testId } : {}),
    ...(Array.isArray(value.transactionIds) ? { transactionIds: value.transactionIds.filter((id): id is string => typeof id === "string") } : {}),
    ...(typeof value.confidence === "number" && Number.isFinite(value.confidence) ? { confidence: value.confidence } : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(details ? { details } : {}),
  };
}

function sanitizeCompletedTest(value: unknown): CompletedGuidedTest | null {
  if (!isObject(value) || typeof value.testId !== "string") return null;
  if (!GUIDED_STATUSES.includes(text(value.status))) return null;
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.map(sanitizeObservationAttempt).filter((attempt): attempt is ObservationAttempt => attempt !== null)
    : [];
  return {
    testId: value.testId,
    title: text(value.title, value.testId),
    startedAt: text(value.startedAt),
    completedAt: text(value.completedAt),
    status: value.status as CompletedGuidedTest["status"],
    observations: Array.isArray(value.observations) ? value.observations.filter((entry): entry is ObservationValue => isValidObservationValue(entry as ObservationValue)) : [],
    established: stringArray(value.established),
    rejected: stringArray(value.rejected),
    unknowns: stringArray(value.unknowns),
    summary: text(value.summary),
    transactionIds: stringArray(value.transactionIds),
    ...(isObject(value.parameters) && stringRecord(value.parameters) ? { parameters: stringRecord(value.parameters)! } : {}),
    ...(attempts.length > 0 ? { attempts } : {}),
    ...(RESOLUTIONS.includes(text(value.resolution)) ? { resolution: value.resolution as ExperimentResolution } : {}),
    // The run linkage is what separates a result this investigation executed
    // from one it inherited; losing it would make every restored result look
    // historical to the scheduler.
    ...(typeof value.experimentRunId === "string" ? { experimentRunId: value.experimentRunId } : {}),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function sanitizeObservationAttempt(value: unknown): ObservationAttempt | null {
  if (!isObject(value) || typeof value.attemptNumber !== "number") return null;
  if (!ATTEMPT_VALIDITIES.includes(text(value.validity))) return null;
  return {
    attemptNumber: value.attemptNumber,
    parameters: numberRecord(value.parameters),
    t0: typeof value.t0 === "string" ? value.t0 : null,
    marks: Array.isArray(value.marks) ? value.marks.map(sanitizeMark).filter((mark): mark is PhysicalTimingMark => mark !== null) : [],
    values: Array.isArray(value.values) ? value.values.filter((entry): entry is ObservationValue => isValidObservationValue(entry as ObservationValue)) : [],
    validity: value.validity as AttemptValidity,
    invalidationReason: typeof value.invalidationReason === "string" ? value.invalidationReason : null,
    note: typeof value.note === "string" ? value.note : null,
    startedAt: text(value.startedAt),
    endedAt: typeof value.endedAt === "string" ? value.endedAt : null,
  };
}

function sanitizeMark(value: unknown): PhysicalTimingMark | null {
  if (!isObject(value) || typeof value.event !== "string") return null;
  if (!MARK_SOURCES.includes(text(value.source))) return null;
  return {
    event: value.event,
    timestamp: text(value.timestamp),
    source: value.source as TimingMarkSource,
    elapsedMs: typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) ? value.elapsedMs : 0,
    ...(typeof value.fieldId === "string" ? { fieldId: value.fieldId } : {}),
  };
}

function sanitizeOrchestration(value: unknown, panelUncertaintyReason: string): InvestigationOrchestration {
  if (!isObject(value)) return demoted(emptyOrchestration(), panelUncertaintyReason);
  const orchestration: InvestigationOrchestration = {
    experiments: Array.isArray(value.experiments) ? value.experiments.map(sanitizeExperiment).filter((run): run is ExperimentRun => run !== null) : [],
    transfers: Array.isArray(value.transfers) ? value.transfers.map(sanitizeTransfer).filter((transfer): transfer is TransferRecord => transfer !== null) : [],
    panelProgram: sanitizePanelProgram(value.panelProgram),
    reopened: Array.isArray(value.reopened) ? value.reopened.map(sanitizeReopened).filter((entry): entry is ReopenedExperiment => entry !== null) : [],
    recommendationTrail: Array.isArray(value.recommendationTrail) ? value.recommendationTrail.map(sanitizeTrailEntry).filter((entry): entry is RecommendationTrailEntry => entry !== null) : [],
    cycleVerdict: {
      cycling: Boolean(isObject(value.cycleVerdict) && value.cycleVerdict.cycling),
      testIds: isObject(value.cycleVerdict) ? stringArray(value.cycleVerdict.testIds) : [],
      detail: isObject(value.cycleVerdict) && typeof value.cycleVerdict.detail === "string" ? value.cycleVerdict.detail : null,
    },
  };
  return demoted(orchestration, panelUncertaintyReason);
}

function demoted(orchestration: InvestigationOrchestration, reason: string): InvestigationOrchestration {
  return { ...orchestration, panelProgram: invalidatePanelProgram(orchestration.panelProgram, reason) };
}

function sanitizeExperiment(value: unknown): ExperimentRun | null {
  if (!isObject(value) || typeof value.experimentRunId !== "string" || typeof value.definitionId !== "string") return null;
  const fingerprint = sanitizeFingerprint(value.fingerprint);
  if (!fingerprint) return null;
  const status = text(value.status);
  if (status !== "in-progress" && !GUIDED_STATUSES.includes(status)) return null;
  return {
    experimentRunId: value.experimentRunId,
    definitionId: value.definitionId,
    title: text(value.title, value.definitionId),
    corePlanStepId: typeof value.corePlanStepId === "string" ? value.corePlanStepId : null,
    variant: typeof value.variant === "string" ? value.variant : null,
    parameters: numberRecord(value.parameters),
    fingerprint,
    status: status as ExperimentRun["status"],
    resolution: RESOLUTIONS.includes(text(value.resolution)) ? (value.resolution as ExperimentResolution) : null,
    startedAt: text(value.startedAt),
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    attempts: Array.isArray(value.attempts) ? value.attempts.map(sanitizeExperimentAttempt).filter((attempt): attempt is ExperimentAttempt => attempt !== null) : [],
    conclusion: typeof value.conclusion === "string" ? value.conclusion : null,
    reopenReason: typeof value.reopenReason === "string" ? value.reopenReason : null,
  };
}

function sanitizeExperimentAttempt(value: unknown): ExperimentAttempt | null {
  if (!isObject(value) || typeof value.attemptId !== "string" || typeof value.attemptNumber !== "number") return null;
  if (!TRANSFER_REASONS.includes(text(value.reason))) return null;
  if (value.validity !== "valid" && value.validity !== "invalid" && value.validity !== "in-progress") return null;
  return {
    attemptId: value.attemptId,
    attemptNumber: value.attemptNumber,
    reason: value.reason as TransferReason,
    startedAt: text(value.startedAt),
    transferIds: stringArray(value.transferIds),
    observations: Array.isArray(value.observations) ? value.observations.filter((entry): entry is ObservationValue => isValidObservationValue(entry as ObservationValue)) : [],
    timing: sanitizeObservationAttempt(value.timing),
    validity: value.validity,
    invalidationReason: typeof value.invalidationReason === "string" ? value.invalidationReason : null,
    failureKind: FAILURE_KINDS.includes(text(value.failureKind)) ? (value.failureKind as AttemptFailureKind) : null,
  };
}

function sanitizeTransfer(value: unknown): TransferRecord | null {
  if (!isObject(value) || typeof value.transferId !== "string" || typeof value.attemptId !== "string") return null;
  if (!TRANSFER_REASONS.includes(text(value.reason))) return null;
  const fingerprint = sanitizeFingerprint(value.fingerprint);
  if (!fingerprint) return null;
  return {
    transferId: value.transferId,
    attemptId: value.attemptId,
    diagnosticId: text(value.diagnosticId),
    reason: value.reason as TransferReason,
    fingerprint,
    transactionIds: stringArray(value.transactionIds),
    startedAt: text(value.startedAt),
    finalWriteAcceptedAt: typeof value.finalWriteAcceptedAt === "string" ? value.finalWriteAcceptedAt : null,
    failureReason: typeof value.failureReason === "string" ? value.failureReason : null,
  };
}

function sanitizeFingerprint(value: unknown): DiagnosticExecutionFingerprint | null {
  if (!isObject(value) || typeof value.key !== "string" || typeof value.testId !== "string") return null;
  const basis = text(value.deviceIdentityBasis);
  if (basis !== "browser-authorized-device" && basis !== "fingerprint-shape" && basis !== "unidentified") return null;
  return {
    physicalDeviceKey: typeof value.physicalDeviceKey === "string" ? value.physicalDeviceKey : null,
    deviceIdentityBasis: basis,
    profileId: typeof value.profileId === "string" ? value.profileId : null,
    testId: value.testId,
    diagnosticId: text(value.diagnosticId),
    parameterKey: text(value.parameterKey),
    programCrc32: typeof value.programCrc32 === "string" ? value.programCrc32 : null,
    rasterStrategy: typeof value.rasterStrategy === "string" ? value.rasterStrategy : null,
    key: value.key,
  };
}

function sanitizePanelProgram(value: unknown): PanelProgramState {
  if (!isObject(value)) return UNKNOWN_PANEL_PROGRAM;
  if (!PANEL_KINDS.includes(text(value.kind)) || !PANEL_CERTAINTIES.includes(text(value.certainty))) return UNKNOWN_PANEL_PROGRAM;
  return {
    certainty: value.certainty as PanelProgramState["certainty"],
    kind: value.kind as PanelProgramKind,
    fingerprint: sanitizeFingerprint(value.fingerprint),
    label: text(value.label, "unknown"),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    writtenAt: typeof value.writtenAt === "string" ? value.writtenAt : null,
    uncertaintyReason: typeof value.uncertaintyReason === "string" ? value.uncertaintyReason : null,
  };
}

function sanitizeReopened(value: unknown): ReopenedExperiment | null {
  if (!isObject(value) || typeof value.testId !== "string" || typeof value.reason !== "string") return null;
  return { testId: value.testId, reason: value.reason, at: text(value.at) };
}

function sanitizeTrailEntry(value: unknown): RecommendationTrailEntry | null {
  if (!isObject(value) || typeof value.testId !== "string" || typeof value.evidenceCount !== "number") return null;
  return {
    testId: value.testId,
    at: text(value.at),
    evidenceCount: value.evidenceCount,
    ...(ORIGINS.includes(text(value.origin)) ? { origin: value.origin as RecommendationOrigin } : {}),
  };
}
