import { DiscoveryService } from "./services/discovery-service";
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
import {
  captureWorkflowContext,
  WorkflowReservation,
} from "./workflow-context";
export class ApplicationRuntime {
  private readonly workflows = new WorkflowReservation();
  private readonly discoveryService: DiscoveryService;
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
      guidedTestCatalog: () => this.guidedTestCatalog,
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
      reserve: (context) => this.workflows.acquire(context),
      investigation: () => this.investigationService,
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
      identification: () => this.identification,
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
      guidedOrchestration: () => this.guidedOrchestration,
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

    this.discoveryService = new DiscoveryService({
      connection: () => this.connection,
      identification: () => this.identification,
      transmission: () => this.transmission,
      evidence: () => this.protocolEvidence,
    });
    this.transmission.initialize();
    this.connection.initialize();
    this.connect = (...args) => {
      this.guardDiscovery();
      return this.connection.connect(...args);
    };
    this.reconnectAuthorized = (...args) => {
      this.guardDiscovery();
      return this.connection.reconnectAuthorized(...args);
    };
    this.disconnect = () => {
      this.workflows.retire();
      this.discoveryService.retire();
      return this.connection
        .disconnect()
        .then(() => this.discoveryService.connectionRetired());
    };
    this.read = (...args) => {
      this.guardDiscovery();
      return this.connection.read(...args);
    };
    this.isNotificationActive = this.connection.isNotificationActive.bind(
      this.connection,
    );
    this.enableNotifications = (...args) => {
      this.guardDiscovery();
      return this.connection.enableNotifications(...args);
    };
    this.enableDriverNotifications = (...args) => {
      this.guardDiscovery();
      return this.connection.enableDriverNotifications(...args);
    };
    this.geometryProposal = this.identification.geometryProposal.bind(
      this.identification,
    );
    this.useReportedGeometry = (...args) => {
      this.guardDiscovery();
      return this.diagnostics.useReportedGeometry(...args);
    };
    this.confirmProvisionalGeometry = (...args) => {
      this.guardDiscovery();
      return this.diagnostics.confirmProvisionalGeometry(...args);
    };
    this.diagnosticTools = this.diagnostics.diagnosticTools.bind(
      this.diagnostics,
    );
    this.runDiagnostic = (...args) => {
      this.guardDiscovery();
      if (
        this.connection.pendingGattOperation ||
        this.transmission.executionBusy
      )
        throw new Error(
          "Finish the pending connection operation before starting a diagnostic workflow.",
        );
      return this.diagnostics.runDiagnostic(...args);
    };
    this.beginExperiment = (...args) => {
      this.guardDiscovery();
      return this.experiment.beginExperiment(...args);
    };
    this.beginAttempt = (...args) => {
      this.guardDiscovery();
      return this.experiment.beginAttempt(...args);
    };
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
    this.runGuidedTestTransfer = (...args) => {
      this.guardDiscovery();
      return this.guidedOrchestration.runGuidedTestTransfer(...args);
    };
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
    this.applyFingerprint = (...args) => {
      this.guardDiscovery();
      return this.identification.applyFingerprint(...args);
    };
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
    this.importBundle = (...args) => {
      this.guardImport();
      return this.reportImport.importBundle(...args);
    };
    this.adoptPreparedBundle = (...args) => {
      this.guardImport();
      return this.reportImport.adoptPreparedBundle(...args);
    };
    this.sendPersistentContent = (...args) => {
      this.guardDiscovery();
      return this.transmission.sendPersistentContent(...args);
    };
    this.importExternalLog = (...args) => {
      this.guardDiscovery();
      return this.reportImport.importExternalLog(...args);
    };
    this.plan = this.transmission.plan.bind(this.transmission);
    this.authorize = this.transmission.authorize.bind(this.transmission);
    this.evaluate = this.transmission.evaluate.bind(this.transmission);
    this.send = (...args) => {
      this.guardDiscovery();
      return this.transmission.send(...args);
    };
    this.probe = (...args) => {
      this.guardDiscovery();
      return this.transmission.probe(...args);
    };
  }
  readonly connect: ConnectionService["connect"];
  readonly reconnectAuthorized: ConnectionService["reconnectAuthorized"];
  readonly disconnect: ConnectionService["disconnect"];
  readonly read: ConnectionService["read"];
  readonly isNotificationActive: ConnectionService["isNotificationActive"];
  readonly enableNotifications: ConnectionService["enableNotifications"];
  readonly enableDriverNotifications: ConnectionService["enableDriverNotifications"];
  readonly geometryProposal: IdentificationService["geometryProposal"];
  readonly useReportedGeometry: DiagnosticsService["useReportedGeometry"];
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
  readonly adoptPreparedBundle: ReportImportService["adoptPreparedBundle"];
  readonly sendPersistentContent: TransmissionService["sendPersistentContent"];
  readonly importExternalLog: ReportImportService["importExternalLog"];
  get observations() {
    return this.protocolEvidence.observations;
  }
  get evidenceRevisions() {
    return this.protocolEvidence.revisions;
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
  get discovery() {
    return this.discoveryService.snapshot();
  }
  get discoveryBusy() {
    return this.discoveryService.busy;
  }
  get executionBusy() {
    return (
      this.discoveryService.busy ||
      this.workflows.busy ||
      this.connection.pendingGattOperation ||
      this.transmission.executionBusy
    );
  }
  captureWorkflowContext = (relevantTarget = true) =>
    captureWorkflowContext(this.connection, relevantTarget);
  startDiscovery = (): Promise<void> => {
    this.workflows.guard();
    return this.discoveryService.start();
  };
  stopDiscovery = (): void => this.discoveryService.stop();
  private guardImport(): void {
    this.guardDiscovery();
    if (this.connection.pendingGattOperation)
      throw new Error(
        "Finish the current operation before importing historical evidence.",
      );
  }
  private guardDiscovery(): void {
    this.workflows.guard();
    if (this.discoveryService.busy)
      throw new Error(
        "Display setup owns execution. Stop and wait for the pending check to settle before another operation.",
      );
  }
  dispose = (): Promise<void> => {
    this.workflows.retire();
    this.discoveryService.dispose();
    return this.connection.dispose();
  };
}
