import type { Persistence, RiskClass } from "../core/risk";
import type { ValidationStatus } from "../core/evidence";

/**
 * Structured hardware-validation model. A validation workflow transmits an
 * experimental capability once, then asks the user deterministic questions
 * about what the physical panel showed. The answers become session-scoped
 * evidence: they prove the capability on this exact device in this exact
 * session without silently rewriting project/profile metadata.
 */

export type ValidationAreaId =
  | "static-frame"
  | "pixel-orientation"
  | "color-encoding"
  | "stored-programs"
  | "text-rendering"
  | "animation"
  | "gif"
  | "persistence";

export interface ValidationQuestion {
  readonly id: string;
  readonly prompt: string;
  /** The areas a "yes" answer validates for this session. */
  readonly validates: readonly ValidationAreaId[];
  /** Whether a "no" answer fails the whole workflow (vs. recording a partial finding). */
  readonly required: boolean;
}

export interface ValidationAnswer {
  readonly questionId: string;
  readonly answer: "yes" | "no" | "unsure";
  readonly note?: string;
}

export type SessionValidationStatus = "passed" | "failed" | "inconclusive";

export interface SessionValidationResult {
  readonly id: string;
  readonly workflowId: string;
  readonly recordedAt: string;
  readonly profileId: string | null;
  readonly status: SessionValidationStatus;
  /** Areas the recorded answers validate on this physical session. */
  readonly validatedAreas: readonly ValidationAreaId[];
  /** Areas an explicit "no" answer rejected on this physical session. */
  readonly rejectedAreas: readonly ValidationAreaId[];
  readonly answers: readonly ValidationAnswer[];
  readonly transactionIds: readonly string[];
  readonly findings: readonly string[];
}

export interface ContentValidationWorkflow {
  readonly id: string;
  readonly label: string;
  readonly driverId: string;
  readonly risk: RiskClass;
  readonly persistence: Persistence;
  readonly validation: ValidationStatus;
  /** Exact consequence text shown before the user confirms the transmission. */
  readonly consequence: string;
  readonly questions: readonly ValidationQuestion[];
  /** Areas that pass only when every required question is answered "yes". */
  readonly primaryAreas: readonly ValidationAreaId[];
}

export const STATIC_FRAME_VALIDATION: ContentValidationWorkflow = Object.freeze<ContentValidationWorkflow>({
  id: "coolledux-validate-static-frame",
  label: "Validate static framebuffer",
  driverId: "coolledux",
  risk: "persistent",
  persistence: "persistent",
  validation: "experimental",
  consequence:
    "This replaces the currently stored display program with a diagnostic image. "
    + "The device's hardware reset path is known to restore its factory/default content, "
    + "but automatic content restoration has not been verified.",
  questions: [
    { id: "corners", prompt: "Are the corners in the expected positions (red top-left, green top-right, blue bottom-left, yellow bottom-right)?", validates: ["pixel-orientation"], required: true },
    { id: "colors", prompt: "Are the colors correct (including the white center)?", validates: ["color-encoding"], required: true },
    { id: "seams", prompt: "Is the image free of visible tile seams or misaligned 8-column strips?", validates: ["static-frame"], required: true },
    { id: "canvas", prompt: "Is the full 32×16 canvas used, with no cropped or shifted region?", validates: ["static-frame"], required: true },
    { id: "background", prompt: "Is the background correct (off/very dim, not bright white)?", validates: ["color-encoding"], required: true },
  ],
  primaryAreas: ["static-frame", "stored-programs"],
});

export const ANIMATION_VALIDATION: ContentValidationWorkflow = Object.freeze<ContentValidationWorkflow>({
  id: "coolledux-validate-animation",
  label: "Validate animation",
  driverId: "coolledux",
  risk: "persistent",
  persistence: "persistent",
  validation: "experimental",
  consequence:
    "This replaces the currently stored display program with a two-frame diagnostic animation. "
    + "The device's hardware reset path is known to restore its factory/default content, "
    + "but automatic content restoration has not been verified.",
  questions: [
    { id: "frames", prompt: "Do two distinct frames alternate (corner pattern, then inverted colors)?", validates: ["animation"], required: true },
    { id: "timing", prompt: "Does each frame hold for roughly one second?", validates: ["animation"], required: true },
    { id: "tiles", prompt: "Do all tiles change frames together, with no strip lagging behind?", validates: ["animation"], required: true },
    // Autonomous looping is NOT power-cycle persistence: this question only
    // ever validates the animation area itself.
    { id: "loop", prompt: "Does the animation keep looping on its own without further Bluetooth traffic?", validates: ["animation"], required: false },
  ],
  primaryAreas: ["animation"],
});

export const CONTENT_VALIDATION_WORKFLOWS: readonly ContentValidationWorkflow[] = Object.freeze([
  STATIC_FRAME_VALIDATION,
  ANIMATION_VALIDATION,
]);

export function evaluateValidationAnswers(
  workflow: ContentValidationWorkflow,
  answers: readonly ValidationAnswer[],
): { status: SessionValidationStatus; validatedAreas: ValidationAreaId[]; rejectedAreas: ValidationAreaId[]; findings: string[] } {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const validated = new Set<ValidationAreaId>();
  const rejected = new Set<ValidationAreaId>();
  const findings: string[] = [];
  let requiredFailed = false;
  let unanswered = false;
  for (const question of workflow.questions) {
    const answer = byQuestion.get(question.id);
    if (!answer || answer.answer === "unsure") {
      unanswered = true;
      findings.push(`${question.id}: not confirmed${answer?.note ? ` — ${answer.note}` : ""}.`);
      continue;
    }
    if (answer.answer === "yes") {
      for (const area of question.validates) validated.add(area);
      findings.push(`${question.id}: confirmed${answer.note ? ` — ${answer.note}` : ""}.`);
    } else {
      for (const area of question.validates) rejected.add(area);
      if (question.required) requiredFailed = true;
      findings.push(`${question.id}: FAILED${answer.note ? ` — ${answer.note}` : ""}.`);
    }
  }
  const status: SessionValidationStatus = requiredFailed ? "failed" : unanswered ? "inconclusive" : "passed";
  if (status === "passed") for (const area of workflow.primaryAreas) validated.add(area);
  if (status === "failed") for (const area of workflow.primaryAreas) rejected.add(area);
  for (const area of rejected) validated.delete(area);
  return { status, validatedAreas: [...validated], rejectedAreas: [...rejected], findings };
}

export function sessionValidationId(): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `validation:${value}`;
}
