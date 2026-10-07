import {
  prepareDiagnosticBundleImport,
  readPreparedDiagnosticBundle,
} from "./dependencies";
import type { ApplicationRuntime, MatrixTransport } from "./dependencies";
import type { NoticeStore } from "./notice-store";
import type { SnapshotStore } from "./snapshot-store";
import type { NavigationStore } from "./navigation-store";
import type { ContentEditorStore } from "./content-editor-store";
import type { ContentSendStore } from "./content-send-store";
import type { ReportStore } from "./report-store";
import type { ConnectionStore } from "./connection-store";
import type { PresentationEnvironment } from "../environment";
import type { WorkspaceContext } from "../app/routes";

/** In-memory UI only. No session, transport, execution, confirmation or unlock. */
export interface WorkspaceUiState {
  readonly view: ReturnType<NavigationStore["getView"]>;
  readonly editor: ReturnType<ContentEditorStore["captureContext"]>;
  readonly caches: ReturnType<ContentSendStore["captureCaches"]>;
  readonly report: ReturnType<ReportStore["captureContext"]>;
  readonly notice: ReturnType<NoticeStore["captureContext"]>;
  readonly connection: ReturnType<ConnectionStore["captureContext"]>;
}
interface Workspace {
  readonly controller: ApplicationRuntime;
  readonly transport: MatrixTransport;
  readonly generation: string;
  established: boolean;
  label: string;
  ui: WorkspaceUiState | null;
  cleanups: (() => void)[];
}
interface Ports {
  captureUi(): WorkspaceUiState;
  restoreUi(state: WorkspaceUiState | null): void;
  cancelConfirmations(): void;
  guidedActive(): boolean;
  noticeStore(): Pick<NoticeStore, "setError" | "setInfo" | "getBusy">;
  snapshotStore(): Pick<
    SnapshotStore,
    "_emit" | "_scheduleTracePublication" | "_cancelTracePublication"
  >;
  navigationStore(): Pick<
    NavigationStore,
    | "setPage"
    | "setViewState"
    | "setView"
    | "getView"
    | "cancelContextOverlays"
    | "goHome"
  >;
}
export class WorkspaceStore {
  private active: Workspace;
  private live: Workspace | null;
  private offline: Workspace | null = null;
  private nextGeneration = 0;
  private readonly lifetime =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private retired = new WeakSet<ApplicationRuntime>();
  private retirements = new Map<ApplicationRuntime, Promise<void>>();
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "createOfflineWorkspace" | "createLiveWorkspace" | "fileActivity"
    >,
    controller: ApplicationRuntime,
    transport: MatrixTransport,
  ) {
    this.active = this.makeWorkspace({ controller, transport });
    this.live = this.active;
  }
  private makeWorkspace(runtime: {
    controller: ApplicationRuntime;
    transport: MatrixTransport;
  }): Workspace {
    return {
      ...runtime,
      generation: `${this.lifetime}:${++this.nextGeneration}`,
      established: Boolean(runtime.controller.session.fingerprint),
      label: runtime.controller.session.fingerprint?.name ?? "Live display",
      ui: null,
      cleanups: [],
    };
  }
  initialize(): void {
    this.watch(this.active);
  }
  private watch(workspace: Workspace): void {
    const current = () =>
      !this.disposed && (this.live === workspace || this.offline === workspace);
    const updateLabel = () => {
      if (workspace.controller.session.fingerprint) {
        workspace.established = true;
        workspace.label =
          workspace.controller.session.fingerprint.name ?? "Unnamed display";
      }
    };
    workspace.cleanups.push(
      workspace.controller.trace.subscribe((event) => {
        if (!current()) return;
        updateLabel();
        // Ownership/recovery signals must invalidate UI and update readiness now.
        if (
          event.type === "disconnect" ||
          event.type === "connection.quarantined" ||
          event.type === "connection.unexpected-disconnect.handled" ||
          event.type === "discovery.progress"
        )
          this.ports.snapshotStore()._emit();
        else
          this.ports
            .snapshotStore()
            ._scheduleTracePublication(workspace.generation, current);
      }),
    );
    const unsubscribe = workspace.transport.subscribeState?.(() => {
      if (!current()) return;
      updateLabel();
      this.ports.snapshotStore()._emit();
    });
    if (unsubscribe) workspace.cleanups.push(unsubscribe);
  }
  private retire(workspace: Workspace): Promise<void> {
    workspace.ui = null;
    this.ports.snapshotStore()._cancelTracePublication(workspace.generation);
    for (const cleanup of workspace.cleanups.splice(0)) cleanup();
    const existing = this.retirements.get(workspace.controller);
    if (existing) return existing;
    if (this.retired.has(workspace.controller)) return Promise.resolve();
    this.retired.add(workspace.controller);
    const disposal = workspace.controller.dispose();
    this.retirements.set(workspace.controller, disposal);
    // Retirement errors belong to this runtime; never publish into another context.
    void disposal.then(
      () => this.retirements.delete(workspace.controller),
      () => this.retirements.delete(workspace.controller),
    );
    return disposal;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const workspaces = new Set([this.active, this.live, this.offline]);
    for (const workspace of workspaces)
      if (workspace) void this.retire(workspace);
    this.disposal = Promise.all(this.retirements.values()).then(() => {
      this.live = null;
      this.offline = null;
      this.retirements.clear();
    });
    return this.disposal;
  }
  getController() {
    return this.active.controller;
  }
  getTransport() {
    return this.active.transport;
  }
  getContext(): WorkspaceContext {
    return this.active === this.offline ? "offline" : "live";
  }
  getLiveWorkspace() {
    return this.live !== this.active && this.live?.established
      ? this.live
      : null;
  }
  getLiveConnection() {
    return this.live?.transport.state ?? null;
  }
  getOfflineAvailable() {
    return this.offline !== null;
  }
  getContextLabel() {
    return this.active.label;
  }
  getContextIdentity() {
    return this.active.generation;
  }
  getReportGeneration() {
    return this.offline?.generation;
  }
  transitionReason(includeFiles = true): string | null {
    if (this.disposed) return "This application has been closed.";
    if (
      this.active.controller.executionBusy ||
      this.ports.noticeStore().getBusy()
    )
      return "Finish the current operation before changing workspace. Use disconnect recovery if the transfer outcome is unknown.";
    if (includeFiles && this.environment.fileActivity?.active)
      return "Finish importing the file before changing workspace.";
    if (this.ports.guidedActive())
      return "Finish or explicitly close the guided test before changing workspace.";
    return null;
  }
  private blocked(includeFiles = true): boolean {
    const reason = this.transitionReason(includeFiles);
    if (!reason) return false;
    this.ports.noticeStore().setError(reason);
    this.ports.snapshotStore()._emit();
    return true;
  }
  private activate(workspace: Workspace): void {
    if (this.active === workspace) return;
    this.active.controller.session.disableExperimentalTx();
    this.active.controller.session.consumePersistentConfirmation();
    this.ports.cancelConfirmations();
    this.ports.navigationStore().cancelContextOverlays();
    this.active.ui = this.ports.captureUi();
    this.active = workspace;
    this.ports.restoreUi(workspace.ui);
  }
  /** Routing never creates a runtime or grants connection authority. */
  selectContext(context: WorkspaceContext, reportGeneration?: string): boolean {
    const target = context === "live" ? this.live : this.offline;
    if (
      this.disposed ||
      !target ||
      (context === "offline" &&
        reportGeneration !== undefined &&
        target.generation !== reportGeneration)
    )
      return false;
    const activeCapture =
      target === this.active &&
      target.controller.session.source === "imported" &&
      target.controller.importedEvidence.length > 0;
    if (target !== this.active) {
      if (this.blocked()) return false;
      this.activate(target);
    }
    // Accepted historical capture can be reviewed in its current owner without
    // claiming an established physical display or creating a replay workspace.
    return target.established || activeCapture;
  }
  importBundle(json: string): void {
    if (this.blocked(false)) return;
    let replacement: Workspace | null = null;
    try {
      const prepared = prepareDiagnosticBundleImport(json);
      const bundle = readPreparedDiagnosticBundle(prepared);
      replacement = this.makeWorkspace(
        this.environment.createOfflineWorkspace(bundle.fingerprint),
      );
      replacement.controller.adoptPreparedBundle(prepared);
      replacement.established = true;
      replacement.label =
        replacement.controller.session.fingerprint?.name ?? "Offline report";
    } catch (error) {
      if (replacement) void this.retire(replacement);
      this.ports
        .noticeStore()
        .setError(
          error instanceof Error ? error.message : String(error),
          "diagnostic-import",
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    this.ports.noticeStore().setError(null, "diagnostic-import");
    const previous = this.offline;
    // A never-used bootstrap runtime is not a retained physical workspace.
    const unusedLive =
      this.live &&
      !this.live.established &&
      this.live.transport.state === "idle"
        ? this.live
        : null;
    this.offline = replacement;
    this.watch(replacement);
    this.activate(replacement);
    if (unusedLive) {
      this.live = null;
      void this.retire(unusedLive);
    }
    if (previous) void this.retire(previous);
    this.ports.navigationStore().setView("diagnose");
    this.ports
      .noticeStore()
      .setInfo(
        "Diagnostic report opened offline. Live operations remain blocked.",
      );
    this.ports.snapshotStore()._emit();
  }
  profileRegistry() {
    return (this.live ?? this.active).controller.registry;
  }
  profileLoadReason(): string | null {
    return (
      this.transitionReason() ??
      (this.live && !["idle", "error"].includes(this.live.transport.state)
        ? "Disconnect the live display before loading profiles. Drafts will be preserved; a later Connect starts a fresh session."
        : null)
    );
  }
  loadProfileRegistry(
    registry: import("../../drivers/registry").DriverRegistry,
  ): void {
    const reason = this.profileLoadReason();
    if (reason) throw new Error(reason);
    // Complete construction before publication. Failed construction changes nothing.
    const replacement = this.makeWorkspace(
      this.environment.createLiveWorkspace(registry),
    );
    if (
      replacement.controller.registry !== registry ||
      replacement.transport.state !== "idle"
    ) {
      void this.retire(replacement);
      throw new Error(
        "The workspace factory did not prepare the accepted definitions in a disconnected runtime.",
      );
    }
    const previous = this.live;
    const wasActive = this.active === previous;
    const ui = wasActive ? this.ports.captureUi() : previous?.ui;
    replacement.ui = ui ?? null;
    this.live = replacement;
    this.watch(replacement);
    if (wasActive) this.activate(replacement);
    if (previous) void this.retire(previous);
    this.ports
      .noticeStore()
      .setInfo(
        "Profile loaded for this browser session. Connect explicitly when ready; no connection or transmission occurred.",
      );
    this.ports.snapshotStore()._emit();
  }
  prepareLiveWorkspace() {
    if (this.disposed) throw new Error("This application has been closed.");
    if (!this.live) {
      this.live = this.makeWorkspace(this.environment.createLiveWorkspace());
      this.watch(this.live);
    }
    return this.live;
  }
  activateConnectedLive(controller: ApplicationRuntime): boolean {
    if (
      this.disposed ||
      this.live?.controller !== controller ||
      this.live.transport.state !== "connected"
    )
      return false;
    this.activate(this.live);
    return true;
  }
  returnToLiveWorkspace(): void {
    this.returnTo("live");
  }
  returnToOfflineWorkspace(): void {
    this.returnTo("offline");
  }
  private returnTo(context: WorkspaceContext): void {
    if (this.blocked()) return;
    const target = context === "live" ? this.live : this.offline;
    if (!target) return;
    this.activate(target);
    const view =
      target.ui?.view ??
      (context === "offline"
        ? "diagnose"
        : target.controller.assessment().readiness === "ready"
          ? "control"
          : "diagnose");
    this.ports.navigationStore().setView(view);
  }
  closeOfflineWorkspace(): void {
    if (this.blocked() || !this.offline) return;
    const previous = this.offline;
    if (this.active === previous) {
      if (!this.live) {
        this.live = this.makeWorkspace(this.environment.createLiveWorkspace());
        this.watch(this.live);
      }
      this.activate(this.live);
      this.ports.navigationStore().goHome();
    }
    this.offline = null;
    void this.retire(previous);
    this.ports.snapshotStore()._emit();
  }
}
