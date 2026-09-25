import type { SnapshotStore } from "./snapshot-store";
import type { WorkspaceStore } from "./workspace-store";

interface Ports {
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
}
export class NoticeStore {
  private _busy: string | null = null;
  private _error: string | null = null;
  private _info: string | null = null;
  private _operationVersion = 0;
  private active = new Map<number, string>();
  constructor(private readonly ports: Ports) {}
  setInfo(value: NoticeStore["_info"]): void {
    this._info = value;
  }
  setError(value: NoticeStore["_error"]): void {
    this._error = value;
  }
  getBusy() {
    return this._busy;
  }
  getError() {
    return this._error;
  }
  getInfo() {
    return this._info;
  }
  clearMessage(): void {
    this._error = null;
    this._info = null;
    this.ports.snapshotStore()._emit();
  }
  async _run(label: string, action: () => Promise<void>): Promise<void> {
    const operation = ++this._operationVersion;
    const workspace = this.ports.workspaceStore().getController();
    this.active.set(operation, label);
    this._busy = label;
    this._error = null;
    this.ports.snapshotStore()._emit();
    try {
      await action();
    } catch (error) {
      if (
        operation === this._operationVersion &&
        workspace === this.ports.workspaceStore().getController()
      )
        this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this.active.delete(operation);
      this._busy = [...this.active.values()].at(-1) ?? null;
      this.ports.snapshotStore()._emit();
    }
  }
}
