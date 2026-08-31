import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { DriverSelection } from "../drivers/registry";

export class MatrixSession {
  fingerprint: DeviceFingerprint | null = null;
  selection: DriverSelection | null = null;
  profile: DeviceProfile | null = null;
  source: "live" | "imported" | "fake" | "replay" = "live";
  #experimentalTxEnabled = false;

  get experimentalTxEnabled(): boolean { return this.#experimentalTxEnabled; }
  enableExperimentalTx(): void { this.#experimentalTxEnabled = true; }
  disableExperimentalTx(): void { this.#experimentalTxEnabled = false; }
  clearConnection(): void {
    this.fingerprint = null;
    this.selection = null;
    this.profile = null;
    this.#experimentalTxEnabled = false;
  }
}
