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
  captureContext() {
    return {
      kind: this._reportKind,
      options: this._reportOptions,
      filter: this._transactionFilter,
      search: this._transactionSearch,
      note: this.reviewNote,
      lastValidMarkdown: this._lastValidMarkdown,
      previewError: this._previewError,
      actionError: this._actionError,
    };
  }
  restoreContext(
    state: ReturnType<ReportStore["captureContext"]> | null,
  ): void {
    this._actionGeneration++;
    this._previewOwner = this.ports.workspaceStore().getController();
    this._reportOpen = false;
    this._reportKind = state?.kind ?? null;
    this._reportOptions = state?.options ?? DEFAULT_REPORT_OPTIONS;
    this._transactionFilter = state?.filter ?? "all";
    this._transactionSearch = state?.search ?? "";
    this.reviewNote = state?.note ?? "";
    this._lastValidMarkdown = state?.lastValidMarkdown ?? "";
    this._previewError = state?.previewError ?? null;
    this._actionError = state?.actionError ?? null;
  }
  private reviewNote = "";
  getReviewNote() {
    return this.reviewNote;
  }
  setReviewNote(value: string): void {
    this.reviewNote = value;
    this.ports.snapshotStore()._emit();
  }
  private _reportOpen = false;
  private _reportKind: ReportKind | null = null;
  private _reportOptions: ReportOptions = DEFAULT_REPORT_OPTIONS;
  private _transactionFilter: TransactionFilter = "all";
  private _transactionSearch = "";
  private readonly _files: FilesPort;
  private _previewOwner: ReturnType<WorkspaceStore["getController"]> | null =
    null;
  private _lastValidMarkdown = "";
  private _previewError: string | null = null;
  private _actionError: string | null = null;
  private _actionGeneration = 0;
  private syncWorkspace(): void {
    const owner = this.ports.workspaceStore().getController();
    if (owner === this._previewOwner) return;
    this._previewOwner = owner;
    this._lastValidMarkdown = "";
    this._previewError = null;
    this._actionError = null;
    this._actionGeneration++;
  }
  getReportError(): string | null {
    this.syncWorkspace();
    return this._actionError ?? this._previewError;
  }
  getReportPreviewFailed(): boolean {
    return this._previewError !== null;
  }
  private async action(
    work: () => void | Promise<void>,
    success?: string,
  ): Promise<void> {
    this.syncWorkspace();
    const owner = this._previewOwner;
    const generation = ++this._actionGeneration;
    this.ports.noticeStore().setInfo(null);
    try {
      await work();
      this.syncWorkspace();
      if (owner !== this._previewOwner || generation !== this._actionGeneration)
        return;
      this._actionError = null;
      if (success) this.ports.noticeStore().setInfo(success);
    } catch (error) {
      this.syncWorkspace();
      if (owner !== this._previewOwner || generation !== this._actionGeneration)
        return;
      this._actionError =
        error instanceof Error ? error.message : String(error);
      this.ports.noticeStore().setError(this._actionError);
    }
    this.ports.snapshotStore()._emit();
  }
  private async copyContent(text: string): Promise<void> {
    if (!(await this._files.copyText(text)))
      throw new Error("Clipboard access was denied. Use Download instead.");
  }
  async copyReport(): Promise<void> {
    await this.action(
      () => this.copyContent(this.generateSelected()),
      "Copied to clipboard.",
    );
  }
  async downloadReport(
    filename: string,
    privacy?: import("../../diagnostics/bundle").BundlePrivacy,
  ): Promise<void> {
    await this.action(() => {
      const content = privacy
        ? this.exportBundle(privacy)
        : this.generateSelected();
      return this._files.download(
        filename,
        content,
        privacy ? "application/json" : "text/markdown",
      );
    });
  }
  retryReport(): void {
    this._actionError = null;
    this.ports.snapshotStore()._emit();
  }

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
    await this.action(() => this.copyContent(text), "Copied to clipboard.");
  }
  download(filename: string, content: string, type: string): void {
    void this.action(() => this._files.download(filename, content, type));
  }
  async copyTestReport(testId?: string): Promise<void> {
    const id = testId ?? this.ports.guidedController().getGuidedFlow()?.testId;
    if (!id) return;
    await this.action(
      () =>
        this.copyContent(
          this.ports.workspaceStore().getController().testReportMarkdown(id),
        ),
      "Copied to clipboard.",
    );
  }
  async copyInvestigationReport(): Promise<void> {
    await this.action(
      () =>
        this.copyContent(
          this.ports
            .workspaceStore()
            .getController()
            .investigationReportMarkdown(),
        ),
      "Copied to clipboard.",
    );
  }
  async copyForensicReport(): Promise<void> {
    await this.action(
      () =>
        this.copyContent(
          this.ports.workspaceStore().getController().forensicReportMarkdown(),
        ),
      "Copied to clipboard.",
    );
  }
  _effectiveReportKind(): ReportKind {
    if (
      this._reportKind &&
      (this._reportKind !== "investigation" ||
        this.ports.workspaceStore().getController().investigation)
    )
      return this._reportKind;
    return this.ports.workspaceStore().getController().investigation
      ? "investigation"
      : "device";
  }
  private generateSelected(): string {
    const controller = this.ports.workspaceStore().getController();
    switch (this._effectiveReportKind()) {
      case "investigation":
        return controller.investigationReportMarkdown(
          this._reportOptions.includeIdentifiers,
        );
      case "forensic":
        return controller.forensicReportMarkdown(
          this._reportOptions.includeIdentifiers,
        );
      case "device":
        return this.markdown();
    }
  }
  _reportMarkdownForKind(): string {
    this.syncWorkspace();
    try {
      const markdown = this.generateSelected();
      this._lastValidMarkdown = markdown;
      this._previewError = null;
      return markdown;
    } catch (error) {
      this._previewError =
        error instanceof Error ? error.message : String(error);
      return this._lastValidMarkdown;
    }
  }
  _reportData(): ReportData {
    const session = this.ports.workspaceStore().getController().session;
    const fingerprint = session.fingerprint;
    if (!fingerprint)
      throw new Error("No device evidence is available for a report.");
    const driver = session.selection?.selected;
    return {
      privacyContext:
        this.ports.workspaceStore().getController().investigation ?? undefined,
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
