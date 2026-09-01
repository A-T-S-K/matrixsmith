import type { ClaimEvidence, ClaimId, ClaimState } from "./claims";
import { resolveClaims } from "./claims";
import type { ObservationValue } from "./observations";

/**
 * First-class investigation of one physical device. Guided development,
 * symptom-driven troubleshooting, reports, and the advanced workbench all
 * read and write this single object — there are no parallel interpretations
 * of the same session.
 */

export type InvestigationGoalKind = "develop" | "troubleshoot";

export type SymptomId =
  | "cannot-find-display"
  | "wont-connect"
  | "disconnects"
  | "content-wont-send"
  | "image-looks-wrong"
  | "colors-look-wrong"
  | "content-moves-unexpectedly"
  | "animation-looks-wrong"
  | "brightness-problem"
  | "display-frozen"
  | "other";

export interface InvestigationGoal {
  readonly kind: InvestigationGoalKind;
  readonly symptomId?: SymptomId;
  readonly description: string;
}

export type GuidedTestStatus = "passed" | "failed" | "partial" | "inconclusive";

export interface CompletedGuidedTest {
  readonly testId: string;
  readonly title: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: GuidedTestStatus;
  readonly observations: readonly ObservationValue[];
  readonly established: readonly string[];
  readonly rejected: readonly string[];
  readonly unknowns: readonly string[];
  readonly summary: string;
  readonly transactionIds: readonly string[];
  /** Variant parameters actually used (e.g. stayTime), for reports. */
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface Investigation {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly profileId: string | null;
  readonly deviceName: string | null;
  readonly goal: InvestigationGoal;
  readonly status: "active" | "stopped";
  readonly completedTests: readonly CompletedGuidedTest[];
  /** Session/imported claim evidence accumulated by this investigation. */
  readonly claimEvidence: readonly ClaimEvidence[];
  readonly notes: readonly string[];
}

export function investigationId(): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `investigation:${value}`;
}

export function createInvestigation(input: { profileId: string | null; deviceName: string | null; goal: InvestigationGoal; now?: string }): Investigation {
  const now = input.now ?? new Date().toISOString();
  return {
    id: investigationId(), createdAt: now, updatedAt: now,
    profileId: input.profileId, deviceName: input.deviceName,
    goal: input.goal, status: "active", completedTests: [], claimEvidence: [], notes: [],
  };
}

export function recordCompletedTest(investigation: Investigation, test: CompletedGuidedTest, evidence: readonly ClaimEvidence[], now = new Date().toISOString()): Investigation {
  return {
    ...investigation, updatedAt: now,
    completedTests: [...investigation.completedTests, test],
    claimEvidence: [...investigation.claimEvidence, ...evidence],
  };
}

export function addClaimEvidence(investigation: Investigation, evidence: readonly ClaimEvidence[], now = new Date().toISOString()): Investigation {
  if (evidence.length === 0) return investigation;
  return { ...investigation, updatedAt: now, claimEvidence: [...investigation.claimEvidence, ...evidence] };
}

export function stopInvestigation(investigation: Investigation, now = new Date().toISOString()): Investigation {
  return { ...investigation, status: "stopped", updatedAt: now };
}

export function resumeInvestigation(investigation: Investigation, now = new Date().toISOString()): Investigation {
  return { ...investigation, status: "active", updatedAt: now };
}

/**
 * Resolve the investigation's claims against a wider evidence pool (built-in
 * profile facts, source references, imported evidence). Investigation-scoped
 * evidence is combined with — never substituted for — the base evidence.
 */
export function investigationClaims(investigation: Investigation, baseEvidence: readonly ClaimEvidence[] = []): readonly ClaimState[] {
  return resolveClaims([...baseEvidence, ...investigation.claimEvidence]);
}

export function hasCompletedTest(investigation: Investigation, testId: string): boolean {
  return investigation.completedTests.some((test) => test.testId === testId);
}

export function latestTestResult(investigation: Investigation, testId: string): CompletedGuidedTest | null {
  for (let index = investigation.completedTests.length - 1; index >= 0; index -= 1) {
    const test = investigation.completedTests[index];
    if (test && test.testId === testId) return test;
  }
  return null;
}

export const SYMPTOM_LABELS: Readonly<Record<SymptomId, string>> = Object.freeze({
  "cannot-find-display": "My display cannot be found",
  "wont-connect": "My display won't connect",
  disconnects: "My display keeps disconnecting",
  "content-wont-send": "Text or image won't send",
  "image-looks-wrong": "The image looks wrong",
  "colors-look-wrong": "The colors look wrong",
  "content-moves-unexpectedly": "Content moves unexpectedly",
  "animation-looks-wrong": "The animation behaves incorrectly",
  "brightness-problem": "Brightness problem",
  "display-frozen": "The display appears frozen",
  other: "Something else",
});

/** Claims a symptom most directly depends on; the recommendation engine biases toward discriminators for these. */
export const SYMPTOM_FOCUS_CLAIMS: Readonly<Record<SymptomId, readonly ClaimId[]>> = Object.freeze({
  "cannot-find-display": ["transport.bluetooth"],
  "wont-connect": ["transport.bluetooth"],
  disconnects: ["transport.bluetooth"],
  "content-wont-send": ["stored-program.upload", "static.strategy"],
  "image-looks-wrong": ["raster.tiling", "raster.orientation", "graffiti.initial-render"],
  "colors-look-wrong": ["pixel.channel-map", "graffiti.color-mapping", "pixel.color-calibration"],
  "content-moves-unexpectedly": ["graffiti.playback-stability", "static.strategy"],
  "animation-looks-wrong": ["animation.frames", "animation.timing", "animation.tile-sync"],
  "brightness-problem": ["brightness.control"],
  "display-frozen": ["device-info.query", "recovery.manual-reset"],
  other: [],
});
