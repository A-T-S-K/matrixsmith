import { resolvesToScroll, RASTER_STRATEGY_LABELS } from "./dependencies";

import type { ContentState } from "./types";
import {
  SYMPTOM_ROWS,
  recommendationView,
  candidateEvidence,
  deviceInfoEvidence,
  recommendedFromAssessment,
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
import { PublicationScheduler } from "./publication-scheduler";
import type { ApplicationState } from "../../application/state";

export interface PublicationFailure {
  readonly phase: "projection" | "observer" | "reentrant";
  readonly error: unknown;
}

interface Ports {
  workspaceStore(): Pick<
    WorkspaceStore,
    | "getController"
    | "getTransport"
    | "getLiveWorkspace"
    | "getLiveConnection"
    | "getOfflineAvailable"
    | "getContextIdentity"
    | "getContextLabel"
    | "transitionReason"
  >;
  reportStore(): Pick<
    ReportStore,
    | "review"
    | "getTransactionFilter"
    | "getTransactionSearch"
    | "getReviewNote"
    | "getReportOpen"
    | "getReportOptions"
    | "_reportMarkdownForKind"
    | "_effectiveReportKind"
    | "getReportError"
    | "getReportPreviewFailed"
  >;
  navigationStore(): Pick<
    NavigationStore,
    "getPage" | "getView" | "getWorkbenchSection" | "getMissingContext"
  >;
  noticeStore(): Pick<NoticeStore, "getBusy" | "getError" | "getInfo">;
  connectionStore(): Pick<
    ConnectionStore,
    | "getPreviouslyAuthorized"
    | "getProfileReview"
    | "getCandidateReview"
    | "getProfileEvidenceStatus"
    | "getLoadedProfiles"
    | "getProfileLoadReason"
    | "getLastImport"
    | "getGeometryDraft"
  >;
  contentSendStore(): Pick<
    ContentSendStore,
    | "getSendAttempt"
    | "getSendProgress"
    | "getWakeLock"
    | "getPendingSend"
    | "_scrollPlan"
    | "_buildAnimationSequence"
    | "clearContentCaches"
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
    | "getSettings"
    | "getSelection"
    | "_renderTextFrame"
    | "getImageState"
    | "getGifState"
    | "clearTextCache"
  >;
}
export class SnapshotStore {
  private disposed = false;
  private publishing = false;
  private refreshing = false;
  private projectionFailed = false;
  private reentrantRefresh = false;
  private needsRefresh = false;
  private projectedEvidence: {
    transactions: number;
    compilations: number;
    raw: number;
    deviceInfo: unknown;
  } | null = null;
  private projectedAuthority:
    | (Pick<
        ApplicationState,
        | "source"
        | "profile"
        | "protocolResolution"
        | "geometryRevision"
        | "identityAuthorityRevision"
        | "experimentalTxEnabled"
        | "confirmedPlanDigest"
        | "validatedRasterStrategy"
      > & {
        driver:
          NonNullable<ApplicationState["selection"]>["selected"] | undefined;
        width: number | undefined;
        height: number | undefined;
      })
    | null = null;
  private readonly failures: PublicationFailure[] = [];
  private readonly counts = {
    traceRequests: 0,
    rebuilds: 0,
    publications: 0,
    observerCalls: 0,
  };
  private readonly publications = new PublicationScheduler(() =>
    this.publish(this.needsRefresh || this.signalsChanged()),
  );
  dispose(): void {
    this.disposed = true;
    this.publications.dispose();
    this._listeners.clear();
  }
  private readonly _listeners = new Set<() => void>();
  private readonly listenerVersions = new WeakMap<() => void, number>();
  private nextListenerVersion = 0;
  private _snapshot!: AppSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    const version = ++this.nextListenerVersion;
    this._listeners.add(listener);
    this.listenerVersions.set(listener, version);
    return () => {
      if (this.listenerVersions.get(listener) === version)
        this._listeners.delete(listener);
    };
  };

  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "bluetoothSupported"
    >,
  ) {}
  getSnapshot() {
    // Explicit UI/command/update reads see current ownership, even before the
    // queued notification. Keep that notification for the other subscribers.
    if (!this.disposed && !this.refreshing) {
      // A final trace may be read before an executor/read owner releases. Those
      // lightweight authority signals must be rechecked after settlement too.
      if (
        this.signalsChanged() ||
        (this.needsRefresh && this.publications.hasPending)
      )
        this.refresh();
    }
    return this._snapshot;
  }
  private signalsChanged(): boolean {
    if (this.projectionFailed || !this.projectedEvidence) return false;
    const workspace = this.ports.workspaceStore();
    const controller = workspace.getController();
    const revisions = controller.evidenceRevisions;
    return (
      this.authorityChanged() ||
      this._snapshot.busy !== this.ports.noticeStore().getBusy() ||
      this._snapshot.contextTransitionReason !== workspace.transitionReason() ||
      this._snapshot.profileLoadReason !==
        this.ports.connectionStore().getProfileLoadReason() ||
      this._snapshot.connection !== workspace.getTransport().state ||
      this._snapshot.retainedLiveConnection !== workspace.getLiveConnection() ||
      this._snapshot.contextIdentity !== workspace.getContextIdentity() ||
      this.projectedEvidence.transactions !== revisions.transactions ||
      this.projectedEvidence.compilations !== revisions.compilations ||
      this.projectedEvidence.raw !== controller.trace.revision ||
      (controller.session.source === "live" &&
        this.projectedEvidence.deviceInfo !==
          controller.session.latestDeviceInfoRecord)
    );
  }
  private authorityChanged(): boolean {
    const previous = this.projectedAuthority;
    if (!previous || this.projectionFailed) return false;
    const session = this.ports.workspaceStore().getController().session;
    return (
      previous.source !== session.source ||
      previous.profile !== session.profile ||
      previous.driver !== session.selection?.selected ||
      previous.protocolResolution !== session.protocolResolution ||
      previous.geometryRevision !== session.geometryRevision ||
      previous.identityAuthorityRevision !==
        session.identityAuthorityRevision ||
      previous.experimentalTxEnabled !== session.experimentalTxEnabled ||
      previous.confirmedPlanDigest !== session.confirmedPlanDigest ||
      previous.validatedRasterStrategy !== session.validatedRasterStrategy ||
      previous.width !== session.profile?.width ||
      previous.height !== session.profile?.height
    );
  }
  /** Bounded local supervision evidence; reading it never emits or persists. */
  getPublicationFailures(): readonly PublicationFailure[] {
    return this.failures.slice();
  }
  /** Deterministic local work counts for qualification, without timing or I/O. */
  getPublicationCounts() {
    return Object.freeze({ ...this.counts });
  }
  private failed(phase: PublicationFailure["phase"], error: unknown): void {
    this.failures.push(Object.freeze({ phase, error }));
    if (this.failures.length > 20) this.failures.shift();
  }
  _scheduleTracePublication(owner: string, current: () => boolean): void {
    if (this.disposed) return;
    this.counts.traceRequests++;
    if (this.authorityChanged()) {
      this._emit();
      return;
    }
    this.needsRefresh = true;
    this.publications.schedule(owner, current);
  }
  _cancelTracePublication(owner: string): void {
    this.publications.cancel(owner);
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
    if (this.publishing || this.refreshing) {
      this.reentrantRefresh = true;
      this.failed(
        "reentrant",
        new Error("Recursive presentation publication."),
      );
      return;
    }
    this.publications.cancel();
    this.publish(true);
  }
  private refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.needsRefresh = false;
    try {
      this._rebuild();
      this.projectionFailed = false;
    } catch (error) {
      this.projectionFailed = true;
      this.failed("projection", error);
      // A failed projection must not leave update activation appearing safe.
      const reason =
        "Presentation state could not be refreshed. Recover before changing workspace or updating.";
      this._snapshot = Object.freeze({
        ...this._snapshot,
        contextTransitionReason: reason,
        error: reason,
        liveConnected: false,
        pendingSend: null,
        content: {
          ...this._snapshot.content,
          allowed: false,
          allowedReason: reason,
        },
      });
    } finally {
      this.refreshing = false;
    }
  }
  private publish(rebuild: boolean): void {
    if (this.disposed) return;
    this.publishing = true;
    this.counts.publications++;
    try {
      if (rebuild) this.refresh();
      for (const listener of [...this._listeners]) {
        if (this.disposed) break;
        if (!this._listeners.has(listener)) continue;
        const version = this.listenerVersions.get(listener);
        try {
          this.counts.observerCalls++;
          const outcome: unknown = listener();
          if (
            outcome &&
            (typeof outcome === "object" || typeof outcome === "function") &&
            "then" in outcome &&
            typeof outcome.then === "function"
          )
            void Promise.resolve(outcome).catch((error: unknown) => {
              // A late rejection cannot remove a newer subscription.
              if (this.listenerVersions.get(listener) === version)
                this._listeners.delete(listener);
              this.failed("observer", error);
            });
        } catch (error) {
          // Quarantine only the faulty observer; never feed errors into trace.
          if (this.listenerVersions.get(listener) === version)
            this._listeners.delete(listener);
          this.failed("observer", error);
        }
      }
    } finally {
      // A subscriber may synchronously change UI state. Refresh once without
      // calling subscribers again, so feedback cannot create an emission loop.
      if (this.reentrantRefresh && !this.disposed) this.refresh();
      this.reentrantRefresh = false;
      this.publishing = false;
    }
  }
  _rebuild(): void {
    this.counts.rebuilds++;
    const session = this.ports.workspaceStore().getController().session;
    const fingerprint = session.fingerprint;
    const driver = session.selection?.selected;
    const profile = session.profile;
    const infoRecord = session.latestDeviceInfoRecord;
    const info = infoRecord?.decoded ?? null;
    const capabilities = driver && profile ? driver.capabilities(profile) : [];
    const controller = this.ports.workspaceStore().getController();
    this.projectedAuthority = {
      source: session.source,
      profile,
      driver,
      protocolResolution: session.protocolResolution,
      geometryRevision: session.geometryRevision,
      identityAuthorityRevision: session.identityAuthorityRevision,
      experimentalTxEnabled: session.experimentalTxEnabled,
      confirmedPlanDigest: session.confirmedPlanDigest,
      validatedRasterStrategy: session.validatedRasterStrategy,
      width: profile?.width,
      height: profile?.height,
    };
    // Observe existing evidence revisions, rather than caching safety results.
    // Bookkeeping can complete after a synchronous consumer reads a trace.
    this.projectedEvidence = {
      ...controller.evidenceRevisions,
      raw: controller.trace.revision,
      deviceInfo: infoRecord,
    };
    const review = this.ports.reportStore().review.project({
      transactions: controller.transactions,
      compilations: controller.contentCompilations,
      rawEvents: controller.trace.events,
      revisions: {
        ...controller.evidenceRevisions,
        raw: controller.trace.revision,
      },
      filter: this.ports.reportStore().getTransactionFilter(),
      search: this.ports.reportStore().getTransactionSearch(),
      section:
        this.ports.navigationStore().getView() === "develop" &&
        ["transactions", "raw"].includes(
          this.ports.navigationStore().getWorkbenchSection(),
        )
          ? (this.ports.navigationStore().getWorkbenchSection() as
              "transactions" | "raw")
          : undefined,
    });
    const liveConnected =
      session.source === "live" &&
      this.ports.workspaceStore().getTransport().state === "connected";
    const assessment = this.ports
      .workspaceStore()
      .getController()
      .assessment(liveConnected);
    this._snapshot = Object.freeze({
      candidateReview: this.ports.connectionStore().getCandidateReview(),
      profileEvidenceStatus: this.ports
        .connectionStore()
        .getProfileEvidenceStatus(),
      profileReview: this.ports.connectionStore().getProfileReview(),
      loadedProfiles: this.ports.connectionStore().getLoadedProfiles(),
      profileLoadReason: this.ports.connectionStore().getProfileLoadReason(),
      advisoryInput: fingerprint
        ? {
            owner: this.ports.workspaceStore().getController(),
            fingerprint,
            actions: this.ports
              .workspaceStore()
              .getController()
              .registry.drivers.flatMap(
                (driver) =>
                  driver
                    .familyProbes?.({
                      fingerprint,
                      endpoints: [],
                      source: session.source,
                    })
                    .map((probe) => `${driver.id}:${probe.id}`) ?? [],
              ),
          }
        : null,
      page: this.ports.navigationStore().getPage(),
      view: this.ports.navigationStore().getView(),
      workbenchSection: this.ports.navigationStore().getWorkbenchSection(),
      missingContext: this.ports.navigationStore().getMissingContext(),
      connection: this.ports.workspaceStore().getTransport().state,
      source: session.source,
      liveConnected,
      liveWorkspaceAvailable:
        this.ports.workspaceStore().getLiveWorkspace() !== null,
      retainedLiveConnection: this.ports.workspaceStore().getLiveConnection(),
      offlineWorkspaceAvailable: this.ports
        .workspaceStore()
        .getOfflineAvailable(),
      contextLabel: this.ports.workspaceStore().getContextLabel(),
      contextIdentity: this.ports.workspaceStore().getContextIdentity(),
      contextTransitionReason: this.ports.workspaceStore().transitionReason(),
      reviewNote: this.ports.reportStore().getReviewNote(),
      contentSelection: this.ports.contentEditorStore().getSelection(),
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
      deviceInfoEvidence: deviceInfoEvidence(
        session.source,
        liveConnected,
        infoRecord?.timestamp ?? null,
      ),
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
      geometryDraft: this.ports.connectionStore().getGeometryDraft(),
      discovery: this.ports.workspaceStore().getController().discovery,
      geometryProposal: this.ports
        .workspaceStore()
        .getController()
        .geometryProposal(),
      geometryProfile: profile,
      assessment,
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
        evidence: candidateEvidence(
          match.driverId === driver?.id,
          match.score,
          session.source,
          liveConnected,
          session.protocolResolution,
        ),
        state: candidateEvidence(
          match.driverId === driver?.id,
          match.score,
          session.source,
          liveConnected,
          session.protocolResolution,
        ).label,
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
            .workspaceStore()
            .getController()
            .isNotificationActive({
              serviceUuid: service.uuid,
              characteristicUuid: c.uuid,
            }),
        })),
      })),
      review,
      transactions: review.filtered,
      rawEvents: this.ports.workspaceStore().getController().trace.events,
      observations: this.ports.workspaceStore().getController().observations,
      reportOpen: this.ports.reportStore().getReportOpen(),
      reportOptions: this.ports.reportStore().getReportOptions(),
      sendAttempt: this.ports.contentSendStore().getSendAttempt(),
      sendProgress: this.ports.contentSendStore().getSendProgress(),
      wakeLockSupported: this.ports.contentSendStore().getWakeLock().supported,
      // Only generated while the dialog is open: it is the most expensive
      // thing a snapshot can do. Timed observations update their elapsed
      // display locally, without rebuilding the external snapshot.
      reportMarkdown:
        fingerprint && this.ports.reportStore().getReportOpen()
          ? this.ports.reportStore()._reportMarkdownForKind()
          : "",
      reportError: this.ports.reportStore().getReportError(),
      reportPreviewFailed: this.ports.reportStore().getReportPreviewFailed(),
      reportObjective:
        this.ports.workspaceStore().getController().investigation?.goal
          .description ?? null,
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
    if (!profile) {
      this.ports.contentEditorStore().clearTextCache();
      this.ports.contentSendStore().clearContentCaches();
    }
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
        ? this.ports.contentSendStore()._buildAnimationSequence().frames
        : [],
      gif: this.ports.contentEditorStore().getGifState(),
    };
  }
}
