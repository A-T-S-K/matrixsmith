import type { ClaimState } from "../../investigation/claims";
import type { CompletedGuidedTest } from "../../investigation/investigation";
import type {
  GuidedTestAbout,
  GuidedTestTimer,
  TimelinePhase,
} from "../../investigation/tests";
import type {
  ObservationFieldSpec,
  ObservationValue,
} from "../../investigation/observations";
import type {
  AttemptValidity,
  PhysicalTimingMark,
} from "../../investigation/timing";
import type { Framebuffer } from "../../render/framebuffer";

/**
 * What the orchestration layer currently believes.
 *
 * Workflow bugs of this kind are close to undiagnosable from the outside —
 * the visible symptom is "the same picture came back" with nothing to
 * distinguish a retry from a loop. This surfaces the identities that decide
 * that, under Developer tools.
 */
export interface OrchestrationDebugView {
  readonly investigationId: string | null;
  readonly corePlanStepId: string | null;
  readonly experiments: readonly {
    readonly experimentRunId: string;
    readonly definitionId: string;
    readonly status: string;
    readonly resolution: string | null;
    readonly corePlanStepId: string | null;
    readonly fingerprintKey: string;
    readonly attempts: readonly {
      readonly attemptId: string;
      readonly attemptNumber: number;
      readonly reason: string;
      readonly validity: string;
      readonly failureKind: string | null;
    }[];
  }[];
  readonly transfers: readonly {
    readonly transferId: string;
    readonly attemptId: string;
    readonly reason: string;
    readonly programCrc32: string | null;
    readonly transactionIds: readonly string[];
    readonly failureReason: string | null;
  }[];
  /** What MatrixSmith believes is on the panel, and how sure it is. */
  readonly panelProgram: {
    readonly certainty: string;
    readonly kind: string;
    readonly label: string;
    readonly fingerprintKey: string | null;
  };
  readonly recommendationTrail: readonly {
    readonly testId: string;
    readonly at: string;
    readonly evidenceCount: number;
    readonly origin: string | null;
  }[];
  readonly cycling: boolean;
  readonly unclassifiedDuplicates: number;
}

export interface CoreProgressView {
  readonly title: string;
  readonly completed: number;
  readonly skipped: number;
  /** completed + skipped: slots that need no further work. */
  readonly resolved: number;
  /** Every slot in the plan. Never changes during an investigation. */
  readonly total: number;
  readonly complete: boolean;
  readonly currentStepId: string | null;
  /** Set when the current milestone is waiting on a repeat measurement. */
  readonly retryableTestId: string | null;
  readonly steps: readonly {
    readonly id: string;
    /** Stable 1-based slot ordinal, skipped milestones included. */
    readonly position: number;
    readonly title: string;
    readonly purpose: string;
    readonly state: "complete" | "current" | "pending" | "skipped";
    readonly skipReason: string | null;
  }[];
}

export interface ClaimGroupView {
  readonly category: "core" | "content" | "optional";
  readonly label: string;
  readonly claims: readonly ClaimRowView[];
}

export interface ClaimRowView {
  readonly id: string;
  readonly label: string;
  readonly status: ClaimState["status"];
  readonly glyph: string;
  readonly evidence: string;
  readonly scopeLabel: string | null;
}

export interface InvestigationSummaryView {
  readonly id: string;
  readonly goalLabel: string;
  readonly status: "active" | "stopped";
  readonly completedTests: readonly CompletedGuidedTest[];
}

export interface GuidedTestView {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly category: string;
  readonly estimatedObservationTime: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly lastStatus: CompletedGuidedTest["status"] | null;
}

export interface RecommendationView {
  readonly testId: string;
  readonly title: string;
  readonly description: string;
  readonly why: string;
  readonly estimatedObservationTime: string;
  readonly risk: string;
  readonly category: string;
}

export interface StoredInvestigationView {
  readonly savedAt: string;
  readonly deviceName: string | null;
  readonly goalLabel: string;
  readonly testCount: number;
  readonly matchesProfile: boolean;
  /**
   * Whether the record was made on THIS browser-authorized physical display.
   * When it was not, resuming keeps the evidence as history but starts a
   * fresh execution record — one unit's experiments must not continue
   * accumulating against another's.
   */
  readonly sameAuthorizedDevice: boolean;
  readonly experimentCount: number;
}

export interface DiagnosticRegionView {
  readonly id: string;
  readonly shortLabel: string;
  readonly displayLabel: string;
  readonly description: string;
  readonly groupId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Raw protocol value — technical disclosure only, never the region's name. */
  readonly rawWordHex: string | null;
  readonly expected: string | null;
  readonly technicalNotes: readonly string[];
}

/**
 * One staged observation question. Spatial tests ask these one at a time so
 * the question and the place it refers to stay in the same viewport.
 */
export interface ObservationStepView {
  readonly spec: ObservationFieldSpec;
  readonly regionId: string | null;
  readonly answered: boolean;
}

/** How a test's OBSERVE stage should be presented. */
export type ObservationPresentation = "spatial" | "timed" | "simple";

export interface AttemptView {
  readonly attemptNumber: number;
  readonly validity: AttemptValidity;
  readonly invalidationReason: string | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly marks: readonly PhysicalTimingMark[];
}

export type GuidedFlowStage =
  "about" | "running" | "observe" | "result" | "failed";

export interface GuidedFlowState {
  readonly testId: string;
  readonly title: string;
  readonly stage: GuidedFlowStage;
  readonly about: GuidedTestAbout;
  readonly consequence: string;
  readonly category: string;
  readonly risk: string;
  readonly planSummary: {
    readonly packetCount: number;
    readonly programBytes: number;
    readonly chunkCount: number;
    readonly crc32: string;
    readonly pacingMs: number;
  } | null;
  readonly previews: readonly Framebuffer[];
  readonly regions: readonly DiagnosticRegionView[];
  readonly observationSpecs: readonly ObservationFieldSpec[];
  readonly values: Readonly<Record<string, ObservationValue>>;
  readonly observationsReady: boolean;
  readonly timerSpec: GuidedTestTimer | null;
  /** T0 for a running timed observation; consumed by component-local timer state. */
  readonly timerStartedAt: string | null;
  /** Elapsed since T0 (final host-accepted write) while observing; last recorded value once stopped. */
  readonly timerElapsedMs: number | null;
  /** Elapsed since the current phase's reference point (T0 for the first phase, the previous event for later ones). */
  readonly phaseElapsedMs: number | null;
  readonly currentPhase: TimelinePhase | null;
  /** Which timeline phase is open; distinguishes a missed T1 from a missed T2. */
  readonly timerPhaseIndex: number;
  readonly timerStopped: boolean;
  readonly transferProgress: string | null;
  readonly failure: {
    readonly message: string;
    readonly retryable: boolean;
  } | null;
  readonly transactionIds: readonly string[];
  readonly result: CompletedGuidedTest | null;
  readonly nextTest: RecommendationView | null;
  // ---- staged observation ----
  readonly presentation: ObservationPresentation;
  /** Questions the human answers, in order. Timer-filled fields are excluded. */
  readonly steps: readonly ObservationStepView[];
  readonly stepIndex: number;
  /** Within OBSERVE: watching the timed event, or answering the follow-up questions. */
  readonly observeStage: "timing" | "questions";
  /** How the question stage renders, once any timing is done. */
  readonly questionPresentation: "spatial" | "simple";
  // ---- human-timed attempts ----
  readonly attempts: readonly AttemptView[];
  readonly attemptNumber: number;
  /** True when the last mark can still be taken back without inventing precision. */
  readonly canUndoMark: boolean;
  /** Set once a valid timed attempt exists, so a confirmation run can be offered. */
  readonly timingSummary: string | null;
  readonly awaitingRetryConfirmation: boolean;
  /** "Test 3 of 6" — the milestone this experiment belongs to. Retries never move it. */
  readonly corePosition: {
    readonly position: number;
    readonly total: number;
    readonly stepTitle: string;
  } | null;
  /**
   * Every core slot is resolved. Anything further is optional, so the result
   * screen offers finishing as the primary action and continuing as a choice.
   */
  readonly coreComplete: boolean;
}
