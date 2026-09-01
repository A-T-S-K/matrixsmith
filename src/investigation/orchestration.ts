import type { ObservationValue } from "./observations";
import type { ObservationAttempt } from "./timing";
import type { GuidedTestStatus } from "./investigation";

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
 *     CorePlan            — a bounded, numbered set of milestones
 *       ExperimentRun     — one experiment: a definition plus its parameters
 *         ObservationAttempt — one human attempt at observing it
 *           TransferRecord   — one transmission, with a reason
 *
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
 * Identity of one concrete diagnostic execution.
 *
 * Two transmissions share a fingerprint when they are genuinely the same
 * experiment on the same device. CRC alone is not identity — the same bytes
 * can belong to different experiments, and the same experiment can be a
 * legitimate repeat — so the fingerprint carries the semantic inputs and
 * keeps the CRC as corroborating evidence.
 */
export interface DiagnosticExecutionFingerprint {
  readonly deviceBindingId: string | null;
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
  readonly deviceBindingId: string | null;
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
  return {
    deviceBindingId: input.deviceBindingId,
    testId: input.testId,
    diagnosticId: input.diagnosticId,
    parameterKey,
    programCrc32: input.programCrc32 ?? null,
    rasterStrategy: input.rasterStrategy ?? null,
    key: [input.deviceBindingId ?? "unbound", input.testId, input.diagnosticId, parameterKey, input.rasterStrategy ?? "-"].join("|"),
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
}

/**
 * One human attempt at observing an experiment.
 *
 * Attempts are numbered within their experiment and never advance the
 * investigation: three attempts at Test 2 leave the user on Test 2.
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
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly attempts: readonly ExperimentAttempt[];
  readonly conclusion: string | null;
  /** Set when a completed experiment was deliberately run again. */
  readonly reopenReason: string | null;
}

export function newId(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${value}`;
}

/** Attempts that produced usable observations. */
export function validExperimentAttempts(run: ExperimentRun): readonly ExperimentAttempt[] {
  return run.attempts.filter((attempt) => attempt.validity === "valid");
}

export interface TransferClassification {
  readonly total: number;
  readonly byReason: Readonly<Record<TransferReason, number>>;
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
  // assert novelty the bytes contradict.
  const unclassified = [...groups.values()].reduce((total, group) => {
    const novelClaims = group.transfers.filter((transfer) => !isRepeatTransfer(transfer.reason)).length;
    return total + Math.max(0, novelClaims - 1);
  }, 0);
  return { total: transfers.length, byReason, repeatedExecutions: repeated, unclassifiedDuplicates: unclassified };
}
