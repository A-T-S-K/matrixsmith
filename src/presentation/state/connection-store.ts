import { INPUT_LIMITS } from "./dependencies";
import type { GattEndpoint } from "./dependencies";

import { summarizeImport } from "./selectors";

import type { ImportSummary } from "./types";

import type { SnapshotStore } from "./snapshot-store";
import type { NoticeStore } from "./notice-store";
import type { InvestigationStore } from "./investigation-store";
import type { WorkspaceStore } from "./workspace-store";
import type { NavigationStore } from "./navigation-store";
import type { ContentEditorStore } from "./content-editor-store";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  noticeStore(): Pick<NoticeStore, "_run" | "setInfo" | "setError" | "getBusy">;
  investigationStore(): Pick<
    InvestigationStore,
    "_persistInvestigation" | "_persistDetachedInvestigation"
  >;
  workspaceStore(): Pick<
    WorkspaceStore,
    | "getController"
    | "prepareLiveWorkspace"
    | "activateConnectedLive"
    | "transitionReason"
    | "returnToLiveWorkspace"
  >;
  navigationStore(): Pick<
    NavigationStore,
    "setPage" | "setViewState" | "getRouter" | "getView"
  >;
  contentEditorStore(): Pick<ContentEditorStore, "updateContentSettings">;
}
export class ConnectionStore {
  private _previouslyAuthorized: { id: string; name: string }[] = [];
  private _lastImport: ImportSummary | null = null;
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "authorizedDevices"
    >,
  ) {}
  captureContext() {
    return { lastImport: this._lastImport };
  }
  restoreContext(
    state: ReturnType<ConnectionStore["captureContext"]> | null,
  ): void {
    this._lastImport = state?.lastImport ?? null;
  }
  getPreviouslyAuthorized(): Readonly<
    ConnectionStore["_previouslyAuthorized"]
  > {
    return this._previouslyAuthorized;
  }
  getLastImport() {
    return this._lastImport;
  }
  async initialize(): Promise<void> {
    try {
      this._previouslyAuthorized = [
        ...(await this.environment.authorizedDevices()),
      ];
    } catch {
      this._previouslyAuthorized = [];
    }
    this.ports.snapshotStore()._emit();
  }
  async connect(
    mode: "registered" | "inspection" = "registered",
    serviceHints: readonly BluetoothServiceUUID[] = [],
  ): Promise<void> {
    const owner = this.ports.workspaceStore();
    const reason = owner.transitionReason();
    if (reason) {
      this.ports.noticeStore().setError(reason);
      this.ports.snapshotStore()._emit();
      return;
    }
    const fromOffline = owner.getController().session.source === "imported";
    await this.ports.noticeStore()._run("Connecting display…", async () => {
      const workspace = fromOffline
        ? owner.prepareLiveWorkspace().controller
        : owner.getController();
      const connected = () => workspace.transport.state === "connected";
      if (connected()) {
        if (fromOffline) owner.activateConnectedLive(workspace);
        else
          throw new Error(
            "Disconnect the active display before choosing another device.",
          );
      } else {
        // No await before connect: the chooser is reached from this user action.
        // Imported investigations must never be adopted or persisted as live.
        if (!fromOffline)
          this.ports.investigationStore()._persistInvestigation();
        await workspace.connect(mode, serviceHints);
        const connectionId = workspace.transport.connectionId;
        await workspace.enableDriverNotifications().catch(() => undefined);
        if (connectionId !== workspace.transport.connectionId || !connected())
          return;
        if (fromOffline) {
          if (!owner.activateConnectedLive(workspace)) return;
        } else {
          if (workspace !== owner.getController()) return;
          this.ports.investigationStore()._persistDetachedInvestigation();
        }
      }
      this.ports.navigationStore().setPage("workspace");
      this.ports
        .navigationStore()
        .setViewState(
          mode === "inspection"
            ? "develop"
            : workspace.session.selection?.selected
              ? "control"
              : "diagnose",
        );
      this.ports
        .navigationStore()
        .getRouter()
        ?.navigate(
          this.ports.navigationStore().getView() === "control"
            ? "create"
            : this.ports.navigationStore().getView() === "diagnose"
              ? "investigate"
              : "develop-transactions",
        );
      this.ports
        .noticeStore()
        .setInfo("Display connected. Review the recommended next action.");
    });
  }
  async disconnect(): Promise<void> {
    const workspace = this.ports.workspaceStore().getController();
    await this.ports.noticeStore()._run("Disconnecting…", async () => {
      await workspace.disconnect();
      if (
        workspace !== this.ports.workspaceStore().getController() ||
        workspace.transport.connectionId !== null
      )
        return;
      this.ports.navigationStore().setPage("home");
      this.ports.navigationStore().setViewState("control");
      this.ports.navigationStore().getRouter()?.navigate("home");
    });
  }
  async identify(): Promise<void> {
    await this.ports
      .noticeStore()
      ._run("Running safe identification…", async () => {
        const tool = this.ports
          .workspaceStore()
          .getController()
          .diagnosticTools()
          .find(({ kind }) => kind === "identify");
        if (!tool)
          throw new Error(
            "No bounded family-identification probe is available.",
          );
        const run = await this.ports
          .workspaceStore()
          .getController()
          .runDiagnostic(tool.id);
        this.ports
          .noticeStore()
          .setInfo(
            run.status === "passed"
              ? (run.findings[0] ??
                  "The current probe identified the display family.")
              : run.error,
          );
      });
  }
  async runDiagnostic(id: string): Promise<void> {
    await this.ports.noticeStore()._run("Running diagnostic…", async () => {
      const run = await this.ports
        .workspaceStore()
        .getController()
        .runDiagnostic(id);
      this.ports
        .noticeStore()
        .setInfo(run.status === "passed" ? "Diagnostic passed." : run.error);
    });
  }
  async refreshInfo(): Promise<void> {
    const tool = this.ports
      .workspaceStore()
      .getController()
      .diagnosticTools()
      .find(({ workflow }) => workflow === "refresh-device-info");
    if (!tool) {
      this.ports
        .noticeStore()
        .setError("Device information refresh is unavailable.");
      this.ports.snapshotStore()._emit();
      return;
    }
    await this.runDiagnostic(tool.id);
  }
  confirmProvisionalGeometry(width: number, height: number): void {
    try {
      this.ports
        .workspaceStore()
        .getController()
        .confirmProvisionalGeometry(width, height);
      this.ports
        .noticeStore()
        .setInfo(
          `Display size confirmed as ${width}×${height}. Bounded family tests are now available.`,
        );
      this.ports.navigationStore().setViewState("diagnose");
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
    }
    this.ports.snapshotStore()._emit();
  }
  async applyBrightness(raw: number): Promise<void> {
    this.ports
      .contentEditorStore()
      .updateContentSettings({ lastBrightness: raw });
    await this.ports.noticeStore()._run("Applying brightness…", async () => {
      const command = await this.ports
        .workspaceStore()
        .getController()
        .send(
          this.ports
            .workspaceStore()
            .getController()
            .plan({ type: "SetBrightness", raw }),
        );
      if (!command.protocolAcknowledged)
        throw new Error("Brightness response did not match the command.");
      const readback = await this.ports
        .workspaceStore()
        .getController()
        .send(
          this.ports
            .workspaceStore()
            .getController()
            .plan({ type: "GetDeviceInfo" }),
        );
      const actual = readback.response?.fields.brightnessRaw;
      if (actual !== raw)
        throw new Error(
          `Brightness readback mismatch: expected ${raw}; received ${String(actual)}.`,
        );
      this.ports
        .noticeStore()
        .setInfo(`Brightness ${raw} verified by device-info readback.`);
    });
  }
  async readCharacteristic(endpoint: GattEndpoint): Promise<void> {
    await this.ports.noticeStore()._run("Reading characteristic…", async () => {
      const value = await this.ports
        .workspaceStore()
        .getController()
        .read(endpoint);
      this.ports
        .noticeStore()
        .setInfo(
          `Read ${value.length} byte(s). The transaction retains exact bytes.`,
        );
    });
  }
  async subscribeNotifications(endpoint: GattEndpoint): Promise<void> {
    await this.ports.noticeStore()._run("Subscribing…", async () => {
      await this.ports
        .workspaceStore()
        .getController()
        .enableNotifications(endpoint);
      this.ports.noticeStore().setInfo("Notifications subscribed.");
    });
  }
  recordObservation(summary: string): void {
    this.ports.workspaceStore().getController().recordObservation(summary);
    this.ports.noticeStore().setInfo("Observation recorded for this session.");
    this.ports.snapshotStore()._emit();
  }
  importExternalCapture(content: string): void {
    try {
      if (
        new TextEncoder().encode(content).byteLength > INPUT_LIMITS.captureBytes
      )
        throw new Error("Capture exceeds the 25 MiB input budget.");
      const evidence = this.ports
        .workspaceStore()
        .getController()
        .importExternalLog(content);
      this._lastImport = summarizeImport(evidence);
      this.ports.navigationStore().setPage("workspace");
      this.ports.navigationStore().setViewState("develop");
      this.ports
        .noticeStore()
        .setInfo(
          `Imported ${evidence.transactions.length} transaction(s) from the ${evidence.provenance}. Imported evidence never transmits.`,
        );
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
    }
    this.ports.snapshotStore()._emit();
  }
}
