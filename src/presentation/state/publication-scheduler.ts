/** One presentation task per burst, with explicit workspace ownership. */
export class PublicationScheduler {
  private readonly owners = new Map<string, () => boolean>();
  private task: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly publish: () => void) {}

  schedule(owner: string, current: () => boolean): void {
    if (this.disposed) return;
    this.owners.set(owner, current);
    if (this.task !== null) return;
    // A task boundary also combines the microtasks of a protocol operation.
    this.task = setTimeout(() => {
      this.task = null;
      const pending = this.hasPending;
      this.owners.clear();
      if (pending && !this.disposed) this.publish();
    }, 0);
  }

  get hasPending(): boolean {
    return [...this.owners.values()].some((current) => current());
  }

  cancel(owner?: string): void {
    if (owner === undefined) this.owners.clear();
    else this.owners.delete(owner);
    if (this.owners.size === 0 && this.task !== null) {
      clearTimeout(this.task);
      this.task = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}
