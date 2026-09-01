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

export type ObservationFieldSpec =
  | { readonly kind: "boolean"; readonly id: string; readonly prompt: string; readonly required?: boolean }
  | { readonly kind: "choice"; readonly id: string; readonly prompt: string; readonly options: readonly ObservationChoiceOption[]; readonly allowOther?: boolean; readonly required?: boolean }
  | { readonly kind: "duration"; readonly id: string; readonly prompt: string; readonly required?: boolean }
  | { readonly kind: "number"; readonly id: string; readonly prompt: string; readonly unit?: string; readonly required?: boolean }
  | { readonly kind: "note"; readonly id: string; readonly prompt: string };

export type ObservationValue =
  | { readonly kind: "boolean"; readonly fieldId: string; readonly value: "yes" | "no" | "unsure"; readonly note?: string }
  | { readonly kind: "choice"; readonly fieldId: string; readonly optionId: string; readonly otherText?: string; readonly note?: string }
  | {
    readonly kind: "duration"; readonly fieldId: string; readonly milliseconds: number;
    /** MatrixSmith-measured timers are evidence-grade; user estimates are labeled as such. */
    readonly measuredBy: "matrixsmith-timer" | "user-estimate";
    readonly note?: string;
  }
  | { readonly kind: "number"; readonly fieldId: string; readonly value: number; readonly note?: string }
  | { readonly kind: "note"; readonly fieldId: string; readonly text: string };

export function observationValueSummary(spec: ObservationFieldSpec | undefined, value: ObservationValue): string {
  const prompt = spec?.prompt ?? value.fieldId;
  switch (value.kind) {
    case "boolean": return `${prompt}: ${value.value}${value.note ? ` — ${value.note}` : ""}`;
    case "choice": {
      const option = spec?.kind === "choice" ? spec.options.find(({ id }) => id === value.optionId)?.label : undefined;
      const label = value.optionId === "other" && value.otherText ? `other — ${value.otherText}` : option ?? value.optionId;
      return `${prompt}: ${label}${value.note ? ` — ${value.note}` : ""}`;
    }
    case "duration": return `${prompt}: ${formatDuration(value.milliseconds)} (${value.measuredBy === "matrixsmith-timer" ? "measured by MatrixSmith" : "user estimate"})${value.note ? ` — ${value.note}` : ""}`;
    case "number": return `${prompt}: ${value.value}${spec?.kind === "number" && spec.unit ? ` ${spec.unit}` : ""}${value.note ? ` — ${value.note}` : ""}`;
    case "note": return `${prompt}: ${value.text}`;
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
export function observationsComplete(specs: readonly ObservationFieldSpec[], values: readonly ObservationValue[]): boolean {
  const byField = new Map(values.map((value) => [value.fieldId, value]));
  return specs.every((spec) => spec.kind === "note" || !(spec.required ?? true) || byField.has(spec.id));
}

export function isValidObservationValue(value: unknown): value is ObservationValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.fieldId !== "string") return false;
  switch (record.kind) {
    case "boolean": return record.value === "yes" || record.value === "no" || record.value === "unsure";
    case "choice": return typeof record.optionId === "string";
    case "duration": return typeof record.milliseconds === "number" && Number.isFinite(record.milliseconds)
      && (record.measuredBy === "matrixsmith-timer" || record.measuredBy === "user-estimate");
    case "number": return typeof record.value === "number" && Number.isFinite(record.value);
    case "note": return typeof record.text === "string";
    default: return false;
  }
}
