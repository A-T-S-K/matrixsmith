export type { Capability } from "../../core/capabilities";
export { normalizeUuid, type GattEndpoint } from "../../core/device";
export { ApplicationRuntime } from "../../application/runtime";
export type { ExecutionProgress } from "../../app/executor";
export type {
  ConnectionState,
  MatrixTransport,
} from "../../application/ports/transport";
export {
  DEFAULT_REPORT_OPTIONS,
  generateMarkdownReport,
  type ReportData,
  type ReportOptions,
} from "../../diagnostics/report";
export type { ProtocolTransaction } from "../../diagnostics/transactions";
export type {
  DiagnosticRun,
  DiagnosticTool,
} from "../../diagnostics/workflows";
export type { DeviceAssessment } from "../../domain/device/assessment";
export type { ImportedEvidence } from "../../diagnostics/importers";
export type { TransmissionPlan } from "../../core/transmission";
export { Framebuffer } from "../../render/framebuffer";
export { FrameSequence } from "../../render/frame-sequence";
export { renderText } from "../../render/font";
export {
  planRasterScroll,
  resolvesToScroll,
  type ScrollPlan,
} from "../../render/scroll";
export { diagnosticAnimation } from "../../render/patterns";
export type {
  DecodedImageSource,
  FitMode,
  ImageComposition,
  ImageMode,
  ProcessedImage,
} from "../../render/image";
export {
  DEFAULT_CONTENT_SETTINGS,
  loadContentSettings,
  saveContentSettings,
  type ContentSettings,
} from "../../storage/settings";
export type { ClaimState } from "../../investigation/claims";
export type { ContentGate, ContentPathId } from "../../investigation/gating";
export type {
  CompletedGuidedTest,
  SymptomId,
} from "../../investigation/investigation";
export {
  completedTestResolution,
  SYMPTOM_LABELS,
} from "../../investigation/investigation";
export type {
  GuidedTestAbout,
  GuidedTestTimer,
  TimelinePhase,
} from "../../investigation/tests";
export type {
  ObservationFieldSpec,
  ObservationValue,
} from "../../investigation/observations";
export { observationsComplete } from "../../investigation/observations";
export type {
  Recommendation,
  RecommendationOrigin,
} from "../../investigation/recommendations";
export { RASTER_STRATEGY_LABELS } from "../../core/raster-strategy";
export {
  rawWordHex,
  regionPeers,
  type DiagnosticRegion,
} from "../../investigation/regions";
export { timerDrivenFieldIds } from "../../investigation/tests";
export {
  ATTEMPT_INVALIDATION_LABELS,
  aggregateAttemptDurations,
  describeAggregate,
  type AttemptValidity,
  type ObservationAttempt,
  type PhysicalTimingMark,
} from "../../investigation/timing";
export type {
  AttemptFailureKind,
  TransferReason,
} from "../../investigation/orchestration";
export {
  bindingAllowsSessionContinuity,
  deviceIdentityBinding,
} from "../../investigation/device-identity";
export { stepForTest } from "../../investigation/core-plan";
export {
  forgetInvestigationHistory,
  latestInvestigationFor,
  saveInvestigation,
  toHistoricalInvestigation,
} from "../../storage/investigations";
export { type AppRoute, type HashRouter } from "../app/routes";
export { INPUT_LIMITS } from "../../application/input-limits";
export { MATRIXSMITH_VERSION } from "../../application/version";
export { ReplayTransport } from "../../transport/replay";
export { parseDiagnosticBundle } from "../../diagnostics/bundle";
export type { FilesPort } from "../../application/ports/files";
