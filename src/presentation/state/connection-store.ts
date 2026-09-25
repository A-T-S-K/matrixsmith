import { INPUT_LIMITS } from "./dependencies";
import type { GattEndpoint } from "./dependencies";

import { summarizeImport, endpointKey } from "./selectors";

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
  noticeStore(): Pick<NoticeStore, "_run" | "setInfo" | "setError">;
  investigationStore(): Pick<
    InvestigationStore,
    "_persistInvestigation" | "_persistDetachedInvestigation"
  >;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
  navigationStore(): Pick<
    NavigationStore,
    "setPage" | "setViewState" | "getRouter" | "getView"
  >;
  contentEditorStore(): Pick<ContentEditorStore, "updateContentSettings">;
}
export class ConnectionStore {
  private readonly _subscriptions = new Set<string>();
  private _previouslyAuthorized: { id: string; name: string }[] = [];
  private _lastImport: ImportSummary | null = null;
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "authorizedDevices"
    >,
  ) {}
  getPreviouslyAuthorized(): Readonly<
    ConnectionStore["_previouslyAuthorized"]
  > {
    return this._previouslyAuthorized;
  }
  getSubscriptions(): ReadonlySet<string> {
    return this._subscriptions;
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
    await this.ports
      .noticeStore()
      ._run(
        mode === "registered" ? "Connecting display…" : "Opening BLE explorer…",
        async () => {
          this.ports.investigationStore()._persistInvestigation();
          await this.ports
            .workspaceStore()
            .getController()
            .connect(mode, serviceHints);
          this.ports.investigationStore()._persistDetachedInvestigation();
          await this.ports
            .workspaceStore()
            .getController()
            .enableDriverNotifications()
            .catch(() => undefined);
          this.ports.navigationStore().setPage("workspace");
          // Known/usable displays open the Device Workspace; unknown or
          // incomplete hardware naturally enters the guided investigation.
          this.ports
            .navigationStore()
            .setViewState(
              mode === "inspection"
                ? "develop"
                : this.ports.workspaceStore().getController().session.selection
                      ?.selected
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
        },
      );
  }
  async disconnect(): Promise<void> {
    await this.ports.noticeStore()._run("Disconnecting…", async () => {
      await this.ports.workspaceStore().getController().disconnect();
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
              ? "CoolLEDUX identified from a valid structured 0x1F response."
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
  async toggleSubscription(endpoint: GattEndpoint): Promise<void> {
    const key = endpointKey(endpoint);
    await this.ports
      .noticeStore()
      ._run(
        this._subscriptions.has(key) ? "Unsubscribing…" : "Subscribing…",
        async () => {
          if (this._subscriptions.has(key))
            throw new Error(
              "Unsubscribe is available after disconnect in this transport adapter.",
            );
          await this.ports
            .workspaceStore()
            .getController()
            .enableNotifications(endpoint);
          this._subscriptions.add(key);
          this.ports.noticeStore().setInfo("Notifications subscribed.");
        },
      );
  }
  recordObservation(summary: string): void {
    this.ports.workspaceStore().getController().recordObservation(summary);
    this.ports.noticeStore().setInfo("Observation recorded for this session.");
    this.ports.snapshotStore()._emit();
  }
  importExternalCapture(content: string): void {
    this.ports.noticeStore().setError(null);
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
