import {
  SYMPTOM_LABELS,
  forgetInvestigationHistory,
  latestInvestigationFor,
  toHistoricalInvestigation,
} from "./dependencies";
import type { SymptomId } from "./dependencies";

import { saveInvestigation } from "./dependencies";

import type { ProjectionStore } from "./projection-store";
import type { WorkspaceStore } from "./workspace-store";
import type { NoticeStore } from "./notice-store";
import type { NavigationStore } from "./navigation-store";
import type { SnapshotStore } from "./snapshot-store";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  projectionStore(): Pick<ProjectionStore, "refreshHistory">;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
  noticeStore(): Pick<NoticeStore, "setError" | "setInfo" | "_run" | "getBusy">;
  navigationStore(): Pick<NavigationStore, "setViewState" | "setPage">;
  snapshotStore(): Pick<SnapshotStore, "_emit">;
}
export class InvestigationStore {
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<PresentationEnvironment, "storage">,
  ) {}
  _persistInvestigation(): boolean {
    const investigation = this.ports
      .workspaceStore()
      .getController().investigation;
    if (investigation) {
      const saved = saveInvestigation(investigation, this.environment.storage);
      if (saved.ok) {
        this.ports.projectionStore().refreshHistory();
        this.ports.noticeStore().setError(null, "history");
      }
      if (!saved.ok)
        this.ports
          .noticeStore()
          .setError(`Investigation was not saved: ${saved.message}`, "history");
      return saved.ok;
    }
    return false;
  }
  _persistDetachedInvestigation(): void {
    const detached = this.ports
      .workspaceStore()
      .getController()
      .takeDetachedInvestigation();
    if (detached) {
      const saved = saveInvestigation(detached, this.environment.storage);
      if (saved.ok) {
        this.ports.projectionStore().refreshHistory();
        this.ports.noticeStore().setError(null, "history");
      }
      if (!saved.ok)
        this.ports
          .noticeStore()
          .setError(`Investigation was not saved: ${saved.message}`, "history");
    }
  }
  startTroubleshoot(symptomId: SymptomId): void {
    this.ports.workspaceStore().getController().startInvestigation({
      kind: "troubleshoot",
      symptomId,
      description: SYMPTOM_LABELS[symptomId],
    });
    this.ports.navigationStore().setViewState("diagnose");
    this.ports
      .noticeStore()
      .setInfo(
        "Troubleshooting started. MatrixSmith picked the highest-information next test for this symptom.",
      );
    this._persistInvestigation();
    this.ports.snapshotStore()._emit();
  }
  startDevelopInvestigation(): void {
    this.ports.workspaceStore().getController().ensureInvestigation();
    this.ports.navigationStore().setViewState("diagnose");
    this.ports.snapshotStore()._emit();
  }
  stopInvestigation(): void {
    this.ports.noticeStore().setInfo(null);
    this.ports.workspaceStore().getController().stopActiveInvestigation();
    if (this._persistInvestigation())
      this.ports
        .noticeStore()
        .setInfo(
          "Investigation saved locally. Copy the investigation report, or resume any time.",
        );
    this.ports.snapshotStore()._emit();
  }
  resumeStoredInvestigation(): void {
    if (this.ports.noticeStore().getBusy()) return;
    this.ports.noticeStore().setInfo(null);
    this.ports.projectionStore().refreshHistory();
    const stored = latestInvestigationFor(
      this.ports.workspaceStore().getController().session.profile?.id ?? null,
      this.environment.storage,
    );
    if (!stored) {
      this.ports
        .noticeStore()
        .setError("No stored investigation found for this display.");
      this.ports.snapshotStore()._emit();
      return;
    }
    this.ports
      .workspaceStore()
      .getController()
      .adoptInvestigation(toHistoricalInvestigation(stored.investigation));
    this.ports.navigationStore().setPage("workspace");
    this.ports.navigationStore().setViewState("diagnose");
    this.ports
      .noticeStore()
      .setInfo(
        "Previous investigation resumed. Its evidence is labeled as a previous local session and does not bypass current-session safety gates.",
      );
    this.ports.snapshotStore()._emit();
  }
  forgetLocalHistory(): void {
    if (this.ports.noticeStore().getBusy()) return;
    this.ports.noticeStore().setInfo(null);
    const removed = forgetInvestigationHistory(this.environment.storage);
    if (removed.ok) {
      this.ports.projectionStore().refreshHistory();
      this.ports.noticeStore().setError(null, "history");
      this.ports
        .noticeStore()
        .setInfo("Local investigation/device history forgotten.");
    } else
      this.ports
        .noticeStore()
        .setError(
          `Local history could not be removed: ${removed.message}`,
          "history",
        );
    this.ports.snapshotStore()._emit();
  }
  async reconnectAuthorized(deviceId: string): Promise<void> {
    const workspace = this.ports.workspaceStore().getController();
    if (
      this.ports.noticeStore().getBusy() ||
      workspace.session.source !== "live" ||
      workspace.transport.state === "connected"
    ) {
      this.ports
        .noticeStore()
        .setError(
          "Finish the current operation and disconnect the active display before reconnecting.",
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    await this.ports.noticeStore()._run("Reconnecting display…", async () => {
      this._persistInvestigation();
      try {
        await this.ports
          .workspaceStore()
          .getController()
          .reconnectAuthorized(deviceId);
      } catch {
        // Chooser fallback: never make success depend on getDevices().
        await this.ports.workspaceStore().getController().connect();
      }
      this._persistDetachedInvestigation();
      await this.ports
        .workspaceStore()
        .getController()
        .enableDriverNotifications()
        .catch(() => undefined);
      this.ports.navigationStore().setPage("workspace");
      this.ports
        .navigationStore()
        .setViewState(
          this.ports.workspaceStore().getController().session.selection
            ?.selected
            ? "control"
            : "diagnose",
        );
      this.ports.noticeStore().setInfo("Display connected.");
    });
  }
}
