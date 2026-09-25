import { ApplicationRuntime } from "./dependencies";
import type { MatrixTransport } from "./dependencies";

import { parseDiagnosticBundle } from "./dependencies";

import type { NoticeStore } from "./notice-store";
import type { SnapshotStore } from "./snapshot-store";
import type { NavigationStore } from "./navigation-store";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  noticeStore(): Pick<NoticeStore, "setError" | "setInfo" | "getBusy">;
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  navigationStore(): Pick<
    NavigationStore,
    "setPage" | "setViewState" | "getRouter" | "getView"
  >;
}
export class WorkspaceStore {
  private controller: ApplicationRuntime;
  private transport: MatrixTransport;
  private _liveWorkspace: {
    readonly controller: ApplicationRuntime;
    readonly transport: MatrixTransport;
  } | null = null;
  private cleanups: (() => void)[] = [];
  private retired = new Set<ApplicationRuntime>();
  private disposed = false;
  private disposal: Promise<void> | null = null;
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "createOfflineWorkspace"
    >,
    controller: ApplicationRuntime,
    transport: MatrixTransport,
  ) {
    this.controller = controller;
    this.transport = transport;
  }
  initialize(): void {
    this.watchActive();
  }
  private watchActive(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.cleanups.push(
      this.controller.trace.subscribe(() => this.ports.snapshotStore()._emit()),
    );
    const unsubscribe = this.transport.subscribeState?.(() =>
      this.ports.snapshotStore()._emit(),
    );
    if (unsubscribe) this.cleanups.push(unsubscribe);
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const runtimes = new Set([this.controller, ...this.retired]);
    if (this._liveWorkspace) runtimes.add(this._liveWorkspace.controller);
    this.disposal = Promise.all(
      [...runtimes].map((runtime) => runtime.dispose()),
    ).then(() => {
      this.retired.clear();
    });
    return this.disposal;
  }
  private retire(runtime: ApplicationRuntime): void {
    this.retired.add(runtime);
    void runtime.dispose().then(
      () => this.retired.delete(runtime),
      (error: unknown) => {
        if (!this.disposed) {
          this.ports
            .noticeStore()
            .setError(`Workspace cleanup failed: ${String(error)}`);
          this.ports.snapshotStore()._emit();
        }
      },
    );
  }
  getController() {
    return this.controller;
  }
  getTransport() {
    return this.transport;
  }
  getLiveWorkspace() {
    return this._liveWorkspace;
  }
  importBundle(json: string): void {
    if (this.ports.noticeStore().getBusy()) {
      this.ports
        .noticeStore()
        .setError(
          "Finish the current operation before opening another workspace.",
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    let bundle: ReturnType<typeof parseDiagnosticBundle>;
    try {
      bundle = parseDiagnosticBundle(json);
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
      this.ports.snapshotStore()._emit();
      return;
    }
    if (
      this.controller.session.source === "live" &&
      this.transport.state === "connected"
    )
      this._liveWorkspace = {
        controller: this.controller,
        transport: this.transport,
      };
    const { transport: replay, controller: offline } =
      this.environment.createOfflineWorkspace(bundle.fingerprint);
    offline.importBundle(json);
    const previous = this.controller;
    this.controller = offline;
    this.transport = replay;
    this.watchActive();
    if (previous !== this._liveWorkspace?.controller) this.retire(previous);
    this.ports.navigationStore().setPage("workspace");
    this.ports.navigationStore().setViewState("diagnose");
    this.ports.navigationStore().getRouter()?.navigate("offline-report");
    this.ports
      .noticeStore()
      .setInfo(
        "Diagnostic report opened offline. Live operations remain blocked.",
      );
    this.ports.snapshotStore()._emit();
  }
  returnToLiveWorkspace(): void {
    const live = this._liveWorkspace;
    if (!live) return;
    const previous = this.controller;
    this.controller = live.controller;
    this.transport = live.transport;
    this._liveWorkspace = null;
    this.watchActive();
    this.retire(previous);
    this.ports.navigationStore().setPage("workspace");
    this.ports
      .navigationStore()
      .setViewState(
        this.controller.assessment().readiness === "ready"
          ? "control"
          : "diagnose",
      );
    this.ports
      .navigationStore()
      .getRouter()
      ?.navigate(
        this.ports.navigationStore().getView() === "control"
          ? "create"
          : "investigate",
      );
    this.ports
      .noticeStore()
      .setInfo(
        "Returned to the live display. Offline report evidence remains separate.",
      );
    this.ports.snapshotStore()._emit();
  }
}
