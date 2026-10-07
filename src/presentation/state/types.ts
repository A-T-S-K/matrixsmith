import type { DecodedGif } from "../../render/gif";
import type { Capability } from "../../core/capabilities";
import type { ConnectionState } from "../../application/ports/transport";
import type { ExecutionProgress } from "../../app/executor";
import type { ReportOptions } from "../../diagnostics/report";
import type { ProtocolTransaction } from "../../diagnostics/transactions";
import type {
  DiagnosticRun,
  DiagnosticTool,
} from "../../diagnostics/workflows";
import type { DeviceAssessment } from "../../domain/device/assessment";
import type { Framebuffer } from "../../render/framebuffer";
import type { ScrollPlan } from "../../render/scroll";
import type { FitMode, ProcessedImage } from "../../render/image";
import type { ContentSettings } from "../../storage/settings";
import type { ContentGate, ContentPathId } from "../../investigation/gating";
import type { SymptomId } from "../../investigation/investigation";

export type WorkspaceView = "control" | "diagnose" | "develop";

/**
 * Which report a share action means.
 *
 * The real session exported "MatrixSmith Device Report" — a low-level view
 * that said "Observations: None recorded" while the investigation held a full
 * physical characterization. Share must follow what the user is actually
 * doing, not whichever generator happened to be wired to the button.
 */
export type ReportKind = "investigation" | "device" | "forensic";
export type TransactionFilter =
  "all" | "txrx" | "queries" | "probes" | "diagnostics" | "errors";

export interface EvidenceLabel {
  readonly basis:
    | "candidate"
    | "rejected"
    | "profile-match"
    | "live-probe"
    | "historical"
    | "received"
    | "unread";
  readonly label: string;
  readonly tone: "good" | "bad" | "warn" | "neutral";
  readonly timestamp: string | null;
}
export interface GattCharacteristicView {
  readonly serviceUuid: string;
  readonly uuid: string;
  readonly properties: readonly string[];
  readonly canRead: boolean;
  readonly canSubscribe: boolean;
  readonly subscribed: boolean;
}
export interface DriverCandidateView {
  readonly id: string;
  readonly family: string;
  readonly state: string;
  readonly evidence: EvidenceLabel;
  readonly summary: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly contradictions: readonly string[];
  readonly canIdentify: boolean;
}

export interface LocalProfileReview {
  readonly document: import("../../profiles/document").ProfileDocument | null;
  readonly problems: readonly string[];
  readonly error: string | null;
}

export interface AppSnapshot {
  readonly candidateReview: {
    readonly document: import("../../profiles/document").ProfileDocumentV2;
    readonly observedMatchingName: string;
    readonly stale: boolean;
    readonly error: string | null;
  } | null;
  readonly profileEvidenceStatus: string | null;
  readonly profileReview: LocalProfileReview | null;
  readonly loadedProfiles: readonly import("../../profiles/document").ProfileDocument[];
  readonly profileLoadReason: string | null;
  readonly advisoryInput: {
    readonly owner: object;
    readonly fingerprint: import("../../core/device").DeviceFingerprint;
    readonly actions: readonly string[];
  } | null;
  readonly page: "home" | "workspace";
  readonly view: WorkspaceView;
  readonly workbenchSection: import("../app/routes").WorkbenchSection;
  readonly missingContext: import("../app/routes").WorkspaceContext | null;
  readonly connection: ConnectionState;
  readonly source: string;
  readonly liveConnected: boolean;
  readonly liveWorkspaceAvailable: boolean;
  readonly retainedLiveConnection: ConnectionState | null;
  readonly offlineWorkspaceAvailable: boolean;
  readonly contextLabel: string;
  readonly contextIdentity: string;
  readonly contextTransitionReason: string | null;
  readonly reviewNote: string;
  readonly contentSelection: ContentPathId;
  readonly busy: string | null;
  readonly sendProgress: ExecutionProgress | null;
  readonly sendAttempt: SendAttempt | null;
  readonly wakeLockSupported: boolean;
  readonly error: string | null;
  readonly info: string | null;
  readonly bluetoothSupported: boolean;
  readonly previouslyAuthorized: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly device: {
    readonly name: string;
    readonly connectionLabel: string;
    readonly protocol: string;
    readonly support: string;
    readonly liveGeometry: string;
    readonly profileGeometry: string;
    readonly advertisementGeometry: string;
    readonly profileId: string | null;
  } | null;
  readonly deviceInfoEvidence: EvidenceLabel;
  readonly deviceState: {
    readonly brightness: number | null;
    readonly power: string;
    readonly payloadHex: string | null;
  };
  readonly capabilities: readonly Capability[];
  /** Canonical source for every readiness badge, gate, action, and report projection. */
  readonly geometryDraft: {
    readonly width: string;
    readonly height: string;
    readonly errors: import("../../domain/device/geometry").GeometryErrors;
  };
  readonly discovery:
    | import("../../application/services/discovery-service").DiscoveryState
    | null;
  readonly geometryProposal:
    | import("../../application/services/identification-service").GeometryProposal
    | null;
  readonly geometryProfile: import("../../core/device").DeviceProfile | null;
  readonly assessment: DeviceAssessment;
  readonly recommended: {
    readonly title: string;
    readonly description: string;
    readonly action:
      | "connect"
      | "identify"
      | "checks"
      | "validate-static"
      | "validate-animation"
      | "none";
  };
  readonly diagnosticTools: readonly DiagnosticTool[];
  readonly diagnosticRuns: readonly DiagnosticRun[];
  readonly candidates: readonly DriverCandidateView[];
  readonly gatt: readonly {
    readonly uuid: string;
    readonly primary: boolean;
    readonly characteristics: readonly GattCharacteristicView[];
  }[];
  readonly review: import("./transaction-review").ReviewProjection;
  readonly transactions: readonly ProtocolTransaction[];
  readonly rawEvents: readonly import("../../diagnostics/trace").TraceEvent[];
  readonly observations: readonly import("../../core/evidence").ManualObservation[];
  readonly reportOpen: boolean;
  readonly reportOptions: ReportOptions;
  readonly reportMarkdown: string;
  readonly reportError: string | null;
  readonly reportPreviewFailed: boolean;
  readonly reportObjective: string | null;
  /** Which report the share dialog is showing. */
  readonly reportKind: ReportKind;
  /** True when an investigation is active, making the semantic report the default. */
  readonly investigationReportAvailable: boolean;
  readonly transactionFilter: TransactionFilter;
  readonly transactionSearch: string;
  readonly lastImport: ImportSummary | null;
  readonly content: ContentState;
  readonly pendingSend: PendingSend | null;
  readonly contentCompilations: readonly import("../../diagnostics/content-evidence").ContentCompilationRecord[];
  // ---- Guided investigation ----
  readonly claimGroups: readonly ClaimGroupView[];
  readonly contentGates: Readonly<Record<ContentPathId, ContentGate>>;
  readonly investigation: InvestigationSummaryView | null;
  readonly guidedTests: readonly GuidedTestView[];
  readonly nextTest: RecommendationView | null;
  readonly guidedFlow: GuidedFlowState | null;
  readonly storedInvestigation: StoredInvestigationView | null;
  readonly rasterStrategyLabel: string | null;
  readonly symptoms: readonly {
    readonly id: SymptomId;
    readonly label: string;
  }[];
  /** Bounded core progress, so guided work can say how much is left. */
  readonly coreProgress: CoreProgressView | null;
  /** Set when the engine's recommendation sequence looks like a loop. */
  readonly cycleWarning: string | null;
  /** Developer-only orchestration trace. Never shown on the guided path. */
  readonly orchestration: OrchestrationDebugView;
}

export * from "./guided-types";
import type {
  ClaimGroupView,
  CoreProgressView,
  GuidedFlowState,
  GuidedTestView,
  InvestigationSummaryView,
  OrchestrationDebugView,
  RecommendationView,
  StoredInvestigationView,
} from "./guided-types";

export interface ContentState {
  /** True when at least one content path is unlocked; per-path gates live in snapshot.contentGates. */
  readonly allowed: boolean;
  readonly allowedReason: string;
  readonly settings: ContentSettings;
  readonly textPreview: Framebuffer | null;
  readonly textScrollPlan: ScrollPlan | null;
  readonly image: {
    readonly preview: Framebuffer;
    readonly sourceWidth: number;
    readonly sourceHeight: number;
    readonly fitMode: FitMode;
    readonly name: string;
    readonly processed: ProcessedImage | null;
  } | null;
  readonly animationPreview: readonly Framebuffer[];
  readonly gif: (DecodedGif & { readonly name: string }) | null;
}

export interface PendingSend {
  readonly planId: string;
  readonly label: string;
  readonly consequence: string;
  readonly packetCount: number;
  readonly programBytes: number;
  readonly chunkCount: number;
  readonly preview: Framebuffer | null;
}
/** Exact consequence shown before every persistent content transmission. */
export const PERSISTENT_CONTENT_CONSEQUENCE =
  "Replaces the display’s stored content. Previous content cannot be restored automatically.";

/** Presentation evidence only; never authorization or a physical observation. */
export interface SendAttempt {
  readonly id: number;
  readonly path: ContentPathId;
  readonly target: string;
  readonly connectionId: string | null;
  readonly phase:
    | "preparing"
    | "confirming"
    | "sending"
    | "completed"
    | "failed"
    | "recovering"
    | "review";
  readonly progress: ExecutionProgress | null;
  readonly evidence: Pick<
    import("../../app/executor").ExecutionResult,
    | "hostAccepted"
    | "protocolAcknowledged"
    | "deviceStateVerified"
    | "responseTimedOut"
    | "completedAt"
    | "finalWriteAcceptedAt"
  > | null;
  readonly failure: {
    readonly stage: "preflight" | "upload";
    readonly message: string;
    readonly reconnectRequired: boolean;
  } | null;
}

/** Short outcome copy derived only from attempt evidence. */
export function sendMessage(
  attempt: SendAttempt,
): { headline: string; guidance: string } | null {
  if (attempt.phase === "recovering")
    return {
      headline: "Reconnecting…",
      guidance: "Your draft is kept for review.",
    };
  if (attempt.phase === "review")
    return {
      headline: "Review your draft.",
      guidance:
        "Reconnected. Nothing was resent. Review the preview, then send when ready.",
    };
  if (attempt.failure)
    return attempt.failure.stage === "preflight"
      ? {
          headline: "Send could not start.",
          guidance:
            "Review the draft and the send requirements before trying again.",
        }
      : {
          headline: "Upload did not finish.",
          guidance: "Check the display before sending again.",
        };
  if (attempt.phase === "sending")
    return {
      headline: "Sending upload…",
      guidance: "Keep this screen on until sending finishes.",
    };
  const evidence = attempt.evidence;
  if (!evidence) return null;
  return {
    headline: !evidence.hostAccepted
      ? "Upload completion was not confirmed."
      : evidence.responseTimedOut
        ? "Upload sent; response timed out."
        : "Upload sent.",
    guidance: "Check the display. Its appearance was not confirmed.",
  };
}

export interface ImportSummary {
  readonly deviceName: string | null;
  readonly bleAddress: string | null;
  readonly serviceCount: number;
  readonly characteristicCount: number;
  readonly transactionCount: number;
  readonly decodedCount: number;
  readonly warnings: readonly string[];
  readonly unparsedLineCount: number;
  readonly provenance: string;
}
