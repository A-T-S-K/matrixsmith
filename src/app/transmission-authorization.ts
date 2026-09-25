/** Session-only write authority. Never serialized or restored from evidence. */
export class TransmissionAuthorization {
  #experimental = false;
  #digest: string | null = null;
  get experimentalTxEnabled(): boolean {
    return this.#experimental;
  }
  get confirmedPlanDigest(): string | null {
    return this.#digest;
  }
  enableExperimentalTx(): void {
    this.#experimental = true;
  }
  disableExperimentalTx(): void {
    this.#experimental = false;
  }
  confirmPlanDigest(digest: string): void {
    this.#digest = digest;
  }
  consumePersistentConfirmation(): void {
    this.#digest = null;
  }
  reset(): void {
    this.#experimental = false;
    this.#digest = null;
  }
}
