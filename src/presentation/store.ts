import { ConnectionStore } from "./state/connection-store";
import { ContentEditorStore } from "./state/content-editor-store";
import { ContentSendStore } from "./state/content-send-store";
import { GuidedProjectionStore } from "./state/guided-projection-store";
import { InvestigationStore } from "./state/investigation-store";
import { ProjectionStore } from "./state/projection-store";
import { ReportStore } from "./state/report-store";
import { SnapshotStore } from "./state/snapshot-store";
import { WorkspaceStore } from "./state/workspace-store";
import { NavigationStore } from "./state/navigation-store";
import { NoticeStore } from "./state/notice-store";
import { GuidedController } from "./state/guided-controller";
import type { MatrixTransport } from "../application/ports/transport";
import type { ApplicationRuntime } from "../application/runtime";
import type { PresentationEnvironment } from "./environment";
export class PresentationStore {
  private disposal: Promise<void> | null = null;
  private readonly connectionStore: ConnectionStore;
  private readonly contentEditorStore: ContentEditorStore;
  private readonly contentSendStore: ContentSendStore;
  private readonly guidedProjectionStore: GuidedProjectionStore;
  private readonly investigationStore: InvestigationStore;
  private readonly projectionStore: ProjectionStore;
  private readonly reportStore: ReportStore;
  private readonly snapshotStore: SnapshotStore;
  private readonly workspaceStore: WorkspaceStore;
  private readonly navigationStore: NavigationStore;
  private readonly noticeStore: NoticeStore;
  private readonly guidedController: GuidedController;
  constructor(
    controller: ApplicationRuntime,
    transport: MatrixTransport,
    environment: PresentationEnvironment,
  ) {
    this.connectionStore = new ConnectionStore(
      {
        snapshotStore: () => this.snapshotStore,
        noticeStore: () => this.noticeStore,
        investigationStore: () => this.investigationStore,
        workspaceStore: () => this.workspaceStore,
        navigationStore: () => this.navigationStore,
        contentEditorStore: () => this.contentEditorStore,
      },
      environment,
    );
    this.contentEditorStore = new ContentEditorStore(
      {
        noticeStore: () => this.noticeStore,
        snapshotStore: () => this.snapshotStore,
        workspaceStore: () => this.workspaceStore,
      },
      environment,
    );
    this.contentSendStore = new ContentSendStore(
      {
        contentEditorStore: () => this.contentEditorStore,
        workspaceStore: () => this.workspaceStore,
        navigationStore: () => this.navigationStore,
        snapshotStore: () => this.snapshotStore,
        noticeStore: () => this.noticeStore,
      },
      environment,
    );
    this.guidedProjectionStore = new GuidedProjectionStore({
      guidedController: () => this.guidedController,
      workspaceStore: () => this.workspaceStore,
      projectionStore: () => this.projectionStore,
    });
    this.investigationStore = new InvestigationStore(
      {
        workspaceStore: () => this.workspaceStore,
        noticeStore: () => this.noticeStore,
        navigationStore: () => this.navigationStore,
        snapshotStore: () => this.snapshotStore,
      },
      environment,
    );
    this.projectionStore = new ProjectionStore(
      {
        workspaceStore: () => this.workspaceStore,
        snapshotStore: () => this.snapshotStore,
        guidedController: () => this.guidedController,
      },
      environment,
    );
    this.reportStore = new ReportStore(
      {
        navigationStore: () => this.navigationStore,
        snapshotStore: () => this.snapshotStore,
        workspaceStore: () => this.workspaceStore,
        noticeStore: () => this.noticeStore,
        guidedController: () => this.guidedController,
      },
      environment,
    );
    this.snapshotStore = new SnapshotStore(
      {
        workspaceStore: () => this.workspaceStore,
        reportStore: () => this.reportStore,
        navigationStore: () => this.navigationStore,
        noticeStore: () => this.noticeStore,
        connectionStore: () => this.connectionStore,
        contentSendStore: () => this.contentSendStore,
        projectionStore: () => this.projectionStore,
        guidedProjectionStore: () => this.guidedProjectionStore,
        contentEditorStore: () => this.contentEditorStore,
      },
      environment,
    );
    this.workspaceStore = new WorkspaceStore(
      {
        noticeStore: () => this.noticeStore,
        snapshotStore: () => this.snapshotStore,
        navigationStore: () => this.navigationStore,
      },
      environment,
      controller,
      transport,
    );
    this.navigationStore = new NavigationStore(
      {
        snapshotStore: () => this.snapshotStore,
        reportStore: () => this.reportStore,
        contentSendStore: () => this.contentSendStore,
        guidedController: () => this.guidedController,
      },
      environment,
    );
    this.noticeStore = new NoticeStore({
      snapshotStore: () => this.snapshotStore,
      workspaceStore: () => this.workspaceStore,
    });
    this.guidedController = new GuidedController(
      {
        snapshotStore: () => this.snapshotStore,
        workspaceStore: () => this.workspaceStore,
        investigationStore: () => this.investigationStore,
        noticeStore: () => this.noticeStore,
        navigationStore: () => this.navigationStore,
        contentSendStore: () => this.contentSendStore,
      },
      environment,
    );
    this.snapshotStore._rebuild();
    this.workspaceStore.initialize();
    this.navigationStore.initialize();
    this.initialize = this.connectionStore.initialize.bind(
      this.connectionStore,
    );
    this.setView = this.navigationStore.setView.bind(this.navigationStore);
    this.goHome = this.navigationStore.goHome.bind(this.navigationStore);
    this.clearMessage = this.noticeStore.clearMessage.bind(this.noticeStore);
    this.openReport = this.reportStore.openReport.bind(this.reportStore);
    this.setReportKind = this.reportStore.setReportKind.bind(this.reportStore);
    this.closeReport = this.reportStore.closeReport.bind(this.reportStore);
    this.setReportOptions = this.reportStore.setReportOptions.bind(
      this.reportStore,
    );
    this.setTransactionFilter = this.reportStore.setTransactionFilter.bind(
      this.reportStore,
    );
    this.setTransactionSearch = this.reportStore.setTransactionSearch.bind(
      this.reportStore,
    );
    this.connect = this.connectionStore.connect.bind(this.connectionStore);
    this.disconnect = this.connectionStore.disconnect.bind(
      this.connectionStore,
    );
    this.identify = this.connectionStore.identify.bind(this.connectionStore);
    this.runDiagnostic = this.connectionStore.runDiagnostic.bind(
      this.connectionStore,
    );
    this.refreshInfo = this.connectionStore.refreshInfo.bind(
      this.connectionStore,
    );
    this.confirmProvisionalGeometry =
      this.connectionStore.confirmProvisionalGeometry.bind(
        this.connectionStore,
      );
    this.applyBrightness = this.connectionStore.applyBrightness.bind(
      this.connectionStore,
    );
    this.readCharacteristic = this.connectionStore.readCharacteristic.bind(
      this.connectionStore,
    );
    this.toggleSubscription = this.connectionStore.toggleSubscription.bind(
      this.connectionStore,
    );
    this.recordObservation = this.connectionStore.recordObservation.bind(
      this.connectionStore,
    );
    this.importBundle = this.workspaceStore.importBundle.bind(
      this.workspaceStore,
    );
    this.returnToLiveWorkspace = this.workspaceStore.returnToLiveWorkspace.bind(
      this.workspaceStore,
    );
    this.importExternalCapture =
      this.connectionStore.importExternalCapture.bind(this.connectionStore);
    this.updateContentSettings =
      this.contentEditorStore.updateContentSettings.bind(
        this.contentEditorStore,
      );
    this.resetContentSettings =
      this.contentEditorStore.resetContentSettings.bind(
        this.contentEditorStore,
      );
    this.loadImage = this.contentEditorStore.loadImage.bind(
      this.contentEditorStore,
    );
    this.setImageFit = this.contentEditorStore.setImageFit.bind(
      this.contentEditorStore,
    );
    this.setImageProcessing = this.contentEditorStore.setImageProcessing.bind(
      this.contentEditorStore,
    );
    this.loadGif = this.contentEditorStore.loadGif.bind(
      this.contentEditorStore,
    );
    this.requestSendText = this.contentSendStore.requestSendText.bind(
      this.contentSendStore,
    );
    this.requestSendImage = this.contentSendStore.requestSendImage.bind(
      this.contentSendStore,
    );
    this.requestSendAnimation = this.contentSendStore.requestSendAnimation.bind(
      this.contentSendStore,
    );
    this.requestSendGif = this.contentSendStore.requestSendGif.bind(
      this.contentSendStore,
    );
    this.cancelPendingSend = this.contentSendStore.cancelPendingSend.bind(
      this.contentSendStore,
    );
    this.confirmPendingSend = this.contentSendStore.confirmPendingSend.bind(
      this.contentSendStore,
    );
    this.setGuidedStep = this.guidedController.setGuidedStep.bind(
      this.guidedController,
    );
    this.nextGuidedStep = this.guidedController.nextGuidedStep.bind(
      this.guidedController,
    );
    this.previousGuidedStep = this.guidedController.previousGuidedStep.bind(
      this.guidedController,
    );
    this.focusRegion = this.guidedController.focusRegion.bind(
      this.guidedController,
    );
    this.setGuidedObservation = this.guidedController.setGuidedObservation.bind(
      this.guidedController,
    );
    this.submitGuidedObservations =
      this.guidedController.submitGuidedObservations.bind(
        this.guidedController,
      );
    this.continueToNextTest = this.guidedController.continueToNextTest.bind(
      this.guidedController,
    );
    this.reopenExperiment = this.guidedController.reopenExperiment.bind(
      this.guidedController,
    );
    this.measureAgain = this.guidedController.measureAgain.bind(
      this.guidedController,
    );
    this.closeGuidedTest = this.guidedController.closeGuidedTest.bind(
      this.guidedController,
    );
    this.abandonGuidedTest = this.guidedController.abandonGuidedTest.bind(
      this.guidedController,
    );
    this.recordGuidedTimeline = this.guidedController.recordGuidedTimeline.bind(
      this.guidedController,
    );
    this.markObservationMissed =
      this.guidedController.markObservationMissed.bind(this.guidedController);
    this.undoLastMark = this.guidedController.undoLastMark.bind(
      this.guidedController,
    );
    this.requestTimingRetry = this.guidedController.requestTimingRetry.bind(
      this.guidedController,
    );
    this.cancelTimingRetry = this.guidedController.cancelTimingRetry.bind(
      this.guidedController,
    );
    this.retryTimingAttempt = this.guidedController.retryTimingAttempt.bind(
      this.guidedController,
    );
    this.retryFailedGuidedTransfer =
      this.guidedController.retryFailedGuidedTransfer.bind(
        this.guidedController,
      );
    this.startGuidedTest = this.guidedController.startGuidedTest.bind(
      this.guidedController,
    );
    this.confirmGuidedTransfer =
      this.guidedController.confirmGuidedTransfer.bind(this.guidedController);
    this.startTroubleshoot = this.investigationStore.startTroubleshoot.bind(
      this.investigationStore,
    );
    this.startDevelopInvestigation =
      this.investigationStore.startDevelopInvestigation.bind(
        this.investigationStore,
      );
    this.stopInvestigation = this.investigationStore.stopInvestigation.bind(
      this.investigationStore,
    );
    this.resumeStoredInvestigation =
      this.investigationStore.resumeStoredInvestigation.bind(
        this.investigationStore,
      );
    this.forgetLocalHistory = this.investigationStore.forgetLocalHistory.bind(
      this.investigationStore,
    );
    this.reconnectAuthorized = this.investigationStore.reconnectAuthorized.bind(
      this.investigationStore,
    );
    this.exportBundle = this.reportStore.exportBundle.bind(this.reportStore);
    this.markdown = this.reportStore.markdown.bind(this.reportStore);
    this.copy = this.reportStore.copy.bind(this.reportStore);
    this.download = this.reportStore.download.bind(this.reportStore);
    this.copyTestReport = this.reportStore.copyTestReport.bind(
      this.reportStore,
    );
    this.copyInvestigationReport =
      this.reportStore.copyInvestigationReport.bind(this.reportStore);
    this.copyForensicReport = this.reportStore.copyForensicReport.bind(
      this.reportStore,
    );
  }
  readonly initialize: ConnectionStore["initialize"];
  readonly setView: NavigationStore["setView"];
  readonly goHome: NavigationStore["goHome"];
  readonly clearMessage: NoticeStore["clearMessage"];
  readonly openReport: ReportStore["openReport"];
  readonly setReportKind: ReportStore["setReportKind"];
  readonly closeReport: ReportStore["closeReport"];
  readonly setReportOptions: ReportStore["setReportOptions"];
  readonly setTransactionFilter: ReportStore["setTransactionFilter"];
  readonly setTransactionSearch: ReportStore["setTransactionSearch"];
  readonly connect: ConnectionStore["connect"];
  readonly disconnect: ConnectionStore["disconnect"];
  readonly identify: ConnectionStore["identify"];
  readonly runDiagnostic: ConnectionStore["runDiagnostic"];
  readonly refreshInfo: ConnectionStore["refreshInfo"];
  readonly confirmProvisionalGeometry: ConnectionStore["confirmProvisionalGeometry"];
  readonly applyBrightness: ConnectionStore["applyBrightness"];
  readonly readCharacteristic: ConnectionStore["readCharacteristic"];
  readonly toggleSubscription: ConnectionStore["toggleSubscription"];
  readonly recordObservation: ConnectionStore["recordObservation"];
  readonly importBundle: WorkspaceStore["importBundle"];
  readonly returnToLiveWorkspace: WorkspaceStore["returnToLiveWorkspace"];
  readonly importExternalCapture: ConnectionStore["importExternalCapture"];
  readonly updateContentSettings: ContentEditorStore["updateContentSettings"];
  readonly resetContentSettings: ContentEditorStore["resetContentSettings"];
  readonly loadImage: ContentEditorStore["loadImage"];
  readonly setImageFit: ContentEditorStore["setImageFit"];
  readonly setImageProcessing: ContentEditorStore["setImageProcessing"];
  readonly loadGif: ContentEditorStore["loadGif"];
  readonly requestSendText: ContentSendStore["requestSendText"];
  readonly requestSendImage: ContentSendStore["requestSendImage"];
  readonly requestSendAnimation: ContentSendStore["requestSendAnimation"];
  readonly requestSendGif: ContentSendStore["requestSendGif"];
  readonly cancelPendingSend: ContentSendStore["cancelPendingSend"];
  readonly confirmPendingSend: ContentSendStore["confirmPendingSend"];
  readonly setGuidedStep: GuidedController["setGuidedStep"];
  readonly nextGuidedStep: GuidedController["nextGuidedStep"];
  readonly previousGuidedStep: GuidedController["previousGuidedStep"];
  readonly focusRegion: GuidedController["focusRegion"];
  readonly setGuidedObservation: GuidedController["setGuidedObservation"];
  readonly submitGuidedObservations: GuidedController["submitGuidedObservations"];
  readonly continueToNextTest: GuidedController["continueToNextTest"];
  readonly reopenExperiment: GuidedController["reopenExperiment"];
  readonly measureAgain: GuidedController["measureAgain"];
  readonly closeGuidedTest: GuidedController["closeGuidedTest"];
  readonly abandonGuidedTest: GuidedController["abandonGuidedTest"];
  readonly recordGuidedTimeline: GuidedController["recordGuidedTimeline"];
  readonly markObservationMissed: GuidedController["markObservationMissed"];
  readonly undoLastMark: GuidedController["undoLastMark"];
  readonly requestTimingRetry: GuidedController["requestTimingRetry"];
  readonly cancelTimingRetry: GuidedController["cancelTimingRetry"];
  readonly retryTimingAttempt: GuidedController["retryTimingAttempt"];
  readonly retryFailedGuidedTransfer: GuidedController["retryFailedGuidedTransfer"];
  readonly startGuidedTest: GuidedController["startGuidedTest"];
  readonly confirmGuidedTransfer: GuidedController["confirmGuidedTransfer"];
  readonly startTroubleshoot: InvestigationStore["startTroubleshoot"];
  readonly startDevelopInvestigation: InvestigationStore["startDevelopInvestigation"];
  readonly stopInvestigation: InvestigationStore["stopInvestigation"];
  readonly resumeStoredInvestigation: InvestigationStore["resumeStoredInvestigation"];
  readonly forgetLocalHistory: InvestigationStore["forgetLocalHistory"];
  readonly reconnectAuthorized: InvestigationStore["reconnectAuthorized"];
  readonly exportBundle: ReportStore["exportBundle"];
  readonly markdown: ReportStore["markdown"];
  readonly copy: ReportStore["copy"];
  readonly download: ReportStore["download"];
  readonly copyTestReport: ReportStore["copyTestReport"];
  readonly copyInvestigationReport: ReportStore["copyInvestigationReport"];
  readonly copyForensicReport: ReportStore["copyForensicReport"];
  subscribe = (listener: () => void) => this.snapshotStore.subscribe(listener);
  getSnapshot = () => this.snapshotStore.getSnapshot();
  get controller() {
    return this.workspaceStore.getController();
  }
  get transport() {
    return this.workspaceStore.getTransport();
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.snapshotStore.dispose();
    this.contentEditorStore.dispose();
    this.navigationStore.dispose();
    this.disposal = Promise.all([
      this.contentSendStore.dispose(),
      this.workspaceStore.dispose(),
    ]).then(() => undefined);
    return this.disposal;
  }
}
export * from "./state/types";
export { parseServiceHints } from "./service-hints";
export { recommendedAction, useMatrixSnapshot } from "./state/selectors";
