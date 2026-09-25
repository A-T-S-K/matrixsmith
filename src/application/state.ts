import { TransmissionAuthorization } from "../app/transmission-authorization";
import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import type { DriverSelection } from "../drivers/registry";
import type { NotificationRecord } from "../app/notifications";
import type { DecodedNotification } from "../drivers/types";
import { INPUT_LIMITS } from "./input-limits";

export class ApplicationState {
  constructor(private readonly authority = new TransmissionAuthorization()) {}
  fingerprint: DeviceFingerprint | null = null;
  selection: DriverSelection | null = null;
  profile: DeviceProfile | null = null;
  source: "live" | "imported" | "fake" | "replay" = "live";
  readonly notifications: NotificationRecord[] = [];
  protocolResolution: {
    readonly driverId: string;
    readonly probeId: string;
    readonly summary: string;
    readonly source: "live-probe" | "replay";
  } | null = null;
  /**
   * The static-raster delivery strategy physical evidence validated THIS
   * session. Built-in profile preferences are never mutated; this is the
   * session-scoped selection Normal Use routes through.
   */
  validatedRasterStrategy:
    import("../core/raster-strategy").RasterStrategy | null = null;

  get experimentalTxEnabled(): boolean {
    return this.authority.experimentalTxEnabled;
  }
  enableExperimentalTx(): void {
    this.authority.enableExperimentalTx();
  }
  disableExperimentalTx(): void {
    this.authority.disableExperimentalTx();
  }
  get confirmedPlanDigest(): string | null {
    return this.authority.confirmedPlanDigest;
  }
  /** Records confirmation of one exact target-bound digest, never a reusable plan id. */
  confirmPlanDigest(digest: string): void {
    this.authority.confirmPlanDigest(digest);
  }
  /** Legacy read-only alias retained for snapshots; values are digests. */
  get confirmedPersistentPlanId(): string | null {
    return this.authority.confirmedPlanDigest;
  }
  /** Confirmation is single-use: consume it when the plan executes (or fails). */
  consumePersistentConfirmation(): void {
    this.authority.consumePersistentConfirmation();
  }
  get latestDeviceInfo(): DecodedNotification | null {
    for (let index = this.notifications.length - 1; index >= 0; index -= 1) {
      const decoded = this.notifications[index]?.decoded;
      if (decoded?.kind === "device-info") return decoded;
    }
    return null;
  }
  recordNotification(record: NotificationRecord): void {
    this.notifications.push(record);
    if (this.notifications.length > INPUT_LIMITS.traceEvents)
      this.notifications.shift();
  }
  clearConnection(): void {
    this.fingerprint = null;
    this.selection = null;
    this.profile = null;
    this.notifications.length = 0;
    this.protocolResolution = null;
    this.validatedRasterStrategy = null;
    this.authority.disableExperimentalTx();
    this.authority.consumePersistentConfirmation();
  }
}
