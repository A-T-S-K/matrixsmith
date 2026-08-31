import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { DriverSelection } from "../drivers/registry";
import type { NotificationRecord } from "./notifications";
import type { DecodedNotification } from "../drivers/types";

export class MatrixSession {
  fingerprint: DeviceFingerprint | null = null;
  selection: DriverSelection | null = null;
  profile: DeviceProfile | null = null;
  source: "live" | "imported" | "fake" | "replay" = "live";
  readonly notifications: NotificationRecord[] = [];
  protocolResolution: { readonly driverId: string; readonly probeId: string; readonly summary: string; readonly source: "live-probe" | "replay" } | null = null;
  #experimentalTxEnabled = false;

  get experimentalTxEnabled(): boolean { return this.#experimentalTxEnabled; }
  enableExperimentalTx(): void { this.#experimentalTxEnabled = true; }
  disableExperimentalTx(): void { this.#experimentalTxEnabled = false; }
  get latestDeviceInfo(): DecodedNotification | null {
    for (let index = this.notifications.length - 1; index >= 0; index -= 1) {
      const decoded = this.notifications[index]?.decoded;
      if (decoded?.kind === "device-info") return decoded;
    }
    return null;
  }
  recordNotification(record: NotificationRecord): void { this.notifications.push(record); }
  clearConnection(): void {
    this.fingerprint = null;
    this.selection = null;
    this.profile = null;
    this.notifications.length = 0;
    this.protocolResolution = null;
    this.#experimentalTxEnabled = false;
  }
}
