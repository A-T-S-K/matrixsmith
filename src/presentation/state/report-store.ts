import { generateMarkdownReport, MATRIXSMITH_VERSION } from "./dependencies";
import type { ReportData } from "./dependencies";
import type { ReportKind } from "./types";
import { DEFAULT_REPORT_OPTIONS } from "./dependencies";
import type { ReportOptions, FilesPort } from "./dependencies";
import type { TransactionFilter } from "./types";

import type { NavigationStore } from "./navigation-store";
import type { SnapshotStore } from "./snapshot-store";
import type { WorkspaceStore } from "./workspace-store";
import type { NoticeStore } from "./notice-store";
import type { GuidedController } from "./guided-controller";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  navigationStore(): Pick<NavigationStore, "_openOverlay" | "_closeOverlay">;
  snapshotStore(): Pick<SnapshotStore, "_emit" | "getSnapshot">;
  workspaceStore(): Pick<WorkspaceStore, "getController" | "getTransport">;
  noticeStore(): Pick<NoticeStore, "setInfo" | "setError">;
  guidedController(): Pick<GuidedController, "getGuidedFlow">;
}
export class ReportStore {
  private _reportOpen = false;
  private _reportKind: ReportKind | null = null;
  private _reportOptions: ReportOptions = DEFAULT_REPORT_OPTIONS;
  private _transactionFilter: TransactionFilter = "all";
  private _transactionSearch = "";
  private readonly _files: FilesPort;
  constructor(
    private readonly ports: Ports,
    environment: Pick<PresentationEnvironment, "files">,
  ) {
    this._files = environment.files;
  }
  getTransactionFilter() {
    return this._transactionFilter;
  }
  getTransactionSearch() {
    return this._transactionSearch;
  }
  getReportOpen() {
    return this._reportOpen;
  }
  getReportOptions() {
    return this._reportOptions;
  }
  setReportOpen(value: ReportStore["_reportOpen"]): void {
    this._reportOpen = value;
  }
  openReport(): void {
    this.ports.navigationStore()._openOverlay("report");
    this._reportOpen = true;
    this.ports.snapshotStore()._emit();
  }
  setReportKind(kind: ReportKind): void {
    this._reportKind = kind;
    this.ports.snapshotStore()._emit();
  }
  closeReport(): void {
    this._reportOpen = false;
    this.ports.navigationStore()._closeOverlay("report");
    this.ports.snapshotStore()._emit();
  }
  setReportOptions(options: ReportOptions): void {
    this._reportOptions = options;
    this.ports.snapshotStore()._emit();
  }
  setTransactionFilter(value: TransactionFilter): void {
    this._transactionFilter = value;
    this.ports.snapshotStore()._emit();
  }
  setTransactionSearch(value: string): void {
    this._transactionSearch = value;
    this.ports.snapshotStore()._emit();
  }
  exportBundle(
    privacy: import("../../diagnostics/bundle").BundlePrivacy = "shareable",
  ): string {
    return this.ports.workspaceStore().getController().exportBundle(privacy);
  }
  markdown(): string {
    // The active investigation supplies the report question when the user
    // hasn't typed one, so pasted reports always carry the actual goal.
    const goal =
      this._reportOptions.goal.trim() ||
      this.ports.workspaceStore().getController().investigation?.goal
        .description ||
      "";
    return generateMarkdownReport(this._reportData(), {
      ...this._reportOptions,
      goal,
    });
  }
  async copy(text: string): Promise<void> {
    const copied = await this._files.copyText(text);
    if (copied) this.ports.noticeStore().setInfo("Copied to clipboard.");
    else
      this.ports
        .noticeStore()
        .setError("Clipboard access was denied. Use Download instead.");
    this.ports.snapshotStore()._emit();
  }
  download(filename: string, content: string, type: string): void {
    this._files.download(filename, content, type);
  }
  async copyTestReport(testId?: string): Promise<void> {
    const id = testId ?? this.ports.guidedController().getGuidedFlow()?.testId;
    if (!id) return;
    try {
      await this.copy(
        this.ports.workspaceStore().getController().testReportMarkdown(id),
      );
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
      this.ports.snapshotStore()._emit();
    }
  }
  async copyInvestigationReport(): Promise<void> {
    try {
      await this.copy(
        this.ports
          .workspaceStore()
          .getController()
          .investigationReportMarkdown(),
      );
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
      this.ports.snapshotStore()._emit();
    }
  }
  async copyForensicReport(): Promise<void> {
    try {
      await this.copy(
        this.ports.workspaceStore().getController().forensicReportMarkdown(),
      );
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
      this.ports.snapshotStore()._emit();
    }
  }
  _effectiveReportKind(): ReportKind {
    if (this._reportKind) return this._reportKind;
    return this.ports.workspaceStore().getController().investigation
      ? "investigation"
      : "device";
  }
  _reportMarkdownForKind(): string {
    try {
      switch (this._effectiveReportKind()) {
        case "investigation":
          return this.ports
            .workspaceStore()
            .getController()
            .investigationReportMarkdown();
        case "forensic":
          return this.ports
            .workspaceStore()
            .getController()
            .forensicReportMarkdown();
        case "device":
          return this.markdown();
      }
    } catch (error) {
      return `Report unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  _reportData(): ReportData {
    const session = this.ports.workspaceStore().getController().session;
    const fingerprint = session.fingerprint;
    if (!fingerprint)
      throw new Error("No device evidence is available for a report.");
    const driver = session.selection?.selected;
    return {
      createdAt: new Date().toISOString(),
      matrixsmithVersion: MATRIXSMITH_VERSION,
      fingerprint,
      profile: session.profile,
      selectedDriver: driver?.id ?? null,
      driverMatches: session.selection?.matches ?? [],
      capabilities:
        driver && session.profile ? driver.capabilities(session.profile) : [],
      transactions: this.ports.workspaceStore().getController().transactions,
      diagnosticRuns: this.ports.workspaceStore().getController()
        .diagnosticRuns,
      observations: this.ports.workspaceStore().getController().observations,
      trace: this.ports.workspaceStore().getController().trace.events,
      protocolResolution: session.protocolResolution,
      contentCompilations: this.ports.workspaceStore().getController()
        .contentCompilations,
      importedEvidence: this.ports.workspaceStore().getController()
        .importedEvidence,
      liveConnected:
        session.source === "live" &&
        this.ports.workspaceStore().getTransport().state === "connected",
      source: session.source,
      assessment: this.ports.snapshotStore().getSnapshot().assessment,
      investigationActive:
        this.ports.workspaceStore().getController().investigation !== null,
    };
  }
}
