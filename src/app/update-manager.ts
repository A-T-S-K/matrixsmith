export interface UpdatePort {
  hasWaiting(): boolean;
  check(): Promise<void>;
  activate(): Promise<void>;
  subscribe(listener: () => void): () => void;
  reload(): void;
}
export interface UpdateState {
  readonly available: boolean;
  readonly applying: boolean;
  readonly error: string | null;
}

/** Persistent across bootstrap and workspace mounts; owns update state only. */
export class UpdateManager {
  #state: UpdateState;
  #listeners = new Set<() => void>();
  #unsubscribe: (() => void) | null;
  #blocker: () => string | null = () => null;
  #disposed = false;
  #blockers = new Set<() => string | null>();
  addBlocker(blocker: () => string | null): () => void {
    this.#blockers.add(blocker);
    return () => this.#blockers.delete(blocker);
  }
  constructor(private readonly port: UpdatePort) {
    this.#state = {
      available: port.hasWaiting(),
      applying: false,
      error: null,
    };
    this.#unsubscribe = port.subscribe(() =>
      this.#publish({ available: port.hasWaiting() }),
    );
  }
  get state(): UpdateState {
    return this.#state;
  }
  get blockingReason(): string | null {
    return (
      this.#blocker() ??
      [...this.#blockers].map((read) => read()).find(Boolean) ??
      null
    );
  }
  setBlocker(blocker: () => string | null): void {
    this.#blocker = blocker;
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async checkForUpdate(): Promise<void> {
    try {
      await this.port.check();
      this.#publish({ available: this.port.hasWaiting(), error: null });
    } catch (error) {
      this.#publish({ error: message(error) });
    }
  }
  async applyUpdate(): Promise<void> {
    if (this.#disposed || this.#state.applying) return;
    const blocked = this.blockingReason;
    if (blocked) {
      this.#publish({ error: blocked });
      return;
    }
    if (!this.port.hasWaiting()) {
      this.#publish({
        available: false,
        error: "No update is waiting. Check again when online.",
      });
      return;
    }
    this.#publish({ applying: true, error: null });
    try {
      await this.port.activate();
      if (!this.#disposed) this.port.reload();
    } catch (error) {
      this.#publish({ error: message(error) });
    } finally {
      this.#publish({ applying: false });
    }
  }
  setActivationLock(applying: boolean): void {
    this.#publish({ applying });
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
    this.#blockers.clear();
  }
  #publish(patch: Partial<UpdateState>): void {
    if (this.#disposed) return;
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) listener();
  }
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
