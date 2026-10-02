import type { SnapshotStore } from "./snapshot-store";
import type { WorkspaceStore } from "./workspace-store";

interface Ports {
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
}
export class NoticeStore {
  private _busy: string | null = null;
  private errors = new Map<
    string,
    {
      message: string;
      workspace: ReturnType<
        ReturnType<Ports["workspaceStore"]>["getController"]
      >;
      version: number;
    }
  >();
  private errorVersion = 0;
  private ownerOperations = new Map<string, number>();
  private _info: string | null = null;
  private _operationVersion = 0;
  private active = new Map<number, string>();
  constructor(private readonly ports: Ports) {}
  captureContext() {
    return { errors: this.errors, info: this._info };
  }
  restoreContext(
    state: ReturnType<NoticeStore["captureContext"]> | null,
  ): void {
    this.errors = state?.errors ?? new Map();
    this._info = state?.info ?? null;
  }
  setInfo(value: NoticeStore["_info"]): void {
    this._info = value;
  }
  setError(value: string | null, owner = "notice"): void {
    if (value === null) this.errors.delete(owner);
    else
      this.errors.set(owner, {
        message: value,
        workspace: this.ports.workspaceStore().getController(),
        version: ++this.errorVersion,
      });
  }
  getBusy() {
    return this._busy;
  }
  getError() {
    const workspace = this.ports.workspaceStore().getController();
    for (const [owner, error] of this.errors)
      if (error.workspace !== workspace) this.errors.delete(owner);
    return (
      [...this.errors.values()].sort((a, b) => b.version - a.version)[0]
        ?.message ?? null
    );
  }
  getInfo() {
    return this._info;
  }
  clearMessage(): void {
    this.errors.clear();
    this._info = null;
    this.ports.snapshotStore()._emit();
  }
  async _run(label: string, action: () => Promise<void>): Promise<void> {
    const operation = ++this._operationVersion;
    const workspace = this.ports.workspaceStore().getController();
    this.active.set(operation, label);
    this._busy = label;
    this._info = null;
    const originErrors = this.errors;
    const previousError = originErrors.get(label);
    this.ownerOperations.set(label, operation);
    this.ports.snapshotStore()._emit();
    try {
      await action();
      if (
        originErrors.get(label) === previousError &&
        this.ownerOperations.get(label) === operation
      )
        originErrors.delete(label);
    } catch (error) {
      if (
        this.ownerOperations.get(label) === operation &&
        workspace === this.ports.workspaceStore().getController()
      )
        this.setError(
          error instanceof Error ? error.message : String(error),
          label,
        );
    } finally {
      this.active.delete(operation);
      this._busy = [...this.active.values()].at(-1) ?? null;
      this.ports.snapshotStore()._emit();
    }
  }
}
