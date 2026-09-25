import {
  resolvesToScroll,
  diagnosticAnimation,
  RASTER_STRATEGY_LABELS,
} from "./dependencies";

import type { ContentState } from "./types";
import {
  SYMPTOM_ROWS,
  recommendationView,
  endpointKey,
  supportRows,
  recommendedFromAssessment,
  filterTransactions,
} from "./selectors";

import type { AppSnapshot } from "./types";

import type { WorkspaceStore } from "./workspace-store";
import type { ReportStore } from "./report-store";
import type { NavigationStore } from "./navigation-store";
import type { NoticeStore } from "./notice-store";
import type { ConnectionStore } from "./connection-store";
import type { ContentSendStore } from "./content-send-store";
import type { ProjectionStore } from "./projection-store";
import type { GuidedProjectionStore } from "./guided-projection-store";
import type { ContentEditorStore } from "./content-editor-store";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  workspaceStore(): Pick<
    WorkspaceStore,
    "getController" | "getTransport" | "getLiveWorkspace"
  >;
  reportStore(): Pick<
    ReportStore,
    | "getTransactionFilter"
    | "getTransactionSearch"
    | "getReportOpen"
    | "getReportOptions"
    | "_reportMarkdownForKind"
    | "_effectiveReportKind"
  >;
  navigationStore(): Pick<NavigationStore, "getPage" | "getView">;
  noticeStore(): Pick<NoticeStore, "getBusy" | "getError" | "getInfo">;
  connectionStore(): Pick<
    ConnectionStore,
    "getPreviouslyAuthorized" | "getSubscriptions" | "getLastImport"
  >;
  contentSendStore(): Pick<
    ContentSendStore,
    "getSendProgress" | "getWakeLock" | "getPendingSend" | "_scrollPlan"
  >;
  projectionStore(): Pick<
    ProjectionStore,
    | "_claimGroups"
    | "_contentGates"
    | "_investigationView"
    | "_guidedTestViews"
    | "_storedInvestigationView"
    | "_coreProgressView"
    | "_orchestrationView"
  >;
  guidedProjectionStore(): Pick<GuidedProjectionStore, "_guidedFlowView">;
  contentEditorStore(): Pick<
    ContentEditorStore,
    "getSettings" | "_renderTextFrame" | "getImageState" | "getGifState"
  >;
}
export class SnapshotStore {
  private disposed = false;
  dispose(): void {
    this.disposed = true;
    this._listeners.clear();
  }
  private readonly _listeners = new Set<() => void>();
  private _snapshot!: AppSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "bluetoothSupported"
    >,
  ) {}
  getSnapshot() {
    return this._snapshot;
  }
  _liveResolved(): boolean {
    const session = this.ports.workspaceStore().getController().session;
    return (
      session.source === "live" &&
      this.ports.workspaceStore().getTransport().state === "connected" &&
      Boolean(session.selection?.selected) &&
      Boolean(session.profile)
    );
  }
  _contentAllowed(): { allowed: boolean; reason: string } {
    const session = this.ports.workspaceStore().getController().session;
    if (
      session.source !== "live" ||
      this.ports.workspaceStore().getTransport().state !== "connected"
    )
      return {
        allowed: false,
        reason: "Live content controls require a connected display.",
      };
    if (!session.selection?.selected || !session.profile)
      return {
        allowed: false,
        reason: "Identify the display and confirm its geometry first.",
      };
    const gates = this.ports.workspaceStore().getController().contentGates();
    const allowed = gates.some((gate) => gate.allowed);
    return {
      allowed,
      reason: allowed
        ? "At least one content path is ready."
        : (gates[0]?.reason ?? "No content path is currently available."),
    };
  }
  _emit(): void {
    if (this.disposed) return;
    this._rebuild();
    for (const listener of this._listeners) listener();
  }
  _rebuild(): void {
    const session = this.ports.workspaceStore().getController().session;
    const fingerprint = session.fingerprint;
    const driver = session.selection?.selected;
    const profile = session.profile;
    const info = session.latestDeviceInfo;
    const capabilities = driver && profile ? driver.capabilities(profile) : [];
    const transactions = filterTransactions(
      this.ports.workspaceStore().getController().transactions,
      this.ports.reportStore().getTransactionFilter(),
      this.ports.reportStore().getTransactionSearch(),
    );
    const liveConnected =
      session.source === "live" &&
      this.ports.workspaceStore().getTransport().state === "connected";
    const assessment = this.ports
      .workspaceStore()
      .getController()
      .assessment(liveConnected);
    this._snapshot = Object.freeze({
      page: this.ports.navigationStore().getPage(),
      view: this.ports.navigationStore().getView(),
      connection: this.ports.workspaceStore().getTransport().state,
      source: session.source,
      liveConnected,
      liveWorkspaceAvailable:
        this.ports.workspaceStore().getLiveWorkspace() !== null,
      busy: this.ports.noticeStore().getBusy(),
      error: this.ports.noticeStore().getError(),
      info: this.ports.noticeStore().getInfo(),
      bluetoothSupported: this.environment.bluetoothSupported,
      previouslyAuthorized: this.ports
        .connectionStore()
        .getPreviouslyAuthorized(),
      device: fingerprint
        ? {
            name: fingerprint.name ?? "Unnamed display",
            connectionLabel:
              session.source === "imported"
                ? "Offline report"
                : this.ports.workspaceStore().getTransport().state ===
                    "connected"
                  ? "Connected"
                  : this.ports.workspaceStore().getTransport().state,
            protocol:
              driver?.family ??
              (session.selection?.ambiguous
                ? "Ambiguous protocol"
                : "Unknown protocol"),
            support: assessment.summary,
            liveGeometry: fingerprint.manuallyConfirmedGeometry
              ? `${fingerprint.manuallyConfirmedGeometry.width}×${fingerprint.manuallyConfirmedGeometry.height} · manually confirmed`
              : "Unknown",
            profileGeometry: profile
              ? `${profile.width}×${profile.height} · ${profile.id}`
              : "Unknown",
            advertisementGeometry: "Not derived in this session",
            profileId: profile?.id ?? null,
          }
        : null,
      deviceState: {
        brightness:
          typeof info?.fields.brightnessRaw === "number"
            ? info.fields.brightnessRaw
            : null,
        power: info
          ? info.fields.powerOn === true
            ? "On"
            : `Raw ${String(info.fields.powerRaw)}`
          : "Unknown",
        payloadHex: info?.payloadHex ?? null,
      },
      capabilities,
      assessment,
      support: supportRows(assessment),
      recommended: recommendedFromAssessment(assessment),
      diagnosticTools: this.ports
        .workspaceStore()
        .getController()
        .diagnosticTools(),
      diagnosticRuns: this.ports.workspaceStore().getController()
        .diagnosticRuns,
      candidates: (session.selection?.matches ?? []).map((match) => ({
        id: match.driverId,
        family:
          this.ports
            .workspaceStore()
            .getController()
            .registry.drivers.find((d) => d.id === match.driverId)?.family ??
          match.driverId,
        state:
          match.driverId === driver?.id
            ? "VERIFIED ON THIS SESSION"
            : match.score <= 0
              ? "Rejected for this profile"
              : "Candidate",
        summary:
          match.driverId === driver?.id
            ? (session.protocolResolution?.summary ?? "Resolved by evidence.")
            : (match.reasons[0] ??
              match.contradictions[0] ??
              "Protocol candidate"),
        score: match.score,
        reasons: match.reasons,
        contradictions: match.contradictions,
        canIdentify:
          !driver &&
          match.score > 0 &&
          this.ports.workspaceStore().getTransport().state === "connected",
      })),
      gatt: (fingerprint?.services ?? []).map((service) => ({
        uuid: service.uuid,
        primary: service.isPrimary,
        characteristics: service.characteristics.map((c) => ({
          serviceUuid: service.uuid,
          uuid: c.uuid,
          properties: Object.entries(c.properties)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key),
          canRead: c.properties.read,
          canSubscribe: c.properties.notify || c.properties.indicate,
          subscribed: this.ports
            .connectionStore()
            .getSubscriptions()
            .has(
              endpointKey({
                serviceUuid: service.uuid,
                characteristicUuid: c.uuid,
              }),
            ),
        })),
      })),
      transactions,
      rawEvents: this.ports.workspaceStore().getController().trace.events,
      observations: this.ports.workspaceStore().getController().observations,
      reportOpen: this.ports.reportStore().getReportOpen(),
      reportOptions: this.ports.reportStore().getReportOptions(),
      sendProgress: this.ports.contentSendStore().getSendProgress(),
      wakeLockSupported: this.ports.contentSendStore().getWakeLock().supported,
      // Only generated while the dialog is open: it is the most expensive
      // thing a snapshot can do, and it was previously rebuilt on every
      // 100ms timer tick during an observation.
      reportMarkdown:
        fingerprint && this.ports.reportStore().getReportOpen()
          ? this.ports.reportStore()._reportMarkdownForKind()
          : "",
      reportKind: this.ports.reportStore()._effectiveReportKind(),
      investigationReportAvailable:
        this.ports.workspaceStore().getController().investigation !== null,
      transactionFilter: this.ports.reportStore().getTransactionFilter(),
      transactionSearch: this.ports.reportStore().getTransactionSearch(),
      lastImport: this.ports.connectionStore().getLastImport(),
      content: this._contentState(profile),
      pendingSend: this.ports.contentSendStore().getPendingSend()?.view ?? null,
      contentCompilations: this.ports.workspaceStore().getController()
        .contentCompilations,
      claimGroups: this.ports.projectionStore()._claimGroups(),
      contentGates: this.ports.projectionStore()._contentGates(),
      investigation: this.ports.projectionStore()._investigationView(),
      guidedTests: this.ports.projectionStore()._guidedTestViews(),
      nextTest: recommendationView(
        this.ports.workspaceStore().getController().recommendations()[0] ??
          null,
      ),
      guidedFlow: this.ports.guidedProjectionStore()._guidedFlowView(),
      storedInvestigation: this.ports
        .projectionStore()
        ._storedInvestigationView(),
      // The strategy in EFFECT, which on a characterized profile is derived
      // from shipped evidence and needs no session validation. Reading only
      // the session value made a known, working display announce that no way
      // to show a still image had been found.
      rasterStrategyLabel: (() => {
        const selected =
          this.ports.workspaceStore().getController().session
            .validatedRasterStrategy ??
          this.ports.workspaceStore().getController().staticViability()
            .selected;
        return selected ? RASTER_STRATEGY_LABELS[selected] : null;
      })(),
      symptoms: SYMPTOM_ROWS,
      coreProgress: this.ports.projectionStore()._coreProgressView(),
      cycleWarning: this.ports.workspaceStore().getController()
        .recommendationCycle.cycling
        ? this.ports.workspaceStore().getController().recommendationCycle.detail
        : null,
      orchestration: this.ports.projectionStore()._orchestrationView(),
    });
  }
  _contentState(
    profile: { width: number; height: number } | null,
  ): ContentState {
    const gate = this._contentAllowed();
    return {
      allowed: gate.allowed,
      allowedReason: gate.reason,
      settings: this.ports.contentEditorStore().getSettings(),
      textPreview: profile
        ? this.ports
            .contentEditorStore()
            ._renderTextFrame(profile.width, profile.height)
        : null,
      textScrollPlan:
        profile &&
        resolvesToScroll(
          this.ports.contentEditorStore().getSettings().textDisplayMode,
          this.ports.contentEditorStore().getSettings().text.trim(),
          profile.width,
        )
          ? this.ports
              .contentSendStore()
              ._scrollPlan(profile.width, profile.height)
          : null,
      image: this.ports.contentEditorStore().getImageState(),
      animationPreview: profile
        ? [...diagnosticAnimation(profile.width, profile.height).frames]
        : [],
      gif: this.ports.contentEditorStore().getGifState(),
    };
  }
}
