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
  /**
   * The static-raster delivery strategy physical evidence validated THIS
   * session. Built-in profile preferences are never mutated; this is the
   * session-scoped selection Normal Use routes through.
   */
  validatedRasterStrategy: import("../core/raster-strategy").RasterStrategy | null = null;
  #experimentalTxEnabled = false;
  #confirmedPersistentPlanId: string | null = null;

  get experimentalTxEnabled(): boolean { return this.#experimentalTxEnabled; }
  enableExperimentalTx(): void { this.#experimentalTxEnabled = true; }
  disableExperimentalTx(): void { this.#experimentalTxEnabled = false; }
  get confirmedPersistentPlanId(): string | null { return this.#confirmedPersistentPlanId; }
  /** Records that the user explicitly confirmed the exact consequence of ONE persistent plan. */
  confirmPersistentPlan(planId: string): void { this.#confirmedPersistentPlanId = planId; }
  /** Confirmation is single-use: consume it when the plan executes (or fails). */
  consumePersistentConfirmation(): void { this.#confirmedPersistentPlanId = null; }
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
    this.validatedRasterStrategy = null;
    this.#experimentalTxEnabled = false;
    this.#confirmedPersistentPlanId = null;
  }
}
