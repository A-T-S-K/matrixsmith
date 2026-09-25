/**
 * Structured physical-observation model for guided tests. Only the field
 * kinds guided tests actually need exist here — this is deliberately not a
 * generic form-builder framework. Every value serializes to plain JSON for
 * bundles, reports, and local investigation history.
 */

export interface ObservationChoiceOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Fields common to every observation field kind.
 *
 * `regionId` is the link that makes spatial observation work: a question that
 * refers to a place on the panel names the region instead of describing it in
 * prose, and the UI uses that link to highlight the right zone, label it, and
 * expose the region/question relationship to assistive technology.
 */
interface ObservationFieldCommon {
  readonly id: string;
  readonly prompt: string;
  readonly required?: boolean;
  /** Diagnostic region this question is about, when it is about a place. */
  readonly regionId?: string;
}

export type ObservationFieldSpec =
  | (ObservationFieldCommon & { readonly kind: "boolean" })
  | (ObservationFieldCommon & {
      readonly kind: "choice";
      readonly options: readonly ObservationChoiceOption[];
      readonly allowOther?: boolean;
    })
  | (ObservationFieldCommon & { readonly kind: "duration" })
  | (ObservationFieldCommon & {
      readonly kind: "number";
      readonly unit?: string;
    })
  | (ObservationFieldCommon & { readonly kind: "note" });

export type ObservationValue =
  | {
      readonly kind: "boolean";
      readonly fieldId: string;
      readonly value: "yes" | "no" | "unsure";
      readonly note?: string;
    }
  | {
      readonly kind: "choice";
      readonly fieldId: string;
      readonly optionId: string;
      readonly otherText?: string;
      readonly note?: string;
    }
  | {
      readonly kind: "duration";
      readonly fieldId: string;
      readonly milliseconds: number;
      /** MatrixSmith-measured timers are evidence-grade; user estimates are labeled as such. */
      readonly measuredBy: "matrixsmith-timer" | "user-estimate";
      readonly note?: string;
    }
  | {
      readonly kind: "number";
      readonly fieldId: string;
      readonly value: number;
      readonly note?: string;
    }
  | { readonly kind: "note"; readonly fieldId: string; readonly text: string };

/**
 * One observation as a report line.
 *
 * `regionLabel` matters: prompts for spatial questions are deliberately short
 * ("What color is this zone?") because the UI shows which zone. A report has
 * no map, so the human zone name is prepended — otherwise every zone in an
 * eleven-zone test would read identically.
 */
export function observationValueSummary(
  spec: ObservationFieldSpec | undefined,
  value: ObservationValue,
  regionLabel?: string,
): string {
  const basePrompt = spec?.prompt ?? value.fieldId;
  const prompt = regionLabel ? `${regionLabel} — ${basePrompt}` : basePrompt;
  switch (value.kind) {
    case "boolean":
      return `${prompt}: ${value.value}${value.note ? ` — ${value.note}` : ""}`;
    case "choice": {
      const option =
        spec?.kind === "choice"
          ? spec.options.find(({ id }) => id === value.optionId)?.label
          : undefined;
      const label =
        value.optionId === "other" && value.otherText
          ? `other — ${value.otherText}`
          : (option ?? value.optionId);
      return `${prompt}: ${label}${value.note ? ` — ${value.note}` : ""}`;
    }
    case "duration":
      return `${prompt}: ${formatDuration(value.milliseconds)} (${value.measuredBy === "matrixsmith-timer" ? "measured by MatrixSmith" : "user estimate"})${value.note ? ` — ${value.note}` : ""}`;
    case "number":
      return `${prompt}: ${value.value}${spec?.kind === "number" && spec.unit ? ` ${spec.unit}` : ""}${value.note ? ` — ${value.note}` : ""}`;
    case "note":
      return `${prompt}: ${value.text}`;
  }
}

export function formatDuration(milliseconds: number): string {
  const totalTenths = Math.round(milliseconds / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/** Answered when required, or explicitly optional. Notes are never required. */
export function observationsComplete(
  specs: readonly ObservationFieldSpec[],
  values: readonly ObservationValue[],
): boolean {
  const byField = new Map(values.map((value) => [value.fieldId, value]));
  return specs.every(
    (spec) =>
      spec.kind === "note" || !(spec.required ?? true) || byField.has(spec.id),
  );
}

/**
 * Domain-layer validation of a full observation submission. The UI performs
 * its own completeness checks, but the controller never trusts them: any
 * caller reaching the domain API with missing required fields, mismatched
 * kinds, unknown fields, invalid choice options, an empty "other", or
 * incoherent numbers is rejected before evidence is produced.
 */
export function validateObservations(
  specs: readonly ObservationFieldSpec[],
  values: readonly ObservationValue[],
): string[] {
  const errors: string[] = [];
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  const seen = new Set<string>();
  for (const value of values) {
    if (!isValidObservationValue(value)) {
      errors.push(
        `Structurally invalid observation value for "${(value as { fieldId?: string })?.fieldId ?? "?"}".`,
      );
      continue;
    }
    if (seen.has(value.fieldId))
      errors.push(`Duplicate observation for field "${value.fieldId}".`);
    seen.add(value.fieldId);
    const spec = specById.get(value.fieldId);
    if (!spec) {
      errors.push(`Unknown observation field "${value.fieldId}".`);
      continue;
    }
    if (spec.kind !== value.kind) {
      errors.push(
        `Field "${value.fieldId}" expects kind "${spec.kind}" but received "${value.kind}".`,
      );
      continue;
    }
    if (value.kind === "choice" && spec.kind === "choice") {
      const known = spec.options.some((option) => option.id === value.optionId);
      if (!known && !(value.optionId === "other" && spec.allowOther))
        errors.push(
          `Field "${value.fieldId}" has no option "${value.optionId}".`,
        );
      if (value.optionId === "other" && !(value.otherText ?? "").trim())
        errors.push(
          `Field "${value.fieldId}" chose "other" without describing what was seen.`,
        );
    }
    if (
      value.kind === "duration" &&
      (value.milliseconds < 0 || !Number.isFinite(value.milliseconds))
    )
      errors.push(`Field "${value.fieldId}" has an invalid duration.`);
    if (value.kind === "number" && !Number.isFinite(value.value))
      errors.push(`Field "${value.fieldId}" has a non-finite number.`);
  }
  for (const spec of specs) {
    if (spec.kind === "note" || !(spec.required ?? true)) continue;
    if (!seen.has(spec.id))
      errors.push(`Required observation "${spec.id}" is missing.`);
  }
  return errors;
}

export function isValidObservationValue(
  value: unknown,
): value is ObservationValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.fieldId !== "string") return false;
  switch (record.kind) {
    case "boolean":
      return (
        record.value === "yes" ||
        record.value === "no" ||
        record.value === "unsure"
      );
    case "choice":
      return typeof record.optionId === "string";
    case "duration":
      return (
        typeof record.milliseconds === "number" &&
        Number.isFinite(record.milliseconds) &&
        (record.measuredBy === "matrixsmith-timer" ||
          record.measuredBy === "user-estimate")
      );
    case "number":
      return typeof record.value === "number" && Number.isFinite(record.value);
    case "note":
      return typeof record.text === "string";
    default:
      return false;
  }
}
