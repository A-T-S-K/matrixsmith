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

export type SupportState =
  | "Verified"
  | "Experimental"
  | "Not tested"
  | "Unknown"
  | "Rejected"
  | "Unsupported"
  | "Out of scope";
export interface SupportArea {
  readonly id: string;
  readonly label: string;
  readonly state: SupportState;
  readonly evidence: string;
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
  readonly summary: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly contradictions: readonly string[];
  readonly canIdentify: boolean;
}

export interface AppSnapshot {
  readonly page: "home" | "workspace";
  readonly view: WorkspaceView;
  readonly connection: ConnectionState;
  readonly source: string;
  readonly liveConnected: boolean;
  readonly liveWorkspaceAvailable: boolean;
  readonly busy: string | null;
  readonly sendProgress: ExecutionProgress | null;
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
  readonly deviceState: {
    readonly brightness: number | null;
    readonly power: string;
    readonly payloadHex: string | null;
  };
  readonly capabilities: readonly Capability[];
  /** Canonical source for every readiness badge, gate, action, and report projection. */
  readonly assessment: DeviceAssessment;
  readonly support: readonly SupportArea[];
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
  readonly transactions: readonly ProtocolTransaction[];
  readonly rawEvents: readonly import("../../diagnostics/trace").TraceEvent[];
  readonly observations: readonly import("../../core/evidence").ManualObservation[];
  readonly reportOpen: boolean;
  readonly reportOptions: ReportOptions;
  readonly reportMarkdown: string;
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
  readonly gif: {
    readonly byteLength: number;
    readonly width: number | null;
    readonly height: number | null;
    readonly warning: string | null;
    readonly name: string;
  } | null;
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
  "This replaces the currently stored display program with the new content. " +
  "The device's hardware reset path is known to restore its factory/default content, " +
  "but automatic content restoration has not been verified.";

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
