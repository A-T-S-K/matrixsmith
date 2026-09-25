import { ConnectionService } from "./services/connection-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { ExperimentService } from "./services/experiment-service";
import { GuidedOrchestrationService } from "./services/guided-orchestration-service";
import { GuidedTestCatalogService } from "./services/guided-test-catalog-service";
import { IdentificationService } from "./services/identification-service";
import { InvestigationService } from "./services/investigation-service";
import { ObservationResolutionService } from "./services/observation-resolution-service";
import { ProtocolEvidenceService } from "./services/protocol-evidence-service";
import { ReportImportService } from "./services/report-import-service";
import { TransmissionService } from "./services/transmission-service";
import type { MatrixTransport } from "./ports/transport";
import { TraceRecorder } from "../diagnostics/trace";
import { DriverRegistry, builtInDrivers } from "../drivers/registry";
export class ApplicationRuntime {
  private readonly connection: ConnectionService;
  private readonly diagnostics: DiagnosticsService;
  private readonly experiment: ExperimentService;
  private readonly guidedOrchestration: GuidedOrchestrationService;
  private readonly guidedTestCatalog: GuidedTestCatalogService;
  private readonly identification: IdentificationService;
  private readonly investigationService: InvestigationService;
  private readonly observationResolution: ObservationResolutionService;
  private readonly protocolEvidence: ProtocolEvidenceService;
  private readonly reportImport: ReportImportService;
  private readonly transmission: TransmissionService;
  constructor(
    transport: MatrixTransport,
    trace = new TraceRecorder(),
    registry = new DriverRegistry(builtInDrivers),
  ) {
    this.transmission = new TransmissionService({
      connection: () => this.connection,
      protocolEvidence: () => this.protocolEvidence,
      investigation: () => this.investigationService,
      identification: () => this.identification,
    });
    this.connection = new ConnectionService(
      {
        identification: () => this.identification,
        investigation: () => this.investigationService,
        protocolEvidence: () => this.protocolEvidence,
      },
      transport,
      this.transmission.authority,
    );
    this.diagnostics = new DiagnosticsService({
      connection: () => this.connection,
      identification: () => this.identification,
      protocolEvidence: () => this.protocolEvidence,
      transmission: () => this.transmission,
    });
    this.experiment = new ExperimentService({
      investigation: () => this.investigationService,
      guidedOrchestration: () => this.guidedOrchestration,
      guidedTestCatalog: () => this.guidedTestCatalog,
      protocolEvidence: () => this.protocolEvidence,
    });
    this.guidedOrchestration = new GuidedOrchestrationService({
      guidedTestCatalog: () => this.guidedTestCatalog,
      connection: () => this.connection,
      investigation: () => this.investigationService,
      protocolEvidence: () => this.protocolEvidence,
      transmission: () => this.transmission,
      experiment: () => this.experiment,
    });
    this.guidedTestCatalog = new GuidedTestCatalogService({
      connection: () => this.connection,
      protocolEvidence: () => this.protocolEvidence,
      investigation: () => this.investigationService,
      guidedOrchestration: () => this.guidedOrchestration,
      experiment: () => this.experiment,
      transmission: () => this.transmission,
    });
    this.identification = new IdentificationService(
      {
        connection: () => this.connection,
        investigation: () => this.investigationService,
        protocolEvidence: () => this.protocolEvidence,
      },
      registry,
    );
    this.investigationService = new InvestigationService({
      connection: () => this.connection,
      protocolEvidence: () => this.protocolEvidence,
    });
    this.observationResolution = new ObservationResolutionService({
      guidedTestCatalog: () => this.guidedTestCatalog,
      connection: () => this.connection,
      experiment: () => this.experiment,
      investigation: () => this.investigationService,
      protocolEvidence: () => this.protocolEvidence,
    });
    this.protocolEvidence = new ProtocolEvidenceService(
      {
        connection: () => this.connection,
        identification: () => this.identification,
      },
      trace,
    );
    this.reportImport = new ReportImportService({
      connection: () => this.connection,
      investigation: () => this.investigationService,
      guidedTestCatalog: () => this.guidedTestCatalog,
      protocolEvidence: () => this.protocolEvidence,
      guidedOrchestration: () => this.guidedOrchestration,
      diagnostics: () => this.diagnostics,
      identification: () => this.identification,
    });

    this.transmission.initialize();
    this.connection.initialize();
    this.connect = this.connection.connect.bind(this.connection);
    this.reconnectAuthorized = this.connection.reconnectAuthorized.bind(
      this.connection,
    );
    this.disconnect = this.connection.disconnect.bind(this.connection);
    this.read = this.connection.read.bind(this.connection);
    this.enableNotifications = this.connection.enableNotifications.bind(
      this.connection,
    );
    this.enableDriverNotifications =
      this.connection.enableDriverNotifications.bind(this.connection);
    this.confirmProvisionalGeometry =
      this.diagnostics.confirmProvisionalGeometry.bind(this.diagnostics);
    this.diagnosticTools = this.diagnostics.diagnosticTools.bind(
      this.diagnostics,
    );
    this.runDiagnostic = this.diagnostics.runDiagnostic.bind(this.diagnostics);
    this.beginExperiment = this.experiment.beginExperiment.bind(
      this.experiment,
    );
    this.beginAttempt = this.experiment.beginAttempt.bind(this.experiment);
    this.settleAttempt = this.experiment.settleAttempt.bind(this.experiment);
    this.inProgressAttempts = this.experiment.inProgressAttempts.bind(
      this.experiment,
    );
    this.settleExperiment = this.experiment.settleExperiment.bind(
      this.experiment,
    );
    this.reopenExperiment = this.experiment.reopenExperiment.bind(
      this.experiment,
    );
    this.reopenedTestIds = this.experiment.reopenedTestIds.bind(
      this.experiment,
    );
    this.retryableExperimentIds = this.experiment.retryableExperimentIds.bind(
      this.experiment,
    );
    this.runGuidedTestTransfer =
      this.guidedOrchestration.runGuidedTestTransfer.bind(
        this.guidedOrchestration,
      );
    this.guidedExecutionFingerprint =
      this.guidedOrchestration.guidedExecutionFingerprint.bind(
        this.guidedOrchestration,
      );
    this.transferSummary = this.guidedOrchestration.transferSummary.bind(
      this.guidedOrchestration,
    );
    this.corePlan = this.guidedOrchestration.corePlan.bind(
      this.guidedOrchestration,
    );
    this.corePlanProgress = this.guidedOrchestration.corePlanProgress.bind(
      this.guidedOrchestration,
    );
    this.guidedTestDefinitions =
      this.guidedTestCatalog.guidedTestDefinitions.bind(this.guidedTestCatalog);
    this.guidedTestRegions = this.guidedTestCatalog.guidedTestRegions.bind(
      this.guidedTestCatalog,
    );
    this.guidedTestPreviews = this.guidedTestCatalog.guidedTestPreviews.bind(
      this.guidedTestCatalog,
    );
    this.diagnosticRegions = this.guidedTestCatalog.diagnosticRegions.bind(
      this.guidedTestCatalog,
    );
    this.analyzeStoredUpload = this.guidedTestCatalog.analyzeStoredUpload.bind(
      this.guidedTestCatalog,
    );
    this.executedTests = this.guidedTestCatalog.executedTests.bind(
      this.guidedTestCatalog,
    );
    this.recordedTests = this.guidedTestCatalog.recordedTests.bind(
      this.guidedTestCatalog,
    );
    this.guidedTests = this.guidedTestCatalog.guidedTests.bind(
      this.guidedTestCatalog,
    );
    this.recommendations = this.guidedTestCatalog.recommendations.bind(
      this.guidedTestCatalog,
    );
    this.noteRecommendationTaken =
      this.guidedTestCatalog.noteRecommendationTaken.bind(
        this.guidedTestCatalog,
      );
    this.contentGates = this.guidedTestCatalog.contentGates.bind(
      this.guidedTestCatalog,
    );
    this.contentGate = this.guidedTestCatalog.contentGate.bind(
      this.guidedTestCatalog,
    );
    this.guidedTest = this.guidedTestCatalog.guidedTest.bind(
      this.guidedTestCatalog,
    );
    this.guidedTestOperation = this.guidedTestCatalog.guidedTestOperation.bind(
      this.guidedTestCatalog,
    );
    this.planGuidedTest = this.guidedTestCatalog.planGuidedTest.bind(
      this.guidedTestCatalog,
    );
    this.deviceTarget = this.identification.deviceTarget.bind(
      this.identification,
    );
    this.assessment = this.identification.assessment.bind(this.identification);
    this.availableEndpoints = this.identification.availableEndpoints.bind(
      this.identification,
    );
    this.applyFingerprint = this.identification.applyFingerprint.bind(
      this.identification,
    );
    this.takeDetachedInvestigation =
      this.investigationService.takeDetachedInvestigation.bind(
        this.investigationService,
      );
    this.panelProgram = this.investigationService.panelProgram.bind(
      this.investigationService,
    );
    this.baselineClaimEvidence =
      this.investigationService.baselineClaimEvidence.bind(
        this.investigationService,
      );
    this.allClaimEvidence = this.investigationService.allClaimEvidence.bind(
      this.investigationService,
    );
    this.claims = this.investigationService.claims.bind(
      this.investigationService,
    );
    this.operationalTrust = this.investigationService.operationalTrust.bind(
      this.investigationService,
    );
    this.staticViability = this.investigationService.staticViability.bind(
      this.investigationService,
    );
    this.profileReady = this.investigationService.profileReady.bind(
      this.investigationService,
    );
    this.startInvestigation = this.investigationService.startInvestigation.bind(
      this.investigationService,
    );
    this.ensureInvestigation =
      this.investigationService.ensureInvestigation.bind(
        this.investigationService,
      );
    this.stopActiveInvestigation =
      this.investigationService.stopActiveInvestigation.bind(
        this.investigationService,
      );
    this.adoptInvestigation = this.investigationService.adoptInvestigation.bind(
      this.investigationService,
    );
    this.recordGuidedTestObservations =
      this.observationResolution.recordGuidedTestObservations.bind(
        this.observationResolution,
      );
    this.abandonGuidedTest = this.observationResolution.abandonGuidedTest.bind(
      this.observationResolution,
    );
    this.testReportMarkdown = this.reportImport.testReportMarkdown.bind(
      this.reportImport,
    );
    this.investigationReportMarkdown =
      this.reportImport.investigationReportMarkdown.bind(this.reportImport);
    this.forensicReportMarkdown = this.reportImport.forensicReportMarkdown.bind(
      this.reportImport,
    );
    this.recordObservation = this.reportImport.recordObservation.bind(
      this.reportImport,
    );
    this.exportBundle = this.reportImport.exportBundle.bind(this.reportImport);
    this.importBundle = this.reportImport.importBundle.bind(this.reportImport);
    this.sendPersistentContent = this.transmission.sendPersistentContent.bind(
      this.transmission,
    );
    this.importExternalLog = this.reportImport.importExternalLog.bind(
      this.reportImport,
    );
    this.plan = this.transmission.plan.bind(this.transmission);
    this.authorize = this.transmission.authorize.bind(this.transmission);
    this.evaluate = this.transmission.evaluate.bind(this.transmission);
    this.send = this.transmission.send.bind(this.transmission);
    this.probe = this.transmission.probe.bind(this.transmission);
  }
  readonly connect: ConnectionService["connect"];
  readonly reconnectAuthorized: ConnectionService["reconnectAuthorized"];
  readonly disconnect: ConnectionService["disconnect"];
  readonly read: ConnectionService["read"];
  readonly enableNotifications: ConnectionService["enableNotifications"];
  readonly enableDriverNotifications: ConnectionService["enableDriverNotifications"];
  readonly confirmProvisionalGeometry: DiagnosticsService["confirmProvisionalGeometry"];
  readonly diagnosticTools: DiagnosticsService["diagnosticTools"];
  readonly runDiagnostic: DiagnosticsService["runDiagnostic"];
  readonly beginExperiment: ExperimentService["beginExperiment"];
  readonly beginAttempt: ExperimentService["beginAttempt"];
  readonly settleAttempt: ExperimentService["settleAttempt"];
  readonly inProgressAttempts: ExperimentService["inProgressAttempts"];
  readonly settleExperiment: ExperimentService["settleExperiment"];
  readonly reopenExperiment: ExperimentService["reopenExperiment"];
  readonly reopenedTestIds: ExperimentService["reopenedTestIds"];
  readonly retryableExperimentIds: ExperimentService["retryableExperimentIds"];
  readonly runGuidedTestTransfer: GuidedOrchestrationService["runGuidedTestTransfer"];
  readonly guidedExecutionFingerprint: GuidedOrchestrationService["guidedExecutionFingerprint"];
  get experiments() {
    return this.guidedOrchestration.experiments;
  }
  get transfers() {
    return this.guidedOrchestration.transfers;
  }
  get recommendationCycle() {
    return this.guidedOrchestration.recommendationCycle;
  }
  readonly transferSummary: GuidedOrchestrationService["transferSummary"];
  readonly corePlan: GuidedOrchestrationService["corePlan"];
  readonly corePlanProgress: GuidedOrchestrationService["corePlanProgress"];
  readonly guidedTestDefinitions: GuidedTestCatalogService["guidedTestDefinitions"];
  readonly guidedTestRegions: GuidedTestCatalogService["guidedTestRegions"];
  readonly guidedTestPreviews: GuidedTestCatalogService["guidedTestPreviews"];
  readonly diagnosticRegions: GuidedTestCatalogService["diagnosticRegions"];
  readonly analyzeStoredUpload: GuidedTestCatalogService["analyzeStoredUpload"];
  readonly executedTests: GuidedTestCatalogService["executedTests"];
  readonly recordedTests: GuidedTestCatalogService["recordedTests"];
  readonly guidedTests: GuidedTestCatalogService["guidedTests"];
  readonly recommendations: GuidedTestCatalogService["recommendations"];
  readonly noteRecommendationTaken: GuidedTestCatalogService["noteRecommendationTaken"];
  get recommendationTrail() {
    return this.guidedTestCatalog.recommendationTrail;
  }
  readonly contentGates: GuidedTestCatalogService["contentGates"];
  readonly contentGate: GuidedTestCatalogService["contentGate"];
  readonly guidedTest: GuidedTestCatalogService["guidedTest"];
  readonly guidedTestOperation: GuidedTestCatalogService["guidedTestOperation"];
  readonly planGuidedTest: GuidedTestCatalogService["planGuidedTest"];
  readonly deviceTarget: IdentificationService["deviceTarget"];
  readonly assessment: IdentificationService["assessment"];
  readonly availableEndpoints: IdentificationService["availableEndpoints"];
  readonly applyFingerprint: IdentificationService["applyFingerprint"];
  readonly takeDetachedInvestigation: InvestigationService["takeDetachedInvestigation"];
  get investigation() {
    return this.investigationService.investigation;
  }
  get orchestration() {
    return this.investigationService.orchestration;
  }
  readonly panelProgram: InvestigationService["panelProgram"];
  readonly baselineClaimEvidence: InvestigationService["baselineClaimEvidence"];
  readonly allClaimEvidence: InvestigationService["allClaimEvidence"];
  readonly claims: InvestigationService["claims"];
  readonly operationalTrust: InvestigationService["operationalTrust"];
  readonly staticViability: InvestigationService["staticViability"];
  readonly profileReady: InvestigationService["profileReady"];
  readonly startInvestigation: InvestigationService["startInvestigation"];
  readonly ensureInvestigation: InvestigationService["ensureInvestigation"];
  readonly stopActiveInvestigation: InvestigationService["stopActiveInvestigation"];
  readonly adoptInvestigation: InvestigationService["adoptInvestigation"];
  readonly recordGuidedTestObservations: ObservationResolutionService["recordGuidedTestObservations"];
  readonly abandonGuidedTest: ObservationResolutionService["abandonGuidedTest"];
  readonly testReportMarkdown: ReportImportService["testReportMarkdown"];
  readonly investigationReportMarkdown: ReportImportService["investigationReportMarkdown"];
  readonly forensicReportMarkdown: ReportImportService["forensicReportMarkdown"];
  readonly recordObservation: ReportImportService["recordObservation"];
  readonly exportBundle: ReportImportService["exportBundle"];
  readonly importBundle: ReportImportService["importBundle"];
  readonly sendPersistentContent: TransmissionService["sendPersistentContent"];
  readonly importExternalLog: ReportImportService["importExternalLog"];
  get observations() {
    return this.protocolEvidence.observations;
  }
  get transactions() {
    return this.protocolEvidence.transactions;
  }
  get diagnosticRuns() {
    return this.diagnostics.diagnosticRuns;
  }
  get contentCompilations() {
    return this.protocolEvidence.contentCompilations;
  }
  get importedEvidence() {
    return this.protocolEvidence.importedEvidence;
  }
  get connectionState() {
    return this.connection.connectionState;
  }
  readonly plan: TransmissionService["plan"];
  readonly authorize: TransmissionService["authorize"];
  readonly evaluate: TransmissionService["evaluate"];
  readonly send: TransmissionService["send"];
  readonly probe: TransmissionService["probe"];
  get session() {
    return this.connection.getSession();
  }
  get trace() {
    return this.protocolEvidence.getTrace();
  }
  get registry() {
    return this.identification.getRegistry();
  }
  get policy() {
    return this.transmission.getPolicy();
  }
  get transport() {
    return this.connection.getTransport();
  }
  dispose = (): Promise<void> => this.connection.dispose();
}
