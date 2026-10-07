import {
  workbenchRoute,
  type WorkbenchSection,
  type WorkspaceContext,
} from "../app/routes";
import type { WorkspaceStore } from "./workspace-store";
import type { ProjectionStore } from "./projection-store";
import type { HashRouter } from "./dependencies";
import type { AppSnapshot, WorkspaceView } from "./types";

import type { AppRoute } from "./dependencies";

import type { SnapshotStore } from "./snapshot-store";
import type { ReportStore } from "./report-store";
import type { ContentSendStore } from "./content-send-store";
import type { GuidedController } from "./guided-controller";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  workspaceStore(): Pick<
    WorkspaceStore,
    | "getController"
    | "getContext"
    | "selectContext"
    | "transitionReason"
    | "getReportGeneration"
    | "getContextIdentity"
  >;
  projectionStore(): Pick<ProjectionStore, "refreshHistory">;
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  reportStore(): Pick<ReportStore, "setReportOpen" | "review">;
  contentSendStore(): Pick<ContentSendStore, "setPendingSend">;
  guidedController(): Pick<
    GuidedController,
    "getGuidedFlow" | "closeGuidedTest"
  >;
}
export class NavigationStore {
  private readonly views = new WeakMap<
    ReturnType<WorkspaceStore["getController"]>,
    WorkspaceView
  >();
  getContextView(): WorkspaceView {
    return (
      this.views.get(this.ports.workspaceStore().getController()) ??
      (this.context() === "offline" ? "diagnose" : "control")
    );
  }
  private readonly sections = new WeakMap<
    ReturnType<WorkspaceStore["getController"]>,
    WorkbenchSection
  >();
  private acceptedRoute: AppRoute | null = null;
  private missingContext: WorkspaceContext | null = null;
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
    this.views.set(this.ports.workspaceStore().getController(), value);
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
  getWorkbenchSection(): WorkbenchSection {
    return (
      this.sections.get(this.ports.workspaceStore().getController()) ??
      "transactions"
    );
  }
  getMissingContext() {
    return this.missingContext;
  }
  private context(): WorkspaceContext {
    return this.ports.workspaceStore().getContext();
  }
  setWorkbenchSection(section: WorkbenchSection): void {
    this.sections.set(this.ports.workspaceStore().getController(), section);
    this.setView("develop");
  }
  setView(view: WorkspaceView): void {
    this.missingContext = null;
    this._page = "workspace";
    this._view =
      this.context() === "offline" && view === "control" ? "diagnose" : view;
    view = this._view;
    this.views.set(this.ports.workspaceStore().getController(), view);
    const review = this.ports.reportStore().review;
    this._router?.navigate(
      view === "develop"
        ? workbenchRoute(this.context(), this.getWorkbenchSection())
        : this.context() === "offline"
          ? "offline-report"
          : view === "control"
            ? "create"
            : "investigate",
      false,
      this.context() === "offline"
        ? this.ports.workspaceStore().getReportGeneration()
        : undefined,
      view === "develop" &&
        this.getWorkbenchSection() === "transactions" &&
        review.selected
        ? {
            transactionId: review.selected,
            generation: this.ports.workspaceStore().getContextIdentity(),
          }
        : undefined,
    );
    this.ports.snapshotStore()._emit();
  }
  openTransaction(id: string): void {
    const review = this.ports.reportStore().review;
    review.origin = id;
    if (review.packetOwner !== id) review.packetPage = 0;
    review.packetOwner = id;
    review.selected = id;
    review.restoreFocus = false;
    if (this._router)
      this._router.navigate(
        workbenchRoute(this.context(), "transactions"),
        false,
        this.context() === "offline"
          ? this.ports.workspaceStore().getReportGeneration()
          : undefined,
        {
          transactionId: id,
          generation: this.ports.workspaceStore().getContextIdentity(),
        },
      );
    this.ports.snapshotStore()._emit();
  }
  closeTransaction(): void {
    const review = this.ports.reportStore().review;
    review.selected = null;
    review.restoreFocus = true;
    this._router?.navigate(
      workbenchRoute(this.context(), "transactions"),
      false,
      this.context() === "offline"
        ? this.ports.workspaceStore().getReportGeneration()
        : undefined,
    );
    this.ports.snapshotStore()._emit();
  }
  goHome(): void {
    this.ports.projectionStore().refreshHistory();
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
  cancelContextOverlays(): void {
    this._overlayKind = null;
    this.ports.reportStore().setReportOpen(false);
    this.ports.contentSendStore().setPendingSend(null);
  }
  _applyRoute(route: AppRoute): void {
    if (
      route.id !== "home" &&
      route.context !== this.context() &&
      this.ports.workspaceStore().transitionReason()
    ) {
      this.ports
        .workspaceStore()
        .selectContext(route.context, route.reportGeneration);
      if (this.acceptedRoute)
        this._router?.navigate(
          this.acceptedRoute.id,
          true,
          this.acceptedRoute.reportGeneration,
          this.acceptedRoute.transactionId &&
            this.acceptedRoute.reviewGeneration
            ? {
                transactionId: this.acceptedRoute.transactionId,
                generation: this.acceptedRoute.reviewGeneration,
              }
            : undefined,
        );
      return;
    }
    this.acceptedRoute = route;
    this.missingContext = null;
    if (route.id === "home") {
      this.ports.projectionStore().refreshHistory();
      this._page = "home";
      return;
    }
    this._page = "workspace";
    if (
      !this.ports
        .workspaceStore()
        .selectContext(route.context, route.reportGeneration)
    )
      this.missingContext = route.context;
    if (
      route.transactionId &&
      (this.missingContext ||
        route.reviewGeneration !==
          this.ports.workspaceStore().getContextIdentity())
    )
      this.missingContext = route.context;
    if ("section" in route) {
      this._view = "develop";
      if (!this.missingContext) {
        if (route.section === "transactions") {
          const review = this.ports.reportStore().review;
          if (review.selected && !route.transactionId)
            review.restoreFocus = true;
          if (
            route.transactionId &&
            review.packetOwner !== route.transactionId
          ) {
            review.packetPage = 0;
            review.packetOwner = route.transactionId;
          }
          review.selected = route.transactionId ?? null;
          if (route.transactionId) review.origin = route.transactionId;
        }
        this.sections.set(
          this.ports.workspaceStore().getController(),
          route.section,
        );
      }
    } else this._view = route.id === "create" ? "control" : "diagnose";
    if (!this.missingContext)
      this.views.set(this.ports.workspaceStore().getController(), this._view);
  }
}
