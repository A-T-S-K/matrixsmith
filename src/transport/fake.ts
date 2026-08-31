import type { DeviceFingerprint, GattEndpoint } from "../core/device";
import type { WriteMode } from "../core/transmission";
import type { ConnectionState, DeviceSelectionOptions, MatrixTransport, TransportReceipt } from "./types";

export class FakeTransport implements MatrixTransport {
  readonly kind = "fake" as const;
  readonly writes: { endpoint: GattEndpoint; bytes: Uint8Array; mode: WriteMode }[] = [];
  readonly writeAttempts: { endpoint: GattEndpoint; bytes: Uint8Array; mode: WriteMode }[] = [];
  state: ConnectionState = "idle";
  fingerprint: DeviceFingerprint | null;
  failWriteAt: number | null = null;
  writeDelayMs = 0;
  notificationOnWrite: Uint8Array | null = null;
  readonly #listeners = new Set<(bytes: Uint8Array) => void>();

  constructor(fingerprint: DeviceFingerprint | null = null) { this.fingerprint = fingerprint; }

  async selectAndConnect(_options: DeviceSelectionOptions): Promise<DeviceFingerprint> {
    if (this.state !== "idle") throw new Error(`Cannot connect while transport is ${this.state}.`);
    if (!this.fingerprint) throw new Error("Fake transport has no fingerprint fixture.");
    this.state = "connected";
    return this.fingerprint;
  }

  async disconnect(): Promise<void> { this.state = "idle"; }

  async read(_endpoint: GattEndpoint): Promise<Uint8Array> {
    if (this.state !== "connected") throw new Error("Transport is disconnected.");
    return new Uint8Array();
  }

  async subscribe(_endpoint: GattEndpoint, listener: (bytes: Uint8Array) => void): Promise<() => Promise<void>> {
    if (this.state !== "connected") throw new Error("Transport is disconnected.");
    this.#listeners.add(listener);
    return async () => { this.#listeners.delete(listener); };
  }

  async write(endpoint: GattEndpoint, bytes: Uint8Array, mode: WriteMode): Promise<TransportReceipt> {
    if (this.state !== "connected") throw new Error("Transport is disconnected.");
    this.writeAttempts.push({ endpoint, bytes: bytes.slice(), mode });
    const writeIndex = this.writes.length;
    if (this.failWriteAt === writeIndex) throw new Error(`Injected write failure at packet ${writeIndex}.`);
    if (this.notificationOnWrite) for (const listener of this.#listeners) listener(this.notificationOnWrite.slice());
    if (this.writeDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.writeDelayMs));
    this.writes.push({ endpoint, bytes: bytes.slice(), mode });
    return { acceptedAt: new Date().toISOString(), endpoint, writeMode: mode, byteLength: bytes.length };
  }
}
