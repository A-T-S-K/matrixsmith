import { useSyncExternalStore } from "preact/compat";
import type { Capability } from "../core/capabilities";
import { normalizeUuid, type GattEndpoint } from "../core/device";
import { MatrixController } from "../app/controller";
import type { ConnectionState, MatrixTransport } from "../transport/types";
import { DEFAULT_REPORT_OPTIONS, generateMarkdownReport, type ReportData, type ReportOptions } from "../diagnostics/report";
import type { ProtocolTransaction } from "../diagnostics/transactions";
import type { DiagnosticRun, DiagnosticTool } from "../diagnostics/workflows";
import { computeSupportMatrix, type SupportArea } from "../diagnostics/support";
import type { ImportedEvidence } from "../diagnostics/importers";
import type { TransmissionPlan } from "../core/transmission";
import type { ContentValidationWorkflow, ValidationAnswer } from "../diagnostics/validation";
import { Framebuffer } from "../render/framebuffer";
import { FrameSequence } from "../render/frame-sequence";
import { renderText, scrollOffsets } from "../render/font";
import { diagnosticAnimation } from "../render/patterns";
import { decodeImageFile, readGifMetadata, type FitMode } from "../render/image";
import { DEFAULT_CONTENT_SETTINGS, loadContentSettings, saveContentSettings, type ContentSettings } from "../storage/settings";
import type { ClaimState } from "../investigation/claims";
import type { ContentGate, ContentPathId } from "../investigation/gating";
import type { CompletedGuidedTest, SymptomId } from "../investigation/investigation";
import { completedTestResolution, SYMPTOM_LABELS } from "../investigation/investigation";
import type { GuidedTestAbout, GuidedTestTimer, TimelinePhase } from "../investigation/tests";
import type { ObservationFieldSpec, ObservationValue } from "../investigation/observations";
import { observationsComplete } from "../investigation/observations";
import type { Recommendation, RecommendationOrigin } from "../investigation/recommendations";
import { RASTER_STRATEGY_LABELS } from "../core/raster-strategy";
import { diagnosticContent } from "../drivers/coolledux/diagnostics";
import { rawWordHex, regionPeers, type DiagnosticRegion } from "../investigation/regions";
import { timerDrivenFieldIds } from "../investigation/tests";
import {
  ATTEMPT_INVALIDATION_LABELS, aggregateAttemptDurations, describeAggregate,
  type AttemptValidity, type ObservationAttempt, type PhysicalTimingMark,
} from "../investigation/timing";
import type { AttemptFailureKind, TransferReason } from "../investigation/orchestration";
import { bindingAllowsSessionContinuity, deviceIdentityBinding } from "../investigation/device-identity";
import { stepForTest } from "../investigation/core-plan";
import { forgetInvestigationHistory, latestInvestigationFor, saveInvestigation, toHistoricalInvestigation } from "../storage/investigations";

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
export type TransactionFilter = "all" | "txrx" | "queries" | "probes" | "diagnostics" | "errors";

export type { SupportArea, SupportState } from "../diagnostics/support";
export interface GattCharacteristicView { readonly serviceUuid: string; readonly uuid: string; readonly properties: readonly string[]; readonly canRead: boolean; readonly canSubscribe: boolean; readonly subscribed: boolean; }
export interface DriverCandidateView { readonly id: string; readonly family: string; readonly state: string; readonly summary: string; readonly score: number; readonly reasons: readonly string[]; readonly contradictions: readonly string[]; readonly canIdentify: boolean; }

export interface AppSnapshot {
  readonly page: "home" | "workspace";
  readonly view: WorkspaceView;
  readonly connection: ConnectionState;
  readonly source: string;
  readonly liveConnected: boolean;
  readonly busy: string | null;
  readonly error: string | null;
  readonly info: string | null;
  readonly bluetoothSupported: boolean;
  readonly previouslyAuthorized: readonly { readonly id: string; readonly name: string }[];
  readonly device: { readonly name: string; readonly connectionLabel: string; readonly protocol: string; readonly support: string; readonly liveGeometry: string; readonly profileGeometry: string; readonly advertisementGeometry: string; readonly profileId: string | null } | null;
  readonly deviceState: { readonly brightness: number | null; readonly power: string; readonly payloadHex: string | null };
  readonly capabilities: readonly Capability[];
  readonly support: readonly SupportArea[];
  readonly recommended: { readonly title: string; readonly description: string; readonly action: "connect" | "identify" | "checks" | "validate-static" | "validate-animation" | "none" };
  readonly diagnosticTools: readonly DiagnosticTool[];
  readonly diagnosticRuns: readonly DiagnosticRun[];
  readonly candidates: readonly DriverCandidateView[];
  readonly gatt: readonly { readonly uuid: string; readonly primary: boolean; readonly characteristics: readonly GattCharacteristicView[] }[];
  readonly transactions: readonly ProtocolTransaction[];
  readonly rawEvents: readonly import("../diagnostics/trace").TraceEvent[];
  readonly observations: readonly import("../core/evidence").ManualObservation[];
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
  readonly validationWorkflows: readonly ValidationWorkflowView[];
  readonly validationFlow: ValidationFlowState | null;
  readonly validations: readonly import("../diagnostics/validation").SessionValidationResult[];
  readonly contentCompilations: readonly import("../diagnostics/content-evidence").ContentCompilationRecord[];
  // ---- Guided investigation ----
  readonly claimGroups: readonly ClaimGroupView[];
  readonly contentGates: Readonly<Record<ContentPathId, ContentGate>>;
  readonly investigation: InvestigationSummaryView | null;
  readonly guidedTests: readonly GuidedTestView[];
  readonly nextTest: RecommendationView | null;
  readonly guidedFlow: GuidedFlowState | null;
  readonly storedInvestigation: StoredInvestigationView | null;
  readonly rasterStrategyLabel: string | null;
  readonly symptoms: readonly { readonly id: SymptomId; readonly label: string }[];
  /** Bounded core progress, so guided work can say how much is left. */
  readonly coreProgress: CoreProgressView | null;
  /** Set when the engine's recommendation sequence looks like a loop. */
  readonly cycleWarning: string | null;
  /** Developer-only orchestration trace. Never shown on the guided path. */
  readonly orchestration: OrchestrationDebugView;
}

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
    readonly attempts: readonly { readonly attemptId: string; readonly attemptNumber: number; readonly reason: string; readonly validity: string; readonly failureKind: string | null }[];
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
  readonly recommendationTrail: readonly { readonly testId: string; readonly evidenceCount: number; readonly origin: string | null }[];
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

export type GuidedFlowStage = "about" | "running" | "observe" | "result";

export interface GuidedFlowState {
  readonly testId: string;
  readonly title: string;
  readonly stage: GuidedFlowStage;
  readonly about: GuidedTestAbout;
  readonly consequence: string;
  readonly category: string;
  readonly risk: string;
  readonly planSummary: { readonly packetCount: number; readonly programBytes: number; readonly chunkCount: number; readonly crc32: string; readonly pacingMs: number } | null;
  readonly previews: readonly Framebuffer[];
  readonly regions: readonly DiagnosticRegionView[];
  readonly observationSpecs: readonly ObservationFieldSpec[];
  readonly values: Readonly<Record<string, ObservationValue>>;
  readonly observationsReady: boolean;
  readonly timerSpec: GuidedTestTimer | null;
  /** Elapsed since T0 (final host-accepted write) while observing; last recorded value once stopped. */
  readonly timerElapsedMs: number | null;
  /** Elapsed since the current phase's reference point (T0 for the first phase, the previous event for later ones). */
  readonly phaseElapsedMs: number | null;
  readonly currentPhase: TimelinePhase | null;
  /** Which timeline phase is open; distinguishes a missed T1 from a missed T2. */
  readonly timerPhaseIndex: number;
  readonly timerStopped: boolean;
  readonly transferProgress: string | null;
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
  readonly corePosition: { readonly position: number; readonly total: number; readonly stepTitle: string } | null;
  /**
   * Every core slot is resolved. Anything further is optional, so the result
   * screen offers finishing as the primary action and continuing as a choice.
   */
  readonly coreComplete: boolean;
}

export interface ContentState {
  /** True when at least one content path is unlocked; per-path gates live in snapshot.contentGates. */
  readonly allowed: boolean;
  readonly allowedReason: string;
  readonly settings: ContentSettings;
  readonly textPreview: Framebuffer | null;
  readonly image: { readonly preview: Framebuffer; readonly sourceWidth: number; readonly sourceHeight: number; readonly fitMode: FitMode; readonly name: string } | null;
  readonly animationChoice: "diagnostic" | "scroll-text";
  readonly animationPreview: readonly Framebuffer[];
  readonly gif: { readonly byteLength: number; readonly width: number | null; readonly height: number | null; readonly warning: string | null; readonly name: string } | null;
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

export interface ValidationWorkflowView {
  readonly id: string;
  readonly label: string;
  readonly risk: string;
  readonly persistence: string;
  readonly validation: string;
  readonly consequence: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export interface ValidationFlowState {
  readonly workflowId: string;
  readonly label: string;
  readonly consequence: string;
  readonly stage: "confirm" | "questions" | "done";
  readonly preview: readonly Framebuffer[];
  readonly planSummary: { readonly packetCount: number; readonly programBytes: number; readonly chunkCount: number; readonly crc32: string; readonly pacingMs: number } | null;
  readonly questions: readonly { readonly id: string; readonly prompt: string }[];
  readonly answers: Readonly<Record<string, ValidationAnswer>>;
  readonly transactionIds: readonly string[];
  readonly result: { readonly status: string; readonly findings: readonly string[] } | null;
}

/** Exact consequence shown before every persistent content transmission. */
export const PERSISTENT_CONTENT_CONSEQUENCE =
  "This replaces the currently stored display program with the new content. "
  + "The device's hardware reset path is known to restore its factory/default content, "
  + "but automatic content restoration has not been verified.";

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

/** Mutable working state for the guided test currently open. */
interface GuidedFlowInternal {
  testId: string; title: string; stage: GuidedFlowStage;
  about: GuidedTestAbout; consequence: string; category: string; risk: string;
  planSummary: GuidedFlowState["planSummary"];
  previews: Framebuffer[]; regions: DiagnosticRegionView[];
  observationSpecs: ObservationFieldSpec[]; values: Record<string, ObservationValue>;
  timerSpec: GuidedTestTimer | null; timerPhaseIndex: number; finalWriteAcceptedAt: string | null; timerStopped: boolean;
  startedAt: string; transferProgress: string | null; transactionIds: string[];
  result: CompletedGuidedTest | null;
  presentation: ObservationPresentation;
  stepIndex: number;
  /** The exact experiment parameters; a retry must reuse these unchanged. */
  parameters: Record<string, number>;
  attempts: ObservationAttempt[];
  marks: PhysicalTimingMark[];
  awaitingRetryConfirmation: boolean;
  /** Semantic identity of this run, so retries stay one numbered test. */
  experimentRunId: string;
  attemptId: string | null;
  /** Why the NEXT transmission happens. Never defaulted to a generic resend. */
  pendingTransferReason: TransferReason;
}

export class MatrixStore {
  readonly #listeners = new Set<() => void>();
  readonly #subscriptions = new Set<string>();
  #page: AppSnapshot["page"] = "home";
  #view: WorkspaceView = "control";
  #busy: string | null = null;
  #error: string | null = null;
  #info: string | null = null;
  #previouslyAuthorized: { id: string; name: string }[] = [];
  #reportOpen = false;
  #reportKind: ReportKind | null = null;
  #reportOptions: ReportOptions = DEFAULT_REPORT_OPTIONS;
  #transactionFilter: TransactionFilter = "all";
  #transactionSearch = "";
  #lastImport: ImportSummary | null = null;
  #settings: ContentSettings = loadContentSettings();
  #imageFile: Blob | null = null;
  #imageName = "";
  #imageState: ContentState["image"] | null = null;
  #gifBytes: Uint8Array | null = null;
  #gifState: ContentState["gif"] | null = null;
  #animationChoice: "diagnostic" | "scroll-text" = "diagnostic";
  #pendingSend: { view: PendingSend; plan: TransmissionPlan; extras?: Record<string, string> } | null = null;
  #validationFlow: {
    workflowId: string; label: string; consequence: string; stage: "confirm" | "questions" | "done";
    preview: Framebuffer[]; planSummary: ValidationFlowState["planSummary"];
    questions: { id: string; prompt: string }[]; answers: Record<string, ValidationAnswer>;
    transactionIds: string[]; result: { status: string; findings: readonly string[] } | null;
  } | null = null;
  #snapshot!: AppSnapshot;

  constructor(readonly controller: MatrixController, readonly transport: MatrixTransport) {
    controller.trace.subscribe(() => this.#emit());
    const subscribable = transport as MatrixTransport & { subscribeState?: (listener: () => void) => () => void };
    subscribable.subscribeState?.(() => this.#emit());
    this.#rebuild();
  }

  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  getSnapshot = (): AppSnapshot => this.#snapshot;

  async initialize(): Promise<void> {
    const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth & { getDevices?: () => Promise<readonly BluetoothDevice[]> } }).bluetooth;
    if (!bluetooth?.getDevices) return;
    try { this.#previouslyAuthorized = (await bluetooth.getDevices()).map((device) => ({ id: device.id, name: device.name ?? "Unnamed display" })); } catch { this.#previouslyAuthorized = []; }
    this.#emit();
  }

  setView(view: WorkspaceView): void { this.#view = view; this.#emit(); }
  goHome(): void { this.#page = "home"; this.#emit(); }
  clearMessage(): void { this.#error = null; this.#info = null; this.#emit(); }
  openReport(): void { this.#reportOpen = true; this.#emit(); }
  setReportKind(kind: ReportKind): void { this.#reportKind = kind; this.#emit(); }
  closeReport(): void { this.#reportOpen = false; this.#emit(); }
  setReportOptions(options: ReportOptions): void { this.#reportOptions = options; this.#emit(); }
  setTransactionFilter(value: TransactionFilter): void { this.#transactionFilter = value; this.#emit(); }
  setTransactionSearch(value: string): void { this.#transactionSearch = value; this.#emit(); }

  async connect(mode: "registered" | "inspection" = "registered", serviceHints: readonly BluetoothServiceUUID[] = []): Promise<void> {
    await this.#run(mode === "registered" ? "Connecting display…" : "Opening BLE explorer…", async () => {
      this.#persistInvestigation();
      await this.controller.connect(mode, serviceHints);
      this.#persistDetachedInvestigation();
      await this.controller.enableDriverNotifications().catch(() => undefined);
      this.#page = "workspace";
      // Known/usable displays open the Device Workspace; unknown or
      // incomplete hardware naturally enters the guided investigation.
      this.#view = mode === "inspection" ? "develop" : this.controller.session.selection?.selected ? "control" : "diagnose";
      this.#info = "Display connected. Review the recommended next action.";
    });
  }

  async disconnect(): Promise<void> { await this.#run("Disconnecting…", async () => { await this.controller.disconnect(); this.#page = "home"; this.#view = "control"; }); }
  async identify(): Promise<void> { await this.#run("Running safe identification…", async () => { const run = await this.controller.runDiagnostic("coolledux-identify"); this.#info = run.status === "passed" ? "CoolLEDUX identified from a valid structured 0x1F response." : run.error; }); }
  async runDiagnostic(id: string): Promise<void> { await this.#run("Running diagnostic…", async () => { const run = await this.controller.runDiagnostic(id); this.#info = run.status === "passed" ? "Diagnostic passed." : run.error; }); }
  async refreshInfo(): Promise<void> { await this.runDiagnostic("coolledux-refresh-info"); }
  async applyBrightness(raw: number): Promise<void> { this.updateContentSettings({ lastBrightness: raw }); await this.#run("Applying brightness…", async () => { const command = await this.controller.send(this.controller.plan({ type: "SetBrightness", raw })); if (!command.protocolAcknowledged) throw new Error("Brightness response did not match the command."); const readback = await this.controller.send(this.controller.plan({ type: "GetDeviceInfo" })); const actual = readback.response?.fields.brightnessRaw; if (actual !== raw) throw new Error(`Brightness readback mismatch: expected ${raw}; received ${String(actual)}.`); this.#info = `Brightness ${raw} verified by device-info readback.`; }); }
  async readCharacteristic(endpoint: GattEndpoint): Promise<void> { await this.#run("Reading characteristic…", async () => { const value = await this.controller.read(endpoint); this.#info = `Read ${value.length} byte(s). The transaction retains exact bytes.`; }); }
  async toggleSubscription(endpoint: GattEndpoint): Promise<void> { const key = endpointKey(endpoint); await this.#run(this.#subscriptions.has(key) ? "Unsubscribing…" : "Subscribing…", async () => { if (this.#subscriptions.has(key)) throw new Error("Unsubscribe is available after disconnect in this transport adapter."); await this.controller.enableNotifications(endpoint); this.#subscriptions.add(key); this.#info = "Notifications subscribed."; }); }
  recordObservation(summary: string): void { this.controller.recordObservation(summary); this.#info = "Observation recorded for this session."; this.#emit(); }
  importBundle(json: string): void { this.controller.importBundle(json); this.#page = "workspace"; this.#view = "diagnose"; this.#info = "Diagnostic report opened offline. Live operations remain blocked."; this.#emit(); }
  importExternalCapture(content: string): void {
    this.#error = null;
    try {
      const evidence = this.controller.importExternalLog(content);
      this.#lastImport = summarizeImport(evidence);
      this.#page = "workspace"; this.#view = "develop";
      this.#info = `Imported ${evidence.transactions.length} transaction(s) from the ${evidence.provenance}. Imported evidence never transmits.`;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }
  exportBundle(): string { return this.controller.exportBundle(); }
  /** Investigation work makes the semantic report the default artifact. */
  #effectiveReportKind(): ReportKind {
    if (this.#reportKind) return this.#reportKind;
    return this.controller.investigation ? "investigation" : "device";
  }

  #reportMarkdownForKind(): string {
    try {
      switch (this.#effectiveReportKind()) {
        case "investigation": return this.controller.investigationReportMarkdown();
        case "forensic": return this.controller.forensicReportMarkdown();
        case "device": return this.markdown();
      }
    } catch (error) {
      return `Report unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  markdown(): string {
    // The active investigation supplies the report question when the user
    // hasn't typed one, so pasted reports always carry the actual goal.
    const goal = this.#reportOptions.goal.trim() || this.controller.investigation?.goal.description || "";
    return generateMarkdownReport(this.#reportData(), { ...this.#reportOptions, goal });
  }

  async copy(text: string): Promise<void> {
    let copied = false;
    if (navigator.clipboard?.writeText) copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    if (!copied) {
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.append(area); area.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      area.remove();
    }
    if (copied) this.#info = "Copied to clipboard.";
    else this.#error = "Clipboard access was denied. Use Download instead.";
    this.#emit();
  }
  download(filename: string, content: string, type: string): void { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

  // ---- Content configuration -------------------------------------------

  updateContentSettings(partial: Partial<ContentSettings>): void {
    this.#settings = { ...this.#settings, ...partial, schemaVersion: 1 };
    saveContentSettings(this.#settings);
    this.#emit();
  }

  resetContentSettings(): void { this.#settings = DEFAULT_CONTENT_SETTINGS; saveContentSettings(this.#settings); this.#emit(); }

  setAnimationChoice(choice: "diagnostic" | "scroll-text"): void { this.#animationChoice = choice; this.#emit(); }

  async loadImage(file: Blob, name: string): Promise<void> {
    await this.#run("Decoding image…", async () => {
      const profile = this.controller.session.profile;
      if (!profile) throw new Error("Connect and identify a display before importing an image.");
      const decoded = await decodeImageFile(file, profile.width, profile.height, this.#settings.imageFitMode);
      this.#imageFile = file;
      this.#imageName = name;
      this.#imageState = { preview: decoded.frame, sourceWidth: decoded.sourceWidth, sourceHeight: decoded.sourceHeight, fitMode: decoded.fitMode, name };
      this.#info = `Image decoded locally to ${profile.width}×${profile.height}. Nothing was uploaded anywhere.`;
    });
  }

  async setImageFit(mode: FitMode): Promise<void> {
    this.updateContentSettings({ imageFitMode: mode });
    if (this.#imageFile) await this.loadImage(this.#imageFile, this.#imageName);
  }

  async loadGif(file: Blob, name: string): Promise<void> {
    await this.#run("Reading GIF…", async () => {
      const profile = this.controller.session.profile;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const meta = readGifMetadata(bytes);
      if (!meta.isGif) throw new Error("That file is not a GIF (missing GIF87a/GIF89a header).");
      const warning = profile && meta.width !== null && meta.height !== null && (meta.width > profile.width || meta.height > profile.height)
        ? `GIF canvas ${meta.width}×${meta.height} exceeds the ${profile.width}×${profile.height} display; only source-tested up to 8 columns per segment.`
        : profile && meta.width !== null && meta.width > 8
          ? `GIF wider than 8 columns: the native GIF path is only source-verified inside the untiled 8-column zone.`
          : null;
      this.#gifBytes = bytes;
      this.#gifState = { byteLength: meta.byteLength, width: meta.width, height: meta.height, warning, name };
      this.#info = "GIF read locally. Nothing was uploaded anywhere.";
    });
  }

  // ---- Persistent content sends (explicit consequence confirmation) ----

  requestSendText(): void { this.#requestContentSend("Send rendered text", "text", () => {
    const profile = this.#requireProfile();
    const frame = this.#renderTextFrame(profile.width, profile.height);
    if (!frame) throw new Error("Enter text before sending.");
    return { plan: this.controller.plan({ type: "ShowText", text: this.#settings.text, frame }), preview: frame, extras: { textContent: this.#settings.text, textRendering: "local bitmap renderer (embedded 5x7 font)" } };
  }); }

  requestSendImage(): void { this.#requestContentSend("Send image", "image", () => {
    const image = this.#imageState;
    if (!image) throw new Error("Choose an image first.");
    return { plan: this.controller.plan({ type: "ShowFrame", frame: image.preview }), preview: image.preview, extras: { sourceDimensions: `${image.sourceWidth}×${image.sourceHeight}`, fitMode: image.fitMode } };
  }); }

  requestSendAnimation(): void { this.#requestContentSend("Send animation", "animation", () => {
    const sequence = this.#buildAnimationSequence();
    return { plan: this.controller.plan({ type: "ShowAnimation", sequence }), preview: sequence.frames[0] ?? null };
  }); }

  requestSendGif(): void { this.#requestContentSend("Send GIF", "gif", () => {
    const profile = this.#requireProfile();
    const bytes = this.#gifBytes;
    const meta = this.#gifState;
    if (!bytes || !meta) throw new Error("Choose a GIF first.");
    const width = Math.min(meta.width ?? profile.width, profile.width);
    const height = Math.min(meta.height ?? profile.height, profile.height);
    return { plan: this.controller.plan({ type: "ShowGif", gifBytes: bytes, width, height }), preview: null };
  }); }

  cancelPendingSend(): void { this.#pendingSend = null; this.#emit(); }

  async confirmPendingSend(): Promise<void> {
    const pending = this.#pendingSend;
    if (!pending) return;
    await this.#run("Transmitting stored program…", async () => {
      await this.controller.sendPersistentContent(pending.plan, { confirmedConsequence: true, extras: pending.extras });
      this.#pendingSend = null;
      this.#info = "Content transferred. The stored display program was replaced.";
    });
    this.#emit();
  }

  #requestContentSend(label: string, path: ContentPathId, build: () => { plan: TransmissionPlan; preview: Framebuffer | null; extras?: Record<string, string> }): void {
    this.#error = null;
    try {
      if (!this.#liveResolved()) throw new Error("Live content requires a connected, identified physical display.");
      const gate = this.controller.contentGate(path);
      if (!gate.allowed) throw new Error(gate.reason);
      const { plan, preview, extras } = build();
      this.#pendingSend = {
        plan,
        ...(extras ? { extras } : {}),
        view: {
          planId: plan.id, label, consequence: PERSISTENT_CONTENT_CONSEQUENCE,
          packetCount: plan.packets.length,
          programBytes: typeof plan.metadata.programBytes === "number" ? plan.metadata.programBytes : 0,
          chunkCount: typeof plan.metadata.chunkCount === "number" ? plan.metadata.chunkCount : 0,
          preview,
        },
      };
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }

  // ---- Guided hardware validation --------------------------------------

  startValidation(workflowId: string): void {
    this.#error = null;
    try {
      const workflow = this.#findWorkflow(workflowId);
      const plan = this.controller.planValidationContent(workflowId);
      const preview = workflowId === "coolledux-validate-animation"
        ? [...diagnosticAnimation(this.#requireProfile().width, this.#requireProfile().height).frames]
        : [this.#validationPatternPreview()];
      this.#validationFlow = {
        workflowId, label: workflow.label, consequence: workflow.consequence, stage: "confirm",
        preview,
        planSummary: {
          packetCount: plan.packets.length,
          programBytes: typeof plan.metadata.programBytes === "number" ? plan.metadata.programBytes : 0,
          chunkCount: typeof plan.metadata.chunkCount === "number" ? plan.metadata.chunkCount : 0,
          crc32: typeof plan.metadata.crc32 === "string" ? plan.metadata.crc32 : "unknown",
          pacingMs: typeof plan.metadata.pacingMs === "number" ? plan.metadata.pacingMs : 0,
        },
        questions: workflow.questions.map(({ id, prompt }) => ({ id, prompt })),
        answers: {}, transactionIds: [], result: null,
      };
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }

  async confirmValidationTransfer(): Promise<void> {
    const flow = this.#validationFlow;
    if (!flow || flow.stage !== "confirm") return;
    await this.#run("Transferring diagnostic content…", async () => {
      const { transactionIds } = await this.controller.runContentValidation(flow.workflowId, { confirmedConsequence: true });
      flow.transactionIds = [...transactionIds];
      flow.stage = "questions";
      this.#info = "Diagnostic content transferred. Look at the physical panel, then answer the questions.";
    });
    this.#emit();
  }

  setValidationAnswer(questionId: string, answer: "yes" | "no" | "unsure", note?: string): void {
    const flow = this.#validationFlow;
    if (!flow) return;
    flow.answers[questionId] = { questionId, answer, ...(note ? { note } : {}) };
    this.#emit();
  }

  submitValidationAnswers(): void {
    const flow = this.#validationFlow;
    if (!flow || flow.stage !== "questions") return;
    try {
      const validation = this.controller.recordValidationAnswers(flow.workflowId, Object.values(flow.answers), flow.transactionIds);
      flow.result = { status: validation.status, findings: validation.findings };
      flow.stage = "done";
      this.#info = validation.status === "passed"
        ? "Validation passed on this physical session. The support matrix and reports now reflect it."
        : validation.status === "failed"
          ? "Validation failed; the rejected areas are recorded as evidence. Copy the report before retrying."
          : "Validation recorded as inconclusive; unanswered questions stay untested.";
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }

  closeValidation(): void { this.#validationFlow = null; this.#emit(); }

  // ---- Guided investigation flow ---------------------------------------

  #guidedFlow: GuidedFlowInternal | null = null;
  #timerInterval: ReturnType<typeof setInterval> | null = null;

  startTroubleshoot(symptomId: SymptomId): void {
    this.controller.startInvestigation({ kind: "troubleshoot", symptomId, description: SYMPTOM_LABELS[symptomId] });
    this.#view = "diagnose";
    this.#info = "Troubleshooting started. MatrixSmith picked the highest-information next test for this symptom.";
    this.#persistInvestigation();
    this.#emit();
  }

  startDevelopInvestigation(): void {
    this.controller.ensureInvestigation();
    this.#view = "diagnose";
    this.#emit();
  }

  stopInvestigation(): void {
    this.controller.stopActiveInvestigation();
    this.#persistInvestigation();
    this.#info = "Investigation saved locally. Copy the investigation report, or resume any time.";
    this.#emit();
  }

  resumeStoredInvestigation(): void {
    const stored = latestInvestigationFor(this.controller.session.profile?.id ?? null);
    if (!stored) { this.#error = "No stored investigation found for this display."; this.#emit(); return; }
    this.controller.adoptInvestigation(toHistoricalInvestigation(stored.investigation));
    this.#page = "workspace";
    this.#view = "diagnose";
    this.#info = "Previous investigation resumed. Its evidence is labeled as a previous local session and does not bypass current-session safety gates.";
    this.#emit();
  }

  forgetLocalHistory(): void {
    forgetInvestigationHistory();
    this.#info = "Local investigation/device history forgotten.";
    this.#emit();
  }

  async reconnectAuthorized(deviceId: string): Promise<void> {
    await this.#run("Reconnecting display…", async () => {
      this.#persistInvestigation();
      try {
        await this.controller.reconnectAuthorized(deviceId);
      } catch {
        // Chooser fallback: never make success depend on getDevices().
        await this.controller.connect();
      }
      this.#persistDetachedInvestigation();
      await this.controller.enableDriverNotifications().catch(() => undefined);
      this.#page = "workspace";
      this.#view = this.controller.session.selection?.selected ? "control" : "diagnose";
      this.#info = "Display connected.";
    });
  }

  startGuidedTest(testId: string, origin: RecommendationOrigin = "automatic-recommendation"): void {
    this.#error = null;
    try {
      const test = this.controller.guidedTest(testId);
      const availability = this.controller.guidedTests().find((entry) => entry.test.id === testId);
      if (availability && !availability.available) throw new Error(availability.reason ?? "This test's prerequisites are not met.");
      // How the user got here decides whether a repeat is an algorithmic loop
      // or a deliberate re-measurement. Only the former is a cycle — and a
      // detected cycle has to STOP the workflow here, before an experiment is
      // opened and long before anything is transmitted. A warning the user
      // reads after the panel has been rewritten is not a guard.
      const verdict = this.controller.noteRecommendationTaken(testId, origin);
      if (verdict.cycling) {
        throw new Error(
          "MatrixSmith detected a recommendation cycle and stopped before running another test. "
          + `${verdict.detail ?? ""} Reopen a test deliberately if you want to measure it again.`.trim(),
        );
      }
      const run = this.controller.beginExperiment(testId);
      const plan = this.controller.planGuidedTest(testId);
      // The resolved operation (evidence-aware where declared) drives the
      // preview and region diagram, so About always shows the actual run.
      const { previews, regions } = this.#guidedTestVisuals(this.controller.guidedTestOperation(testId));
      this.#guidedFlow = {
        testId, title: test.title, stage: "about",
        about: test.about, consequence: test.consequence, category: test.category, risk: test.risk,
        planSummary: {
          packetCount: plan.packets.length,
          programBytes: typeof plan.metadata.programBytes === "number" ? plan.metadata.programBytes : 0,
          chunkCount: typeof plan.metadata.chunkCount === "number" ? plan.metadata.chunkCount : 0,
          crc32: typeof plan.metadata.crc32 === "string" ? plan.metadata.crc32 : "unknown",
          pacingMs: typeof plan.metadata.pacingMs === "number" ? plan.metadata.pacingMs : 0,
        },
        previews, regions,
        observationSpecs: [...test.observation], values: {},
        timerSpec: test.timer ?? null, timerPhaseIndex: 0, finalWriteAcceptedAt: null, timerStopped: false,
        startedAt: new Date().toISOString(), transferProgress: null, transactionIds: [],
        result: null,
        presentation: presentationFor(test),
        stepIndex: 0,
        parameters: operationParameters(this.controller.guidedTestOperation(testId)),
        attempts: [], marks: [], awaitingRetryConfirmation: false,
        experimentRunId: run.experimentRunId,
        attemptId: null,
        // Reopening a concluded experiment is a different act from starting
        // one, and the report must be able to say which happened.
        pendingTransferReason: run.reopenReason ? "explicit-reopen" : "initial-experiment",
      };
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }

  async confirmGuidedTransfer(): Promise<void> {
    const flow = this.#guidedFlow;
    if (!flow || flow.stage !== "about") return;
    flow.stage = "running";
    flow.transferProgress = `Uploading diagnostic program (${flow.planSummary?.packetCount ?? "?"} packets at ${flow.planSummary?.pacingMs ?? "?"} ms pacing)…`;
    await this.#run("Transferring diagnostic content…", async () => {
      // The controller's attempt is the authoritative identity; the timing
      // record below borrows its number rather than counting separately. Two
      // independently numbered attempt lists drift the moment one of them
      // gains an entry the other cannot see — a failed transfer, for example.
      const attempt = this.controller.beginAttempt(flow.experimentRunId, flow.pendingTransferReason);
      flow.attemptId = attempt.attemptId;
      try {
        const { transactionIds, finalWriteAcceptedAt } = await this.controller.runGuidedTestTransfer(flow.testId, {
          confirmedConsequence: true, reason: flow.pendingTransferReason, attemptId: attempt.attemptId,
        });
        flow.transactionIds = [...flow.transactionIds, ...transactionIds];
        flow.finalWriteAcceptedAt = finalWriteAcceptedAt;
        flow.stage = "observe";
        flow.transferProgress = null;
        // Each transfer opens a fresh observation attempt: T0 restarts, so the
        // human's marks belong to this run and not the previous one.
        if (flow.timerSpec) {
          flow.marks = [];
          flow.timerPhaseIndex = 0;
          flow.timerStopped = false;
        }
        flow.attempts.push({
          attemptNumber: attempt.attemptNumber,
          parameters: { ...flow.parameters },
          t0: finalWriteAcceptedAt,
          marks: [], values: [],
          validity: "incomplete", invalidationReason: null, note: null,
          startedAt: new Date().toISOString(), endedAt: null,
        });
        if (flow.timerSpec && finalWriteAcceptedAt) { this.#startTimerTicks(); this.#signalTimingStart(); }
        this.#info = "Diagnostic content transferred. Watch the physical panel now.";
      } catch (error) {
        // The transfer failed, so this attempt number is spent. It stays in
        // the record as a failed attempt — the controller has already settled
        // it — and the next try becomes the NEXT attempt. Blaming the person
        // for a radio failure, or silently reusing the number, both lose what
        // actually happened.
        flow.attempts.push({
          attemptNumber: attempt.attemptNumber,
          parameters: { ...flow.parameters },
          t0: null, marks: [], values: [],
          validity: "transfer-failed",
          invalidationReason: ATTEMPT_INVALIDATION_LABELS["transfer-failed"],
          note: null,
          startedAt: attempt.startedAt, endedAt: new Date().toISOString(),
        });
        flow.attemptId = null;
        flow.timerStopped = false;
        this.#stopTimerTicks();
        throw error;
      }
    });
    if (flow.stage === "running") { flow.stage = "about"; flow.transferProgress = null; }
    this.#emit();
  }

  /**
   * Record the current timeline phase: an event tap (the moment something
   * physically happened), a fail outcome, or a still/stop. Every duration is
   * measured by MatrixSmith from T0 — the final host-accepted write — so the
   * user never estimates a time.
   */
  recordGuidedTimeline(action: "event" | "fail" | "still"): void {
    const flow = this.#guidedFlow;
    if (!flow?.timerSpec || !flow.finalWriteAcceptedAt || flow.timerStopped) return;
    const phase = flow.timerSpec.phases[flow.timerPhaseIndex];
    if (!phase) return;
    const now = new Date();
    const elapsed = Math.max(0, now.getTime() - Date.parse(flow.finalWriteAcceptedAt));
    const setBooleans = (sets?: readonly { fieldId: string; value: "yes" | "no" }[]): void => {
      for (const set of sets ?? []) flow.values[set.fieldId] = { kind: "boolean", fieldId: set.fieldId, value: set.value };
    };
    // The tap is a HUMAN observation of a physical event, recorded with its
    // provenance. The timestamp is exact; the precision it represents is not.
    const mark = (event: string, fieldId?: string): void => {
      flow.marks.push({ event, timestamp: now.toISOString(), source: "human-observed", elapsedMs: elapsed, ...(fieldId ? { fieldId } : {}) });
    };
    if (action === "event") {
      flow.values[phase.fieldId] = { kind: "duration", fieldId: phase.fieldId, milliseconds: elapsed, measuredBy: "matrixsmith-timer" };
      setBooleans(phase.eventSets);
      mark(phase.id, phase.fieldId);
      flow.timerPhaseIndex += 1;
      if (flow.timerPhaseIndex >= flow.timerSpec.phases.length) this.#completeAttempt("valid");
    } else if (action === "fail") {
      setBooleans(phase.failSets);
      mark(`${phase.id}:not-observed`);
      // The event genuinely did not happen — that is a real observation of
      // the hardware, not a mistimed measurement.
      this.#completeAttempt("valid");
    } else {
      const fieldId = phase.stillDurationFieldId ?? phase.fieldId;
      flow.values[fieldId] = { kind: "duration", fieldId, milliseconds: elapsed, measuredBy: "matrixsmith-timer", note: "observation ended with the image still completely static" };
      setBooleans(phase.stillSets);
      mark(`${phase.id}:still`, fieldId);
      this.#completeAttempt("valid");
    }
    this.#emit();
  }

  /**
   * "I missed it." The measurement attempt is invalid — that is emphatically
   * NOT the same as the hardware failing to do the thing, so no observation
   * value survives and no negative evidence is produced. The attempt itself
   * stays in the record as investigation metadata.
   */
  markObservationMissed(reason: Extract<AttemptValidity, "missed-t1" | "missed-t2" | "accidental-tap">): void {
    const flow = this.#guidedFlow;
    if (!flow?.timerSpec || flow.timerStopped) return;
    this.#discardAttemptValues();
    this.#completeAttempt(reason);
    flow.pendingTransferReason = "explicit-retry-missed-observation";
    flow.awaitingRetryConfirmation = true;
    this.#info = "Measurement attempt discarded. Nothing about the display was concluded from it.";
    this.#emit();
  }

  /**
   * Take back the most recent mark. Only offered while the NEXT physical
   * event has not happened yet: undoing after the fact could not recover the
   * original moment, and pretending otherwise would manufacture precision.
   */
  undoLastMark(): void {
    const flow = this.#guidedFlow;
    if (!flow?.timerSpec || flow.timerStopped || flow.timerPhaseIndex === 0) return;
    const removed = flow.marks.pop();
    if (removed?.fieldId) delete flow.values[removed.fieldId];
    const phase = flow.timerSpec.phases[flow.timerPhaseIndex - 1];
    for (const set of phase?.eventSets ?? []) delete flow.values[set.fieldId];
    flow.timerPhaseIndex -= 1;
    this.#info = "Mark removed. Keep watching — the timer is still running from the upload.";
    this.#emit();
  }

  /** Ask before re-sending; a retry retransmits persistent content. */
  requestTimingRetry(): void {
    const flow = this.#guidedFlow;
    if (!flow) return;
    // Asking to measure again is a different intent from recovering a missed
    // mark, and reports keep them apart.
    if (flow.pendingTransferReason !== "explicit-retry-missed-observation") flow.pendingTransferReason = "explicit-measure-again";
    flow.awaitingRetryConfirmation = true;
    this.#emit();
  }

  cancelTimingRetry(): void {
    const flow = this.#guidedFlow;
    if (!flow) return;
    flow.awaitingRetryConfirmation = false;
    this.#emit();
  }

  /**
   * Re-run the SAME experiment so the timeline can restart. The operation and
   * every parameter stay identical — this repeats a measurement, it does not
   * test a new hypothesis, and reports must be able to tell those apart.
   */
  async retryTimingAttempt(): Promise<void> {
    const flow = this.#guidedFlow;
    if (!flow || flow.stage !== "observe") return;
    if (!flow.timerStopped) { this.#discardAttemptValues(); this.#completeAttempt("user-restarted"); }
    flow.awaitingRetryConfirmation = false;
    flow.stage = "about";
    await this.confirmGuidedTransfer();
    // The next transmission is a fresh intent, not a repeat of this one.
    flow.pendingTransferReason = "explicit-measure-again";
  }

  /** Close the open attempt, recording what it may and may not establish. */
  #completeAttempt(validity: AttemptValidity): void {
    const flow = this.#guidedFlow;
    if (!flow) return;
    flow.timerStopped = true;
    this.#stopTimerTicks();
    const open = flow.attempts.at(-1);
    if (!open || open.endedAt !== null) return;
    const settled: ObservationAttempt = {
      ...open,
      marks: [...flow.marks],
      values: validity === "valid" ? Object.values(flow.values) : [],
      validity,
      invalidationReason: validity === "valid" ? null : ATTEMPT_INVALIDATION_LABELS[validity],
      endedAt: new Date().toISOString(),
    };
    flow.attempts[flow.attempts.length - 1] = settled;
    // Mirror the outcome onto the semantic attempt. An invalid attempt is
    // never removed: it is part of what happened, and the report has to be
    // able to say a measurement was discarded rather than silently omit it.
    if (flow.attemptId) {
      this.controller.settleAttempt(flow.attemptId, {
        validity: validity === "valid" ? "valid" : "invalid",
        invalidationReason: settled.invalidationReason,
        failureKind: attemptFailureKind(validity),
        observations: settled.values,
        timing: settled,
      });
    }
  }

  /** Drop everything the failed attempt wrote, including timeline booleans. */
  #discardAttemptValues(): void {
    const flow = this.#guidedFlow;
    if (!flow?.timerSpec) return;
    for (const fieldId of timerDrivenFieldIds(flow.timerSpec)) delete flow.values[fieldId];
    flow.marks = [];
    flow.timerPhaseIndex = 0;
  }

  /**
   * Optional cue at T0 so attention can stay on the panel instead of the
   * phone. Every channel is feature-detected and failure is silent — the
   * observation must never depend on it.
   */
  #signalTimingStart(): void {
    try { navigator.vibrate?.([40, 60, 40]); } catch { /* cue is optional */ }
  }

  // ---- staged observation navigation ----

  setGuidedStep(index: number): void {
    const flow = this.#guidedFlow;
    if (!flow) return;
    const steps = this.#observationSteps(flow);
    flow.stepIndex = Math.max(0, Math.min(index, Math.max(0, steps.length - 1)));
    this.#emit();
  }

  nextGuidedStep(): void { this.setGuidedStep((this.#guidedFlow?.stepIndex ?? 0) + 1); }
  previousGuidedStep(): void { this.setGuidedStep((this.#guidedFlow?.stepIndex ?? 0) - 1); }

  /** Tapping a zone on the map jumps to that zone's question. */
  focusRegion(regionId: string): void {
    const flow = this.#guidedFlow;
    if (!flow) return;
    const steps = this.#observationSteps(flow);
    const index = steps.findIndex((step) => step.regionId === regionId);
    if (index >= 0) this.setGuidedStep(index);
  }

  /**
   * Questions the human answers.
   *
   * Timer-filled fields are never re-asked — the value was measured, so asking
   * would only invite an estimate. A question about a region is dropped when
   * that region is not part of THIS run: some diagnostics include extra zones
   * only once earlier evidence justifies them, and asking about a zone that
   * is not on the display would produce an invented observation.
   */
  #observationSteps(flow: GuidedFlowInternal): readonly ObservationStepView[] {
    const driven = timerDrivenFieldIds(flow.timerSpec);
    const present = new Set(flow.regions.map((region) => region.id));
    return flow.observationSpecs
      .filter((spec) => !driven.has(spec.id) && spec.kind !== "duration")
      .filter((spec) => spec.regionId === undefined || present.has(spec.regionId))
      .map((spec) => ({
        spec,
        regionId: spec.regionId ?? null,
        answered: flow.values[spec.id] !== undefined,
      }));
  }

  setGuidedObservation(value: ObservationValue): void {
    const flow = this.#guidedFlow;
    if (!flow) return;
    flow.values[value.fieldId] = value;
    this.#emit();
  }

  submitGuidedObservations(): void {
    const flow = this.#guidedFlow;
    if (!flow || flow.stage !== "observe") return;
    try {
      const values = Object.values(flow.values);
      // A non-timed test settles its single attempt here; timed tests already
      // settled theirs when the timeline closed.
      if (!flow.timerSpec && flow.attemptId) {
        this.controller.settleAttempt(flow.attemptId, { validity: "valid", observations: values, timing: null });
      }
      // The controller settles the run from the interpretation itself, so the
      // result's resolution and its run's cannot disagree.
      flow.result = this.controller.recordGuidedTestObservations(flow.testId, values, flow.transactionIds, flow.startedAt, flow.attempts);
      flow.stage = "result";
      this.#stopTimerTicks();
      this.#persistInvestigation();
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#emit();
  }

  async copyTestReport(testId?: string): Promise<void> {
    const id = testId ?? this.#guidedFlow?.testId;
    if (!id) return;
    try { await this.copy(this.controller.testReportMarkdown(id)); }
    catch (error) { this.#error = error instanceof Error ? error.message : String(error); this.#emit(); }
  }

  async copyInvestigationReport(): Promise<void> {
    try { await this.copy(this.controller.investigationReportMarkdown()); }
    catch (error) { this.#error = error instanceof Error ? error.message : String(error); this.#emit(); }
  }

  async copyForensicReport(): Promise<void> {
    try { await this.copy(this.controller.forensicReportMarkdown()); }
    catch (error) { this.#error = error instanceof Error ? error.message : String(error); this.#emit(); }
  }

  /**
   * Continue to the next distinct experiment.
   *
   * If the engine ever hands back an experiment that already concluded, that
   * is a workflow-cycle condition, not a next step — running it would send the
   * same pattern to the display for the same non-answer. The guard stops
   * there rather than letting the user discover the loop by living through it.
   */
  continueToNextTest(options: { readonly includeOptional?: boolean } = {}): void {
    const next = this.controller.recommendations()[0] ?? null;
    const settled = this.controller.investigation?.completedTests
      .some((test) => next !== null && test.testId === next.testId && completedTestResolution(test) === "settled") ?? false;
    const retryable = this.#retryableOnCurrentMilestone();
    const progress = this.controller.corePlanProgress();
    this.closeGuidedTest();
    // Core work is finished. Everything past it — colour quality, the second
    // fallback variant, GIF, persistence — is real work with real value, but
    // feeding it automatically is what made characterization feel infinite.
    // Continuing is a deliberate choice, so it needs an explicit opt-in.
    if (progress?.complete && !options.includeOptional) {
      this.#info = "Core characterization is complete. Further tests are optional.";
      this.#emit();
      return;
    }
    // An unanswered measurement on the CURRENT milestone comes first. Moving
    // on to a controlled variant while the baseline it varies was never
    // actually observed would advance the plan past a question nobody
    // answered — and would look, to the user, like their short measurement
    // had counted.
    if (retryable) {
      this.#info = `The last measurement did not run long enough to answer this step. Measure "${retryable.title}" again to finish it.`;
      this.#emit();
      return;
    }
    if (next && !settled) {
      this.startGuidedTest(next.testId, options.includeOptional ? "manual-selection" : "automatic-recommendation");
      return;
    }
    if (next && settled) {
      this.#error = "MatrixSmith was about to repeat a test that already produced a result, so it stopped. Reopen it deliberately if you want to measure it again.";
      this.#emit();
      return;
    }
    this.#info = progress?.complete
      ? "Core characterization is complete."
      : "No further test is recommended right now.";
    this.#emit();
  }

  /**
   * The experiment blocking the current milestone because its measurement
   * fell short, if there is one. Deliberately scoped to the current step: an
   * incomplete run of an already-passed milestone is history, not a blocker.
   */
  #retryableOnCurrentMilestone(): { readonly testId: string; readonly title: string } | null {
    const progress = this.controller.corePlanProgress();
    const current = progress?.current?.step;
    if (!current) return null;
    const retryable = new Set(this.controller.retryableExperimentIds());
    const testId = current.testIds.find((id) => retryable.has(id));
    if (!testId) return null;
    const title = [...(this.controller.investigation?.completedTests ?? [])].reverse().find((test) => test.testId === testId)?.title ?? testId;
    return { testId, title };
  }

  /** Deliberately run a concluded experiment again, with a stated reason. */
  reopenExperiment(testId: string, reason: string): void {
    this.controller.reopenExperiment(testId, reason);
    this.startGuidedTest(testId, "explicit-reopen");
  }

  /**
   * Measure the same experiment again after an incomplete observation.
   *
   * Not a new test and not a reopen: the experiment never answered its
   * question, so it keeps its number, its milestone and its attempt sequence.
   * Recorded as a user-initiated repeat so the cycle guard does not mistake
   * it for the engine looping.
   */
  measureAgain(testId: string): void {
    this.closeGuidedTest();
    this.startGuidedTest(testId, "explicit-retry");
    const flow = this.#guidedFlow;
    if (flow) flow.pendingTransferReason = "explicit-measure-again";
    this.#emit();
  }

  closeGuidedTest(): void {
    const flow = this.#guidedFlow;
    // A running transfer cannot be dismissed as if canceled: the persistent
    // BLE upload continues regardless of the dialog.
    if (flow?.stage === "running") return;
    // After the transfer, closing is never a silent discard — the device WAS
    // changed, so the abandonment is recorded as incomplete evidence.
    if (flow?.stage === "observe" && flow.transactionIds.length > 0) { this.abandonGuidedTest(); return; }
    this.#stopTimerTicks();
    this.#guidedFlow = null;
    this.#emit();
  }

  /** Stop observation and save the transmitted test as incomplete evidence. */
  abandonGuidedTest(): void {
    const flow = this.#guidedFlow;
    if (!flow || flow.stage !== "observe") return;
    try {
      // An abandoned run still closes its open attempt, so the report can
      // say the observation stopped rather than silently losing the timeline.
      if (flow.timerSpec && !flow.timerStopped) this.#completeAttempt("incomplete");
      else if (flow.attemptId) this.controller.settleAttempt(flow.attemptId, { validity: "invalid", failureKind: "observation-incomplete", invalidationReason: "Observation stopped before completion." });
      this.controller.abandonGuidedTest(flow.testId, Object.values(flow.values), flow.transactionIds, flow.startedAt, flow.attempts);
      this.#persistInvestigation();
      this.#info = "Observation stopped. The test was recorded as incomplete — the transmitted content and automatic capture remain as evidence, and its report is available.";
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#stopTimerTicks();
    this.#guidedFlow = null;
    this.#emit();
  }

  #startTimerTicks(): void {
    this.#stopTimerTicks();
    this.#timerInterval = setInterval(() => this.#emit(), 100);
  }

  #stopTimerTicks(): void {
    if (this.#timerInterval !== null) { clearInterval(this.#timerInterval); this.#timerInterval = null; }
  }

  #persistInvestigation(): void {
    const investigation = this.controller.investigation;
    if (investigation) saveInvestigation(investigation);
  }

  /** An investigation detached by a device change stays available as local history. */
  #persistDetachedInvestigation(): void {
    const detached = this.controller.takeDetachedInvestigation();
    if (detached) saveInvestigation(detached);
  }

  #guidedTestVisuals(operation: import("../core/operations").MatrixOperation): { previews: Framebuffer[]; regions: DiagnosticRegionView[] } {
    const profile = this.controller.session.profile;
    if (!profile || operation.type !== "ShowDiagnostic") return { previews: [], regions: [] };
    try {
      const built = diagnosticContent(operation.diagnosticId).build(profile, operation.parameters);
      // The diagnostic itself declares what the panel should show; the UI
      // never re-derives it, so About and OBSERVE always preview the actual run.
      return { previews: [built.preview], regions: built.regions.map((region) => regionView(region)) };
    } catch {
      return { previews: [], regions: [] };
    }
  }

  #findWorkflow(workflowId: string): ContentValidationWorkflow {
    const workflow = this.controller.contentValidationWorkflows().find(({ id }) => id === workflowId);
    if (!workflow) throw new Error("This validation workflow is unavailable for the current session.");
    return workflow;
  }

  #requireProfile(): { width: number; height: number } {
    const profile = this.controller.session.profile;
    if (!profile) throw new Error("No device profile is resolved.");
    return profile;
  }

  #validationPatternPreview(): Framebuffer {
    const profile = this.#requireProfile();
    return diagnosticAnimation(profile.width, profile.height).frames[0]!;
  }

  #renderTextFrame(width: number, height: number): Framebuffer | null {
    if (!this.#settings.text.trim()) return null;
    return renderText(this.#settings.text, width, height, {
      color: hexToRgb(this.#settings.textColor),
      background: hexToRgb(this.#settings.textBackground),
      alignment: this.#settings.textAlignment,
    });
  }

  #buildAnimationSequence(): FrameSequence {
    const profile = this.#requireProfile();
    if (this.#animationChoice === "diagnostic") return diagnosticAnimation(profile.width, profile.height);
    const text = this.#settings.text.trim();
    if (!text) throw new Error("Enter text to build a scrolling-text animation.");
    const offsets = scrollOffsets(text, profile.width, 2);
    const frames = offsets.map((offset) => renderText(text, profile.width, profile.height, {
      color: hexToRgb(this.#settings.textColor), background: hexToRgb(this.#settings.textBackground), alignment: "left", offsetX: offset,
    }));
    return new FrameSequence(frames, frames.map(() => ({ milliseconds: 120 })));
  }

  #liveResolved(): boolean {
    const session = this.controller.session;
    return session.source === "live" && this.transport.state === "connected" && Boolean(session.selection?.selected) && Boolean(session.profile);
  }

  #contentAllowed(): { allowed: boolean; reason: string } {
    const session = this.controller.session;
    const live = session.source === "live" && this.transport.state === "connected";
    if (!live) return { allowed: false, reason: "Live content requires a connected physical display." };
    if (!session.selection?.selected || !session.profile) return { allowed: false, reason: "Run safe identification first." };
    const gates = this.controller.contentGates();
    const anyAllowed = gates.some((gate) => gate.allowed);
    if (!anyAllowed) return { allowed: false, reason: gates.find((gate) => gate.path === "image")?.reason ?? "No content path is verified on this device yet." };
    return { allowed: true, reason: "At least one content path is verified; each Send button follows its own path's gate." };
  }

  /** Retry the identical measurement, recorded as a user-initiated repeat. */
  async #run(label: string, action: () => Promise<void>): Promise<void> { this.#busy = label; this.#error = null; this.#emit(); try { await action(); } catch (error) { this.#error = error instanceof Error ? error.message : String(error); } finally { this.#busy = null; this.#emit(); } }
  #emit(): void { this.#rebuild(); for (const listener of this.#listeners) listener(); }
  #rebuild(): void {
    const session = this.controller.session; const fingerprint = session.fingerprint; const driver = session.selection?.selected; const profile = session.profile; const info = session.latestDeviceInfo;
    const capabilities = driver && profile ? driver.capabilities(profile) : [];
    const transactions = filterTransactions(this.controller.transactions, this.#transactionFilter, this.#transactionSearch);
    const liveConnected = session.source === "live" && this.transport.state === "connected";
    this.#snapshot = Object.freeze({ page: this.#page, view: this.#view, connection: this.transport.state, source: session.source, liveConnected, busy: this.#busy, error: this.#error, info: this.#info, bluetoothSupported: "bluetooth" in navigator, previouslyAuthorized: this.#previouslyAuthorized, device: fingerprint ? { name: fingerprint.name ?? "Unnamed display", connectionLabel: session.source === "imported" ? "Offline report" : this.transport.state === "connected" ? "Connected" : this.transport.state, protocol: driver?.family ?? (session.selection?.ambiguous ? "Ambiguous protocol" : "Unknown protocol"), support: driver ? "Supported" : session.selection?.ambiguous ? "Identification required" : "Support unknown", liveGeometry: fingerprint.manuallyConfirmedGeometry ? `${fingerprint.manuallyConfirmedGeometry.width}×${fingerprint.manuallyConfirmedGeometry.height} · manually confirmed` : "Unknown", profileGeometry: profile ? `${profile.width}×${profile.height} · ${profile.id}` : "Unknown", advertisementGeometry: "Not derived in this session", profileId: profile?.id ?? null } : null, deviceState: { brightness: typeof info?.fields.brightnessRaw === "number" ? info.fields.brightnessRaw : null, power: info ? info.fields.powerOn === true ? "On" : `Raw ${String(info.fields.powerRaw)}` : "Unknown", payloadHex: info?.payloadHex ?? null }, capabilities, support: computeSupportMatrix({ connected: Boolean(fingerprint), live: liveConnected, resolvedDriverId: driver?.id ?? null, capabilities, validations: this.controller.validations }), recommended: recommendedAction(Boolean(fingerprint), Boolean(driver), session.selection?.ambiguous ?? false, liveConnected, this.controller.validations, this.controller.profileReady()), diagnosticTools: this.controller.diagnosticTools(), diagnosticRuns: this.controller.diagnosticRuns, candidates: (session.selection?.matches ?? []).map((match) => ({ id: match.driverId, family: this.controller.registry.drivers.find((d) => d.id === match.driverId)?.family ?? match.driverId, state: match.driverId === driver?.id ? "VERIFIED ON THIS SESSION" : match.score <= 0 ? "Rejected for this profile" : "Candidate", summary: match.driverId === "coolledux" ? match.driverId === driver?.id ? session.protocolResolution?.summary ?? "Resolved by evidence." : "Shared FFF0/F1 transport" : match.contradictions[0] ?? "Shared FFF0/F1 transport; no verified read-only discriminator available", score: match.score, reasons: match.reasons, contradictions: match.contradictions, canIdentify: match.driverId === "coolledux" && !driver && this.transport.state === "connected" })), gatt: (fingerprint?.services ?? []).map((service) => ({ uuid: service.uuid, primary: service.isPrimary, characteristics: service.characteristics.map((c) => ({ serviceUuid: service.uuid, uuid: c.uuid, properties: Object.entries(c.properties).filter(([, enabled]) => enabled).map(([key]) => key), canRead: c.properties.read, canSubscribe: c.properties.notify || c.properties.indicate, subscribed: this.#subscriptions.has(endpointKey({ serviceUuid: service.uuid, characteristicUuid: c.uuid })) })) })), transactions, rawEvents: this.controller.trace.events, observations: this.controller.observations, reportOpen: this.#reportOpen, reportOptions: this.#reportOptions,
      // Only generated while the dialog is open: it is the most expensive
      // thing a snapshot can do, and it was previously rebuilt on every
      // 100ms timer tick during an observation.
      reportMarkdown: fingerprint && this.#reportOpen ? this.#reportMarkdownForKind() : "",
      reportKind: this.#effectiveReportKind(),
      investigationReportAvailable: this.controller.investigation !== null, transactionFilter: this.#transactionFilter, transactionSearch: this.#transactionSearch, lastImport: this.#lastImport,
      content: this.#contentState(profile), pendingSend: this.#pendingSend?.view ?? null,
      validationWorkflows: this.#validationWorkflowViews(),
      validationFlow: this.#validationFlow ? { ...this.#validationFlow, preview: [...this.#validationFlow.preview], questions: [...this.#validationFlow.questions], answers: { ...this.#validationFlow.answers }, transactionIds: [...this.#validationFlow.transactionIds] } : null,
      validations: this.controller.validations, contentCompilations: this.controller.contentCompilations,
      claimGroups: this.#claimGroups(), contentGates: this.#contentGates(),
      investigation: this.#investigationView(), guidedTests: this.#guidedTestViews(),
      nextTest: recommendationView(this.controller.recommendations()[0] ?? null),
      guidedFlow: this.#guidedFlowView(),
      storedInvestigation: this.#storedInvestigationView(),
      rasterStrategyLabel: this.controller.session.validatedRasterStrategy ? RASTER_STRATEGY_LABELS[this.controller.session.validatedRasterStrategy] : null,
      symptoms: SYMPTOM_ROWS,
      coreProgress: this.#coreProgressView(),
      cycleWarning: this.controller.recommendationCycle.cycling ? this.controller.recommendationCycle.detail : null,
      orchestration: this.#orchestrationView() });
  }

  #claimGroups(): readonly ClaimGroupView[] {
    if (!this.controller.session.selection?.selected) return [];
    const claims = this.controller.claims();
    const groups: { category: ClaimGroupView["category"]; label: string }[] = [
      { category: "core", label: "Core support" },
      { category: "content", label: "Content" },
      { category: "optional", label: "Optional" },
    ];
    return groups.map((group) => ({
      category: group.category, label: group.label,
      claims: claims.filter((claim) => claim.category === group.category).map((claim) => ({
        id: claim.id, label: claim.label, status: claim.status,
        glyph: claim.status === "verified" ? "✓" : claim.status === "rejected" ? "✕" : claim.status === "unresolved" ? "!" : claim.status === "source-supported" ? "◦" : "?",
        evidence: claim.decidedBy?.summary ?? "No evidence recorded.",
        scopeLabel: claim.decidedBy ? SCOPE_LABELS[claim.decidedBy.scope] : null,
      })),
    }));
  }

  #contentGates(): Readonly<Record<ContentPathId, ContentGate>> {
    const gates = this.controller.session.selection?.selected ? this.controller.contentGates() : [];
    const entries = (["text", "image", "animation", "gif"] as const).map((path) => {
      const gate = gates.find((candidate) => candidate.path === path);
      return [path, gate ?? { path, allowed: false, reason: "Connect and identify a display first.", missingClaims: [] }] as const;
    });
    return Object.fromEntries(entries) as Record<ContentPathId, ContentGate>;
  }

  #investigationView(): InvestigationSummaryView | null {
    const investigation = this.controller.investigation;
    if (!investigation) return null;
    return {
      id: investigation.id,
      goalLabel: investigation.goal.kind === "troubleshoot" ? `Troubleshooting: ${investigation.goal.description}` : "Guided development",
      status: investigation.status,
      completedTests: investigation.completedTests,
    };
  }

  #guidedTestViews(): readonly GuidedTestView[] {
    return this.controller.guidedTests().map((entry) => ({
      id: entry.test.id, title: entry.test.title, question: entry.test.about.question,
      category: entry.test.category, estimatedObservationTime: entry.test.about.estimatedObservationTime,
      available: entry.available && this.#liveResolved(), reason: !this.#liveResolved() ? "Requires a live connected display." : entry.reason,
      lastStatus: this.controller.investigation?.completedTests.filter((test) => test.testId === entry.test.id).at(-1)?.status ?? null,
    }));
  }

  #guidedFlowView(): GuidedFlowState | null {
    const flow = this.#guidedFlow;
    if (!flow) return null;
    const running = Boolean(flow.timerSpec && flow.finalWriteAcceptedAt && !flow.timerStopped && flow.stage === "observe");
    const recordedDurations = flow.timerSpec
      ? flow.timerSpec.phases.flatMap((phase) => [phase.fieldId, phase.stillDurationFieldId ?? phase.fieldId])
        .map((fieldId) => flow.values[fieldId])
        .filter((value): value is Extract<ObservationValue, { kind: "duration" }> => value?.kind === "duration")
        .map((value) => value.milliseconds)
      : [];
    const elapsed = running
      ? Math.max(0, Date.now() - Date.parse(flow.finalWriteAcceptedAt!))
      : recordedDurations.length > 0 ? Math.max(...recordedDurations) : null;
    const currentPhase = !flow.timerStopped ? flow.timerSpec?.phases[flow.timerPhaseIndex] ?? null : null;
    const previousPhase = flow.timerPhaseIndex > 0 ? flow.timerSpec?.phases[flow.timerPhaseIndex - 1] ?? null : null;
    const previousEvent = previousPhase ? flow.values[previousPhase.fieldId] : undefined;
    const phaseStartMs = previousEvent?.kind === "duration" ? previousEvent.milliseconds : 0;
    const phaseElapsedMs = elapsed !== null && currentPhase ? Math.max(0, elapsed - phaseStartMs) : null;
    const steps = this.#observationSteps(flow);
    const stepIndex = Math.max(0, Math.min(flow.stepIndex, Math.max(0, steps.length - 1)));
    // A timed test watches first and asks afterwards; everything else is
    // already in its questions stage the moment the transfer lands.
    const observeStage: "timing" | "questions" = flow.timerSpec && !flow.timerStopped ? "timing" : "questions";
    // The quantity worth summarising is the DERIVED visible static hold —
    // how long the finished image stayed put — measured between the two human
    // marks, never the raw elapsed time since the upload.
    const holds = flow.attempts
      .filter((attempt) => attempt.validity === "valid")
      .map((attempt) => {
        const visible = attempt.marks.find((mark) => mark.event === "visible")?.elapsedMs;
        const ended = attempt.marks.find((mark) => mark.event.startsWith("movement"))?.elapsedMs;
        return visible !== undefined && ended !== undefined ? Math.max(0, ended - visible) : undefined;
      })
      .filter((value): value is number => value !== undefined);
    const aggregate = aggregateAttemptDurations(holds);
    return {
      testId: flow.testId, title: flow.title, stage: flow.stage, about: flow.about,
      consequence: flow.consequence, category: flow.category, risk: flow.risk,
      planSummary: flow.planSummary, previews: [...flow.previews], regions: [...flow.regions],
      observationSpecs: [...flow.observationSpecs], values: { ...flow.values },
      observationsReady: observationsComplete(steps.map((step) => step.spec), Object.values(flow.values)),
      timerSpec: flow.timerSpec, timerElapsedMs: elapsed, phaseElapsedMs, currentPhase,
      timerPhaseIndex: flow.timerPhaseIndex, timerStopped: flow.timerStopped,
      transferProgress: flow.transferProgress, transactionIds: [...flow.transactionIds],
      result: flow.result,
      nextTest: flow.stage === "result" ? recommendationView(this.controller.recommendations()[0] ?? null) : null,
      coreComplete: this.controller.corePlanProgress()?.complete ?? false,
      presentation: flow.presentation, steps, stepIndex, observeStage,
      questionPresentation: steps.some((step) => step.regionId !== null) ? "spatial" : "simple",
      attempts: flow.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber, validity: attempt.validity,
        invalidationReason: attempt.invalidationReason, parameters: attempt.parameters,
        marks: attempt.marks,
      })),
      // The authoritative attempt number, not a count of what this dialog has
      // seen. A measure-again opens a fresh flow but CONTINUES the experiment,
      // so restarting the display count here would show "Attempt 1" over an
      // attempt the record calls 3 — exactly the renumbering the attempt model
      // exists to prevent.
      attemptNumber: flow.attempts.at(-1)?.attemptNumber ?? this.#openAttemptNumber(flow) ?? 1,
      // Undo is only honest while the next physical event has not happened.
      canUndoMark: Boolean(flow.timerSpec) && !flow.timerStopped && flow.timerPhaseIndex > 0,
      timingSummary: aggregate ? describeAggregate(aggregate) : null,
      awaitingRetryConfirmation: flow.awaitingRetryConfirmation,
      corePosition: this.#corePositionFor(flow.testId),
    };
  }

  /**
   * Where this experiment sits in the core plan. Deliberately derived from
   * the milestone, not from how many times anything ran: three attempts at
   * Test 2 leave the user on Test 2.
   */
  #corePositionFor(testId: string): GuidedFlowState["corePosition"] {
    const progress = this.#coreProgressView();
    const plan = this.controller.corePlan();
    const step = stepForTest(plan, testId, this.controller.corePlanProgress());
    if (!progress || !step) return null;
    const entry = progress.steps.find((candidate) => candidate.id === step.id);
    if (!entry) return null;
    return { position: entry.position, total: progress.total, stepTitle: entry.title };
  }

  /** Attempt number the controller has open for this flow's experiment. */
  #openAttemptNumber(flow: GuidedFlowInternal): number | null {
    const run = this.controller.experiments.find((entry) => entry.experimentRunId === flow.experimentRunId);
    return run?.attempts.at(-1)?.attemptNumber ?? null;
  }

  #orchestrationView(): OrchestrationDebugView {
    return {
      investigationId: this.controller.investigation?.id ?? null,
      corePlanStepId: this.controller.corePlanProgress()?.current?.step.id ?? null,
      experiments: this.controller.experiments.map((run) => ({
        experimentRunId: run.experimentRunId, definitionId: run.definitionId, status: run.status,
        resolution: run.resolution, corePlanStepId: run.corePlanStepId, fingerprintKey: run.fingerprint.key,
        attempts: run.attempts.map((attempt) => ({
          attemptId: attempt.attemptId, attemptNumber: attempt.attemptNumber,
          reason: attempt.reason, validity: attempt.validity, failureKind: attempt.failureKind,
        })),
      })),
      transfers: this.controller.transfers.map((transfer) => ({
        transferId: transfer.transferId, attemptId: transfer.attemptId, reason: transfer.reason,
        programCrc32: transfer.fingerprint.programCrc32, transactionIds: transfer.transactionIds,
        failureReason: transfer.failureReason,
      })),
      panelProgram: (() => {
        const panel = this.controller.panelProgram();
        return { certainty: panel.certainty, kind: panel.kind, label: panel.label, fingerprintKey: panel.fingerprint?.key ?? null };
      })(),
      recommendationTrail: this.controller.recommendationTrail.map((entry) => ({ testId: entry.testId, evidenceCount: entry.evidenceCount, origin: entry.origin ?? null })),
      cycling: this.controller.recommendationCycle.cycling,
      unclassifiedDuplicates: this.controller.transferSummary().unclassifiedDuplicates,
    };
  }

  #coreProgressView(): CoreProgressView | null {
    const progress = this.controller.corePlanProgress();
    if (!progress) return null;
    return {
      title: progress.plan.title,
      completed: progress.completed,
      skipped: progress.skipped,
      resolved: progress.resolved,
      total: progress.total,
      complete: progress.complete,
      currentStepId: progress.current?.step.id ?? null,
      // Every milestone keeps its own ordinal, skipped ones included. A
      // skipped slot is shown as skipped at its number; it does not vanish
      // and take the denominator down with it, so "Test 6 of 6" stays "Test
      // 6 of 6" for the whole investigation.
      steps: progress.steps.map((entry) => ({
        id: entry.step.id,
        position: entry.step.ordinal,
        title: entry.step.title,
        purpose: entry.step.purpose,
        state: entry.state,
        skipReason: entry.skipReason,
      })),
      retryableTestId: this.#retryableOnCurrentMilestone()?.testId ?? null,
    };
  }

  #storedInvestigationView(): StoredInvestigationView | null {
    const profileId = this.controller.session.profile?.id ?? null;
    const stored = latestInvestigationFor(null);
    if (!stored) return null;
    // Never offer to resume the investigation that is already active.
    if (this.controller.investigation?.id === stored.investigation.id) return null;
    return {
      savedAt: stored.savedAt,
      deviceName: stored.investigation.deviceName,
      goalLabel: stored.investigation.goal.description || stored.investigation.goal.kind,
      testCount: stored.investigation.completedTests.length,
      matchesProfile: profileId !== null && stored.investigation.profileId === profileId,
      sameAuthorizedDevice: bindingAllowsSessionContinuity(
        stored.investigation.deviceBinding,
        deviceIdentityBinding(this.controller.session.fingerprint, profileId),
      ),
      experimentCount: stored.investigation.orchestration?.experiments.length ?? 0,
    };
  }
  #contentState(profile: { width: number; height: number } | null): ContentState {
    const gate = this.#contentAllowed();
    return {
      allowed: gate.allowed, allowedReason: gate.reason, settings: this.#settings,
      textPreview: profile ? this.#renderTextFrame(profile.width, profile.height) : null,
      image: this.#imageState,
      animationChoice: this.#animationChoice,
      animationPreview: profile ? [...diagnosticAnimation(profile.width, profile.height).frames] : [],
      gif: this.#gifState,
    };
  }

  #validationWorkflowViews(): ValidationWorkflowView[] {
    const live = this.controller.session.source === "live" && this.transport.state === "connected";
    return this.controller.contentValidationWorkflows().map((workflow) => ({
      id: workflow.id, label: workflow.label, risk: workflow.risk, persistence: workflow.persistence,
      validation: workflow.validation, consequence: workflow.consequence,
      available: live, unavailableReason: live ? null : "Live validation requires a connected physical display.",
    }));
  }

  #reportData(): ReportData { const session = this.controller.session; const fingerprint = session.fingerprint; if (!fingerprint) throw new Error("No device evidence is available for a report."); const driver = session.selection?.selected; return { createdAt: new Date().toISOString(), matrixsmithVersion: "0.1.0", fingerprint, profile: session.profile, selectedDriver: driver?.id ?? null, driverMatches: session.selection?.matches ?? [], capabilities: driver && session.profile ? driver.capabilities(session.profile) : [], transactions: this.controller.transactions, diagnosticRuns: this.controller.diagnosticRuns, observations: this.controller.observations, trace: this.controller.trace.events, protocolResolution: session.protocolResolution, validations: this.controller.validations, contentCompilations: this.controller.contentCompilations, importedEvidence: this.controller.importedEvidence, liveConnected: session.source === "live" && this.transport.state === "connected", source: session.source, investigationActive: this.controller.investigation !== null }; }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return { r: Number.parseInt(value.slice(0, 2), 16) || 0, g: Number.parseInt(value.slice(2, 4), 16) || 0, b: Number.parseInt(value.slice(4, 6), 16) || 0 };
}

function summarizeImport(evidence: ImportedEvidence): ImportSummary {
  return {
    deviceName: evidence.deviceName,
    bleAddress: evidence.bleAddress,
    serviceCount: evidence.fingerprint?.services.length ?? 0,
    characteristicCount: evidence.fingerprint?.services.reduce((total, service) => total + service.characteristics.length, 0) ?? 0,
    transactionCount: evidence.transactions.length,
    decodedCount: evidence.transactions.filter((t) => t.decodedResponse !== null).length,
    warnings: evidence.warnings,
    unparsedLineCount: evidence.unparsedLineCount,
    provenance: evidence.provenance,
  };
}

const SCOPE_LABELS: Readonly<Record<ClaimState["evidence"][number]["scope"], string>> = {
  "current-session": "this session",
  "previous-local-session": "previous local session",
  "imported-external": "imported evidence",
  "built-in-profile": "built-in profile",
  "source-reference": "source reference",
};

const SYMPTOM_ROWS: readonly { readonly id: SymptomId; readonly label: string }[] = (Object.entries(SYMPTOM_LABELS) as [SymptomId, string][]).map(([id, label]) => ({ id, label }));

function recommendationView(recommendation: Recommendation | null): RecommendationView | null {
  if (!recommendation) return null;
  return {
    testId: recommendation.testId, title: recommendation.title, description: recommendation.description,
    why: recommendation.why, estimatedObservationTime: recommendation.estimatedObservationTime,
    risk: recommendation.risk, category: recommendation.category,
  };
}

/**
 * How a test should be presented. Derived from what the test actually
 * declares rather than hand-tagged, so a new test cannot drift out of sync
 * with its own content: questions about places get the spatial framework,
 * a measured timeline gets the timed one, everything else stays a short
 * plain list.
 */
function presentationFor(test: { readonly observation: readonly ObservationFieldSpec[]; readonly timer?: unknown }): ObservationPresentation {
  // A measured timeline dominates: the physical event happens once and cannot
  // wait for a question to be answered first. Region-linked follow-up
  // questions still get the spatial treatment once the timing is captured.
  if (test.timer) return "timed";
  if (test.observation.some((spec) => spec.regionId !== undefined)) return "spatial";
  return "simple";
}

/** The declared parameter set of the resolved operation, for attempt records. */
function operationParameters(operation: import("../core/operations").MatrixOperation): Record<string, number> {
  if (operation.type !== "ShowDiagnostic" || !operation.parameters) return {};
  return { ...operation.parameters };
}

function regionView(region: DiagnosticRegion): DiagnosticRegionView {
  return {
    id: region.id,
    shortLabel: region.shortLabel,
    displayLabel: region.displayLabel,
    description: region.description,
    groupId: region.groupId ?? null,
    x: region.x, y: region.y, width: region.width, height: region.height,
    rawWordHex: region.technical.rawWord === undefined ? null : rawWordHex(region.technical.rawWord),
    expected: region.technical.expectedUnderHypothesis ?? null,
    technicalNotes: region.technical.notes ?? [],
  };
}

export function useMatrixSnapshot(store: MatrixStore): AppSnapshot { return useSyncExternalStore(store.subscribe, store.getSnapshot); }
function endpointKey(endpoint: GattEndpoint): string { return `${endpoint.serviceUuid.toLowerCase()}/${endpoint.characteristicUuid.toLowerCase()}`; }
/** Turns user text like "FFF0, a950" into chooser-ready service UUIDs; 4-hex shorthand expands to the full base UUID. */
export function parseServiceHints(text: string): BluetoothServiceUUID[] { return [...new Set(text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean).map(normalizeUuid))]; }
export function recommendedAction(connected: boolean, resolved: boolean, ambiguous: boolean, live = true, validations: readonly import("../diagnostics/validation").SessionValidationResult[] = [], ready = false): AppSnapshot["recommended"] {
  if (!connected) return { title: "Connect display", description: "Connect a supported display or open an existing diagnostic report.", action: "connect" };
  if (!live) return { title: "Review imported evidence", description: "This is an offline report. Explore Diagnose and Develop; live operations remain blocked.", action: "none" };
  if (ambiguous && !resolved) return { title: "Run safe identification", description: "Use the verified read-only CoolLEDUX device-info query to resolve this shared GATT profile.", action: "identify" };
  if (resolved) {
    // A display whose profile already establishes a usable static substrate
    // is ready to use. Leading with "validate the static framebuffer" would
    // make characterization look mandatory for work that is already done.
    if (ready) return { title: "Create content", description: "This display is a known, characterized profile. Send an image, text, or an animation — each send asks for confirmation because it replaces the stored display program.", action: "none" };
    const validated = (area: string): boolean => validations.some((validation) => validation.validatedAreas.includes(area as never));
    const rejected = (area: string): boolean => validations.some((validation) => validation.rejectedAreas.includes(area as never));
    if (!validated("static-frame") && !rejected("static-frame")) return { title: "Validate static framebuffer", description: "Run the guided orientation/color diagnostic. It replaces the stored display content and asks structured questions about what the panel shows.", action: "validate-static" };
    if (validated("static-frame") && !validated("animation") && !rejected("animation")) return { title: "Validate animation", description: "Run the guided two-frame diagnostic animation to verify frame ordering, timing, and tile synchronization.", action: "validate-animation" };
    return { title: "Run safe device checks", description: "Refresh device info, or explicitly validate brightness with automatic restoration.", action: "checks" };
  }
  return { title: "Collect GATT evidence", description: "No safe family probe is available. Inspect services without writing.", action: "none" };
}
function filterTransactions(values: readonly ProtocolTransaction[], filter: TransactionFilter, search: string): ProtocolTransaction[] { const query = search.trim().toLowerCase(); return values.filter((t) => { const matchesFilter = filter === "all" || filter === "txrx" && t.packets.length > 0 || filter === "queries" && /get|read/i.test(t.operation) || filter === "probes" && t.source === "probe" || filter === "diagnostics" && t.source === "diagnostic" || filter === "errors" && Boolean(t.error || t.responseTimedOut); if (!matchesFilter) return false; if (!query) return true; return [t.operation, t.driverId, t.decodedResponse?.summary, ...t.packets.map((p) => p.hex), t.decodedResponse?.opcode === undefined ? "" : `0x${t.decodedResponse.opcode.toString(16)}`].some((value) => String(value ?? "").toLowerCase().includes(query)); }); }

/**
 * Why an attempt failed, from how its measurement ended.
 *
 * A transport failure and a mistimed tap both invalidate an attempt and mean
 * entirely different things; a report that cannot tell them apart blames the
 * person for the radio dropping out.
 */
function attemptFailureKind(validity: AttemptValidity): AttemptFailureKind | null {
  switch (validity) {
    case "valid": return null;
    case "transfer-failed": return "transfer-failed";
    case "user-restarted": return "user-restarted";
    case "incomplete": return "observation-incomplete";
    case "missed-t1":
    case "missed-t2":
    case "accidental-tap": return "human-missed";
  }
}
