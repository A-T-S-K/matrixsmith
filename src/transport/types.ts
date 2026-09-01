import type { DeviceFingerprint, GattEndpoint } from "../core/device";
import type { WriteMode } from "../core/transmission";

export type ConnectionState = "idle" | "selecting" | "connecting" | "connected" | "disconnecting" | "error";

export interface DiscoveryHints {
  readonly filters: readonly BluetoothLEScanFilter[];
  readonly optionalServices: readonly BluetoothServiceUUID[];
  /** Company identifiers requested via optionalManufacturerData where the browser supports it. */
  readonly optionalManufacturerData?: readonly number[];
}

export interface DeviceSelectionOptions {
  readonly mode: "registered" | "inspection";
  readonly hints: DiscoveryHints;
  readonly serviceHints?: readonly BluetoothServiceUUID[];
}

export interface TransportReceipt {
  readonly acceptedAt: string;
  readonly endpoint: GattEndpoint;
  readonly writeMode: WriteMode;
  readonly byteLength: number;
}

export interface MatrixTransport {
  readonly kind: DeviceFingerprint["transportKind"];
  readonly state: ConnectionState;
  readonly fingerprint: DeviceFingerprint | null;
  selectAndConnect(options: DeviceSelectionOptions): Promise<DeviceFingerprint>;
  disconnect(): Promise<void>;
  read(endpoint: GattEndpoint): Promise<Uint8Array>;
  subscribe(endpoint: GattEndpoint, listener: (bytes: Uint8Array) => void): Promise<() => Promise<void>>;
  write(endpoint: GattEndpoint, bytes: Uint8Array, mode: WriteMode): Promise<TransportReceipt>;
  /** Reconnect a previously browser-authorized device without a chooser, where getDevices() is supported. */
  reconnectAuthorized?(deviceId: string, options: DeviceSelectionOptions): Promise<DeviceFingerprint>;
  /**
   * Best-effort structured advertisement observation via watchAdvertisements().
   * Returns null when unsupported or nothing arrives in time; must never
   * throw in a way that affects the connection.
   */
  observeAdvertisements?(timeoutMs?: number): Promise<import("../core/device").AdvertisementObservation | null>;
}
