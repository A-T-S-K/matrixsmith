export interface WakeLockHandle { release(): Promise<void>; addEventListener?(type: "release", listener: () => void): void }
export interface WakeLockNavigator { wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> } }

/** Best-effort Screen Wake Lock lifecycle. Failure never affects the transfer. */
export class TransferWakeLock {
  #handle: WakeLockHandle | null = null;
  #active = false;
  #visibility?: () => void;
  constructor(private readonly navigatorLike: WakeLockNavigator, private readonly documentLike?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">) {}
  get supported(): boolean { return Boolean(this.navigatorLike.wakeLock?.request); }
  async acquire(): Promise<boolean> {
    this.#active = true;
    if (!this.#visibility && this.documentLike) { this.#visibility = () => { if (this.#active && this.documentLike?.visibilityState === "visible" && !this.#handle) void this.#request(); }; this.documentLike.addEventListener("visibilitychange", this.#visibility); }
    return this.#request();
  }
  async release(): Promise<void> {
    this.#active = false;
    if (this.#visibility && this.documentLike) this.documentLike.removeEventListener("visibilitychange", this.#visibility);
    this.#visibility = undefined; const handle = this.#handle; this.#handle = null;
    if (handle) await handle.release().catch(() => undefined);
  }
  async #request(): Promise<boolean> {
    if (!this.#active || !this.navigatorLike.wakeLock || this.#handle) return Boolean(this.#handle);
    try { const handle = await this.navigatorLike.wakeLock.request("screen"); this.#handle = handle; handle.addEventListener?.("release", () => { if (this.#handle === handle) this.#handle = null; }); return true; } catch { return false; }
  }
}
