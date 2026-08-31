import type { DeviceFingerprint, GattEndpoint } from "../core/device";
import type { WriteMode } from "../core/transmission";
import type { ConnectionState, DeviceSelectionOptions, MatrixTransport, TransportReceipt } from "./types";

export class ReplayTransport implements MatrixTransport {
  readonly kind = "replay" as const;
  state: ConnectionState = "idle";
  readonly fingerprint: DeviceFingerprint;
  readonly notifications: readonly Uint8Array[];

  constructor(fingerprint: DeviceFingerprint, notifications: readonly Uint8Array[] = []) {
    this.fingerprint = fingerprint;
    this.notifications = notifications.map((bytes) => bytes.slice());
  }

  async selectAndConnect(_options: DeviceSelectionOptions): Promise<DeviceFingerprint> {
    this.state = "connected";
    return this.fingerprint;
  }
  async disconnect(): Promise<void> { this.state = "idle"; }
  async read(_endpoint: GattEndpoint): Promise<Uint8Array> { return new Uint8Array(); }
  async subscribe(_endpoint: GattEndpoint, listener: (bytes: Uint8Array) => void): Promise<() => Promise<void>> {
    for (const bytes of this.notifications) queueMicrotask(() => listener(bytes.slice()));
    return async () => undefined;
  }
  async write(_endpoint: GattEndpoint, _bytes: Uint8Array, _mode: WriteMode): Promise<TransportReceipt> {
    throw new Error("Imported and replay diagnostics are offline evidence and cannot transmit.");
  }
}
