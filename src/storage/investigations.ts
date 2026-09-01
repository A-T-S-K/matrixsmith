import { BrowserStorageRepository, type KeyValueStorage } from "./repository";
import { isValidObservationValue, type ObservationValue } from "../investigation/observations";
import { demoteInvestigationEvidence, type CompletedGuidedTest, type Investigation } from "../investigation/investigation";
import {
  emptyOrchestration, invalidatePanelProgram, UNKNOWN_PANEL_PROGRAM,
  type AttemptFailureKind, type DiagnosticExecutionFingerprint, type ExperimentAttempt,
  type ExperimentResolution, type ExperimentRun, type InvestigationOrchestration,
  type PanelProgramKind, type PanelProgramState, type ReopenedExperiment,
  type TransferReason, type TransferRecord,
} from "../investigation/orchestration";
import type { AttemptValidity, ObservationAttempt, PhysicalTimingMark, TimingMarkSource } from "../investigation/timing";
import type { RecommendationOrigin, RecommendationTrailEntry } from "../investigation/recommendations";

/**
 * Lightweight local persistence for hardware investigations, so testing can
 * span browser sessions. Only structured evidence persists — never
 * experimental unlocks, persistent-send confirmation tokens, safety
 * bypasses, or raw image/GIF binaries. LocalStorage is user-controlled,
 * untrusted application storage: on load, EVERY piece of investigation claim
 * evidence is structurally demoted to "previous-local-session" regardless of
 * its serialized scope field, so a corrupt or malicious record claiming
 * "built-in-profile" or "current-session" authority can never bypass
 * operational gates.
 *
 * Semantic orchestration — experiments, their attempts (valid AND invalid),
 * transfers and their reasons — persists too. Without it, a report that had
 * just explained "attempt 1 missed, attempt 2 valid" lost that distinction
 * the moment the investigation was saved and resumed, which is the one thing
 * the attempt model exists to preserve.
 *
 * What deliberately does NOT survive is operational authority. Restored
 * orchestration is historical metadata: in particular, the belief that a
 * diagnostic is physically on the panel is always reloaded as UNKNOWN. A
 * saved session can honestly say "this was the last program sent"; only a
 * live observation can say "this is on the display now".
 */

const KEY = "matrixsmith:v1:investigations";
const MAX_STORED = 8;
const SCHEMA_VERSION = 2;

export interface StoredInvestigation {
  readonly savedAt: string;
  readonly investigation: Investigation;
}

interface StoreShape {
  readonly schemaVersion: number;
  readonly investigations: readonly StoredInvestigation[];
}

export function saveInvestigation(investigation: Investigation, storage?: KeyValueStorage, now = new Date().toISOString()): void {
  try {
    const existing = loadStore(storage);
    const others = existing.investigations.filter((entry) => entry.investigation.id !== investigation.id);
    const next: StoreShape = {
      schemaVersion: SCHEMA_VERSION,
      investigations: [{ savedAt: now, investigation: sanitizeForStorage(investigation) }, ...others].slice(0, MAX_STORED),
    };
    new BrowserStorageRepository(storage).set(KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode); history simply doesn't persist.
  }
}

export function loadInvestigationHistory(storage?: KeyValueStorage): readonly StoredInvestigation[] {
  return loadStore(storage).investigations;
}

/** The most recent stored investigation for a profile (or any, when profileId is null). */
export function latestInvestigationFor(profileId: string | null, storage?: KeyValueStorage): StoredInvestigation | null {
  const history = loadInvestigationHistory(storage);
  return history.find((entry) => profileId === null || entry.investigation.profileId === profileId) ?? null;
}

/**
 * Demote ALL stored evidence to the historical local scope for resuming in a
 * new session. The serialized scope field is never trusted — see the module
 * comment.
 */
export function toHistoricalInvestigation(investigation: Investigation): Investigation {
  return demoteInvestigationEvidence(investigation, "previous-local-session");
}

export function forgetInvestigationHistory(storage?: KeyValueStorage): void {
  try { new BrowserStorageRepository(storage).remove(KEY); } catch { /* nothing to forget */ }
}

function sanitizeForStorage(investigation: Investigation): Investigation {
  // Structural whitelist: only known fields are persisted, and observation
  // values must be valid structured observations.
  return {
    id: investigation.id, createdAt: investigation.createdAt, updatedAt: investigation.updatedAt,
    profileId: investigation.profileId, deviceName: investigation.deviceName,
    deviceBinding: investigation.deviceBinding ? {
      ...(investigation.deviceBinding.browserDeviceId ? { browserDeviceId: investigation.deviceBinding.browserDeviceId } : {}),
      profileId: investigation.deviceBinding.profileId,
      fingerprintKey: investigation.deviceBinding.fingerprintKey,
    } : null,
    goal: { kind: investigation.goal.kind, description: investigation.goal.description, ...(investigation.goal.symptomId ? { symptomId: investigation.goal.symptomId } : {}) },
    status: investigation.status,
    completedTests: investigation.completedTests.map(sanitizeCompletedTest),
    claimEvidence: [...investigation.claimEvidence],
    notes: [...investigation.notes],
    orchestration: sanitizeOrchestration(investigation.orchestration ?? emptyOrchestration()),
  };
}

function sanitizeCompletedTest(test: CompletedGuidedTest): CompletedGuidedTest {
  return {
    testId: test.testId, title: test.title, startedAt: test.startedAt, completedAt: test.completedAt,
    status: test.status, observations: test.observations.filter((value) => isValidObservationValue(value)),
    established: [...test.established], rejected: [...test.rejected], unknowns: [...test.unknowns],
    summary: test.summary, transactionIds: [...test.transactionIds],
    ...(test.parameters ? { parameters: { ...test.parameters } } : {}),
    // Invalid attempts are the whole point of keeping attempts at all: a
    // report has to be able to say a measurement was discarded and why.
    // Dropping them on save turned "attempt 1 missed, attempt 2 valid" into
    // a result with no history the moment the session was resumed.
    ...(test.attempts && test.attempts.length > 0 ? { attempts: test.attempts.map(sanitizeObservationAttempt) } : {}),
    ...(test.resolution ? { resolution: test.resolution } : {}),
  };
}

function sanitizeObservationAttempt(attempt: ObservationAttempt): ObservationAttempt {
  return {
    attemptNumber: attempt.attemptNumber,
    parameters: numberRecord(attempt.parameters),
    t0: attempt.t0 ?? null,
    marks: (attempt.marks ?? []).map(sanitizeMark),
    values: (attempt.values ?? []).filter((value) => isValidObservationValue(value)),
    validity: attempt.validity,
    invalidationReason: attempt.invalidationReason ?? null,
    note: attempt.note ?? null,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt ?? null,
  };
}

function sanitizeMark(mark: PhysicalTimingMark): PhysicalTimingMark {
  return {
    event: String(mark.event), timestamp: String(mark.timestamp), source: mark.source,
    elapsedMs: Number(mark.elapsedMs) || 0,
    ...(mark.fieldId ? { fieldId: mark.fieldId } : {}),
  };
}

function sanitizeOrchestration(orchestration: InvestigationOrchestration): InvestigationOrchestration {
  return {
    experiments: orchestration.experiments.map(sanitizeExperiment),
    transfers: orchestration.transfers.map(sanitizeTransfer),
    // The last program written is useful history. Whether it is still on the
    // panel is not something a saved record can establish, so it is stored
    // with its certainty already stripped.
    panelProgram: invalidatePanelProgram(
      sanitizePanelProgram(orchestration.panelProgram),
      "Saved to local history; whether this program is still on the display was not observed.",
    ),
    reopened: orchestration.reopened.map((entry): ReopenedExperiment => ({
      testId: String(entry.testId), reason: String(entry.reason), at: String(entry.at),
    })),
    recommendationTrail: orchestration.recommendationTrail.map((entry): RecommendationTrailEntry => ({
      testId: String(entry.testId), at: String(entry.at),
      evidenceCount: Number(entry.evidenceCount) || 0,
      ...(entry.origin ? { origin: entry.origin } : {}),
    })),
    cycleVerdict: {
      cycling: Boolean(orchestration.cycleVerdict?.cycling),
      testIds: [...(orchestration.cycleVerdict?.testIds ?? [])].map(String),
      detail: orchestration.cycleVerdict?.detail ?? null,
    },
  };
}

function sanitizeExperiment(run: ExperimentRun): ExperimentRun {
  return {
    experimentRunId: run.experimentRunId, definitionId: run.definitionId, title: run.title,
    corePlanStepId: run.corePlanStepId ?? null, variant: run.variant ?? null,
    parameters: numberRecord(run.parameters),
    fingerprint: sanitizeFingerprint(run.fingerprint),
    status: run.status, resolution: run.resolution ?? null,
    startedAt: run.startedAt, completedAt: run.completedAt ?? null,
    attempts: run.attempts.map(sanitizeExperimentAttempt),
    conclusion: run.conclusion ?? null, reopenReason: run.reopenReason ?? null,
  };
}

function sanitizeExperimentAttempt(attempt: ExperimentAttempt): ExperimentAttempt {
  return {
    attemptId: attempt.attemptId, attemptNumber: Number(attempt.attemptNumber) || 0,
    reason: attempt.reason, startedAt: attempt.startedAt,
    transferIds: [...attempt.transferIds].map(String),
    observations: attempt.observations.filter((value) => isValidObservationValue(value)),
    timing: attempt.timing ? sanitizeObservationAttempt(attempt.timing) : null,
    validity: attempt.validity,
    invalidationReason: attempt.invalidationReason ?? null,
    failureKind: attempt.failureKind ?? null,
  };
}

function sanitizeTransfer(transfer: TransferRecord): TransferRecord {
  return {
    transferId: transfer.transferId, attemptId: transfer.attemptId, diagnosticId: transfer.diagnosticId,
    reason: transfer.reason, fingerprint: sanitizeFingerprint(transfer.fingerprint),
    transactionIds: [...transfer.transactionIds].map(String),
    startedAt: transfer.startedAt, finalWriteAcceptedAt: transfer.finalWriteAcceptedAt ?? null,
    failureReason: transfer.failureReason ?? null,
  };
}

function sanitizeFingerprint(fingerprint: DiagnosticExecutionFingerprint): DiagnosticExecutionFingerprint {
  return {
    physicalDeviceKey: fingerprint.physicalDeviceKey ?? null,
    deviceIdentityBasis: fingerprint.deviceIdentityBasis,
    profileId: fingerprint.profileId ?? null,
    testId: fingerprint.testId, diagnosticId: fingerprint.diagnosticId,
    parameterKey: fingerprint.parameterKey,
    programCrc32: fingerprint.programCrc32 ?? null,
    rasterStrategy: fingerprint.rasterStrategy ?? null,
    key: fingerprint.key,
  };
}

function sanitizePanelProgram(state: PanelProgramState | undefined): PanelProgramState {
  if (!state) return UNKNOWN_PANEL_PROGRAM;
  return {
    certainty: state.certainty, kind: state.kind,
    fingerprint: state.fingerprint ? sanitizeFingerprint(state.fingerprint) : null,
    label: String(state.label), at: state.at ?? null,
    uncertaintyReason: state.uncertaintyReason ?? null,
  };
}

function numberRecord(source: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function loadStore(storage?: KeyValueStorage): StoreShape {
  const empty: StoreShape = { schemaVersion: SCHEMA_VERSION, investigations: [] };
  try {
    const raw = new BrowserStorageRepository(storage).get(KEY);
    if (!raw) return empty;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    // v1 records carry no orchestration and no attempts. They are read, not
    // rejected: an investigation someone saved last week must still open.
    if (version !== 1 && version !== SCHEMA_VERSION) return empty;
    const entries = (value as { investigations?: unknown }).investigations;
    if (!Array.isArray(entries)) return empty;
    return {
      schemaVersion: SCHEMA_VERSION,
      investigations: entries.filter(isStoredInvestigation).map((entry) => ({
        savedAt: entry.savedAt,
        investigation: migrateInvestigation(entry.investigation),
      })),
    };
  } catch {
    return empty;
  }
}

/**
 * Bring a stored investigation up to the current shape.
 *
 * Migration is additive and never trusts what it reads for authority: a
 * missing orchestration becomes an empty one, and a restored panel-program
 * belief is always downgraded to "unknown" no matter what the record claims.
 * A saved file asserting that a diagnostic is live on someone's display would
 * otherwise be able to suppress a legitimate transmission.
 */
function migrateInvestigation(investigation: Investigation): Investigation {
  const stored = investigation.orchestration;
  const orchestration = stored && typeof stored === "object" ? sanitizeOrchestration({
    experiments: Array.isArray(stored.experiments) ? stored.experiments.filter(isExperimentRun) : [],
    transfers: Array.isArray(stored.transfers) ? stored.transfers.filter(isTransferRecord) : [],
    panelProgram: isPanelProgram(stored.panelProgram) ? stored.panelProgram : UNKNOWN_PANEL_PROGRAM,
    reopened: Array.isArray(stored.reopened) ? stored.reopened.filter(isReopened) : [],
    recommendationTrail: Array.isArray(stored.recommendationTrail) ? stored.recommendationTrail.filter(isTrailEntry) : [],
    cycleVerdict: stored.cycleVerdict ?? { cycling: false, testIds: [], detail: null },
  }) : emptyOrchestration();
  return {
    ...investigation,
    deviceBinding: investigation.deviceBinding ?? null,
    completedTests: (investigation.completedTests ?? []).map((test) => ({
      ...test,
      ...(Array.isArray(test.attempts) ? { attempts: test.attempts.filter(isObservationAttempt).map(sanitizeObservationAttempt) } : {}),
    })),
    orchestration: {
      ...orchestration,
      panelProgram: invalidatePanelProgram(
        orchestration.panelProgram,
        "Restored from local history; what the display is showing now was not observed.",
      ),
    },
  };
}

const TRANSFER_REASONS: readonly string[] = [
  "initial-experiment", "explicit-retry-missed-observation", "explicit-measure-again",
  "confirmation-run", "controlled-variant", "explicit-reopen",
];
const ATTEMPT_VALIDITIES: readonly string[] = ["valid", "missed-t1", "missed-t2", "accidental-tap", "user-restarted", "incomplete", "transfer-failed"];
const FAILURE_KINDS: readonly string[] = ["transfer-failed", "human-missed", "user-restarted", "observation-incomplete"];
const RESOLUTIONS: readonly string[] = ["settled", "retryable-incomplete", "invalid", "abandoned"];
const MARK_SOURCES: readonly string[] = ["automatic-transport", "human-observed", "derived-human-observed"];
const PANEL_KINDS: readonly string[] = ["guided-diagnostic", "ordinary-content", "validation", "none"];
const ORIGINS: readonly string[] = ["automatic-recommendation", "explicit-retry", "explicit-reopen"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFingerprint(value: unknown): value is DiagnosticExecutionFingerprint {
  return isObject(value) && typeof value.key === "string" && typeof value.testId === "string"
    && typeof value.diagnosticId === "string" && typeof value.parameterKey === "string"
    && (value.deviceIdentityBasis === "browser-authorized-device" || value.deviceIdentityBasis === "fingerprint-shape" || value.deviceIdentityBasis === "unidentified");
}

function isObservationAttempt(value: unknown): value is ObservationAttempt {
  return isObject(value) && typeof value.attemptNumber === "number"
    && ATTEMPT_VALIDITIES.includes(value.validity as AttemptValidity)
    && Array.isArray(value.marks) && Array.isArray(value.values)
    && (value.marks as unknown[]).every((mark) => isObject(mark) && MARK_SOURCES.includes(mark.source as TimingMarkSource))
    && (value.values as unknown[]).every((entry) => isValidObservationValue(entry as ObservationValue));
}

function isExperimentAttempt(value: unknown): value is ExperimentAttempt {
  return isObject(value) && typeof value.attemptId === "string" && typeof value.attemptNumber === "number"
    && TRANSFER_REASONS.includes(value.reason as TransferReason)
    && (value.validity === "valid" || value.validity === "invalid" || value.validity === "in-progress")
    && (value.failureKind == null || FAILURE_KINDS.includes(value.failureKind as AttemptFailureKind))
    && Array.isArray(value.transferIds) && Array.isArray(value.observations)
    && (value.timing == null || isObservationAttempt(value.timing));
}

function isExperimentRun(value: unknown): value is ExperimentRun {
  return isObject(value) && typeof value.experimentRunId === "string" && typeof value.definitionId === "string"
    && typeof value.title === "string" && isFingerprint(value.fingerprint)
    && (value.resolution == null || RESOLUTIONS.includes(value.resolution as ExperimentResolution))
    && Array.isArray(value.attempts) && (value.attempts as unknown[]).every(isExperimentAttempt);
}

function isTransferRecord(value: unknown): value is TransferRecord {
  return isObject(value) && typeof value.transferId === "string" && typeof value.attemptId === "string"
    && TRANSFER_REASONS.includes(value.reason as TransferReason) && isFingerprint(value.fingerprint)
    && Array.isArray(value.transactionIds);
}

function isPanelProgram(value: unknown): value is PanelProgramState {
  return isObject(value) && PANEL_KINDS.includes(value.kind as PanelProgramKind)
    && (value.certainty === "known-active" || value.certainty === "known-replaced" || value.certainty === "unknown")
    && (value.fingerprint == null || isFingerprint(value.fingerprint));
}

function isReopened(value: unknown): value is ReopenedExperiment {
  return isObject(value) && typeof value.testId === "string" && typeof value.reason === "string";
}

function isTrailEntry(value: unknown): value is RecommendationTrailEntry {
  return isObject(value) && typeof value.testId === "string" && typeof value.evidenceCount === "number"
    && (value.origin == null || ORIGINS.includes(value.origin as RecommendationOrigin));
}

function isStoredInvestigation(value: unknown): value is StoredInvestigation {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { savedAt?: unknown; investigation?: unknown };
  if (typeof entry.savedAt !== "string" || typeof entry.investigation !== "object" || entry.investigation === null) return false;
  const investigation = entry.investigation as Record<string, unknown>;
  return typeof investigation.id === "string" && typeof investigation.goal === "object"
    && Array.isArray(investigation.completedTests) && Array.isArray(investigation.claimEvidence)
    && (investigation.status === "active" || investigation.status === "stopped");
}
