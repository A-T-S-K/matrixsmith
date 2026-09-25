import type { HashRouter } from "./dependencies";
import type { AppSnapshot, WorkspaceView } from "./types";

import type { AppRoute } from "./dependencies";

import type { SnapshotStore } from "./snapshot-store";
import type { ReportStore } from "./report-store";
import type { ContentSendStore } from "./content-send-store";
import type { GuidedController } from "./guided-controller";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  reportStore(): Pick<ReportStore, "setReportOpen">;
  contentSendStore(): Pick<ContentSendStore, "setPendingSend">;
  guidedController(): Pick<
    GuidedController,
    "getGuidedFlow" | "closeGuidedTest"
  >;
}
export class NavigationStore {
  private _page: AppSnapshot["page"] = "home";
  private _view: WorkspaceView = "control";
  private readonly _router: HashRouter | null;
  private _overlayKind: "report" | "send" | "guided" | null = null;
  private _closingOverlayFromHistory = false;
  private cleanups: (() => void)[] = [];
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "back" | "onBack" | "pushOverlay" | "router"
    >,
  ) {
    this._router = environment.router;
  }
  initialize(): void {
    if (this._router) {
      this._applyRoute(this._router.current);
      this.cleanups.push(
        this._router.subscribe((route) => {
          this._applyRoute(route);
          this.ports.snapshotStore()._emit();
        }),
      );
    }
    this.cleanups.push(this.environment.onBack(() => this.onBack()));
  }
  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this._router?.dispose();
  }
  private onBack(): void {
    const kind = this._overlayKind;
    if (!kind) return;
    this._overlayKind = null;
    this._closingOverlayFromHistory = true;
    if (kind === "report") this.ports.reportStore().setReportOpen(false);
    else if (kind === "send")
      this.ports.contentSendStore().setPendingSend(null);
    else if (
      this.ports.guidedController().getGuidedFlow()?.machine.value ===
      "transferring"
    ) {
      this._overlayKind = "guided";
      this.environment.pushOverlay("guided");
    } else this.ports.guidedController().closeGuidedTest();
    this._closingOverlayFromHistory = false;
    this.ports.snapshotStore()._emit();
  }
  setPage(value: NavigationStore["_page"]): void {
    this._page = value;
  }
  setViewState(value: NavigationStore["_view"]): void {
    this._view = value;
  }
  getRouter() {
    return this._router;
  }
  getView() {
    return this._view;
  }
  getPage() {
    return this._page;
  }
  setView(view: WorkspaceView): void {
    this._page = "workspace";
    this._view = view;
    this._router?.navigate(
      view === "control"
        ? "create"
        : view === "diagnose"
          ? "investigate"
          : "develop-transactions",
    );
    this.ports.snapshotStore()._emit();
  }
  goHome(): void {
    this._page = "home";
    this._router?.navigate("home");
    this.ports.snapshotStore()._emit();
  }
  _openOverlay(kind: "report" | "send" | "guided"): void {
    if (!this._router || this._overlayKind) return;
    this._overlayKind = kind;
    this.environment.pushOverlay(kind);
  }
  _closeOverlay(kind: "report" | "send" | "guided"): void {
    if (this._overlayKind !== kind) return;
    this._overlayKind = null;
    if (!this._closingOverlayFromHistory) this.environment.back();
  }
  _applyRoute(route: AppRoute): void {
    switch (route.id) {
      case "home":
        this._page = "home";
        return;
      case "create":
        this._page = "workspace";
        this._view = "control";
        return;
      case "investigate":
        this._page = "workspace";
        this._view = "diagnose";
        return;
      case "develop-transactions":
      case "develop-gatt":
        this._page = "workspace";
        this._view = "develop";
        return;
      case "offline-report":
        this._page = "workspace";
        this._view = "diagnose";
        return;
    }
  }
}
