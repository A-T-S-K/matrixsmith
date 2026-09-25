import { formatDuration, type ObservationValue } from "./observations";

/**
 * Human-observed physical timing.
 *
 * MatrixSmith measures T0 — the final host-accepted program write — from the
 * transport, so it is precise within the browser/transport measurement model.
 * Everything after that is a person watching a physical LED panel and tapping
 * a phone: T1 (full raster visible) and T2 (movement began) are HUMAN
 * observations carrying human reaction delay. The exact timestamps are kept
 * for forensic output, but nothing in the product may present them as
 * instrument-grade measurements of the hardware.
 *
 * Because a human can mistime or miss an event entirely, one guided test run
 * holds a sequence of ATTEMPTS. Only a `valid` attempt may establish a
 * timing-dependent claim; invalid attempts stay in the evidence record as
 * investigation metadata and never become negative hardware evidence.
 */

export type TimingMarkSource =
  "automatic-transport" | "human-observed" | "derived-human-observed";

export interface PhysicalTimingMark {
  /** Timeline phase this mark closes (e.g. "visible", "movement"). */
  readonly event: string;
  readonly timestamp: string;
  readonly source: TimingMarkSource;
  /** Elapsed from T0 in milliseconds. */
  readonly elapsedMs: number;
  /** Observation field the elapsed value was written to, when there is one. */
  readonly fieldId?: string;
}

/**
 * Why an attempt cannot establish a claim. `missed-t1`/`missed-t2` mean the
 * measurement attempt is invalid — NOT that the hardware failed to do the
 * thing. `user-restarted` marks an attempt superseded by a retry.
 */
export type AttemptValidity =
  | "valid"
  | "missed-t1"
  | "missed-t2"
  | "accidental-tap"
  | "user-restarted"
  | "incomplete"
  /** The diagnostic never reached the panel; nothing physical was observed. */
  | "transfer-failed";

export const ATTEMPT_INVALIDATION_LABELS: Readonly<
  Record<Exclude<AttemptValidity, "valid">, string>
> = Object.freeze({
  "missed-t1": "The moment the full image appeared was missed",
  "missed-t2": "The moment movement began was missed",
  "accidental-tap": "A timing control was tapped by accident",
  "user-restarted": "Superseded by a later attempt of the same experiment",
  incomplete: "The observation ended before the timeline finished",
  // Emphatically not a human failure: the transfer did not land, so there
  // was never anything on the panel to observe.
  "transfer-failed":
    "The diagnostic transfer failed before anything could be observed",
});

export interface ObservationAttempt {
  readonly attemptNumber: number;
  /** The exact experiment parameters. A retry must not change these. */
  readonly parameters: Readonly<Record<string, number>>;
  /** Final host-accepted write, measured automatically. Null before transfer. */
  readonly t0: string | null;
  readonly marks: readonly PhysicalTimingMark[];
  /** Observation values captured during this attempt. */
  readonly values: readonly ObservationValue[];
  readonly validity: AttemptValidity;
  readonly invalidationReason: string | null;
  readonly note: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export function isValidAttempt(attempt: ObservationAttempt): boolean {
  return attempt.validity === "valid";
}

export function validAttempts(
  attempts: readonly ObservationAttempt[],
): readonly ObservationAttempt[] {
  return attempts.filter(isValidAttempt);
}

/** Elapsed for a phase within an attempt, or null when it was never marked. */
export function markElapsed(
  attempt: ObservationAttempt,
  event: string,
): number | null {
  const mark = attempt.marks.find((entry) => entry.event === event);
  return mark ? mark.elapsedMs : null;
}

/**
 * Human-observed durations are reported with approximate language. A tap
 * carries reaction delay, so "~3.2 s" is honest where "3.237 seconds" is not.
 */
export function approximateSeconds(milliseconds: number): string {
  return `~${(milliseconds / 1000).toFixed(1)} s`;
}

export function describeMarkSource(source: TimingMarkSource): string {
  switch (source) {
    case "automatic-transport":
      return "automatically measured";
    case "human-observed":
      return "human observed";
    case "derived-human-observed":
      return "derived from human-observed marks";
  }
}

export interface AttemptAggregate {
  readonly count: number;
  readonly values: readonly number[];
  readonly minMs: number;
  readonly maxMs: number;
  /** Median of the valid observations; the representative value. */
  readonly representativeMs: number;
}

/**
 * Summarize repeated human observations of the same quantity. Two or three
 * taps do not justify statistics beyond a range and a median, and pretending
 * otherwise would re-introduce the false precision this model exists to
 * avoid.
 */
export function aggregateAttemptDurations(
  durations: readonly number[],
): AttemptAggregate | null {
  const values = durations
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  const representativeMs =
    values.length % 2 === 1
      ? values[middle]!
      : Math.round((values[middle - 1]! + values[middle]!) / 2);
  return {
    count: values.length,
    values,
    minMs: values[0]!,
    maxMs: values[values.length - 1]!,
    representativeMs,
  };
}

export function describeAggregate(aggregate: AttemptAggregate): string {
  if (aggregate.count === 1)
    return approximateSeconds(aggregate.representativeMs);
  if (aggregate.minMs === aggregate.maxMs)
    return `${approximateSeconds(aggregate.representativeMs)} across ${aggregate.count} attempts`;
  return `${approximateSeconds(aggregate.minMs)}–${approximateSeconds(aggregate.maxMs)} across ${aggregate.count} attempts (representative ${approximateSeconds(aggregate.representativeMs)})`;
}

/** One attempt rendered for a report, keeping exact timestamps available. */
export function describeAttempt(
  attempt: ObservationAttempt,
): readonly string[] {
  const lines: string[] = [];
  lines.push(
    `Attempt ${attempt.attemptNumber} — ${attempt.validity === "valid" ? "valid" : "INVALID"}`,
  );
  if (attempt.validity !== "valid") {
    lines.push(
      `  Reason: ${attempt.invalidationReason ?? ATTEMPT_INVALIDATION_LABELS[attempt.validity]}`,
    );
    lines.push("  Excluded from conclusions.");
  }
  const parameters = Object.entries(attempt.parameters);
  if (parameters.length > 0)
    lines.push(
      `  Parameters: ${parameters.map(([key, value]) => `${key}=${value}`).join(", ")}`,
    );
  lines.push(
    attempt.t0
      ? `  T0 upload complete: ${attempt.t0} (automatically measured)`
      : "  T0: not reached",
  );
  for (const mark of attempt.marks) {
    lines.push(
      `  ${mark.event}: +${formatDuration(mark.elapsedMs)} (${describeMarkSource(mark.source)})`,
    );
  }
  if (attempt.note) lines.push(`  Note: ${attempt.note}`);
  return lines;
}
