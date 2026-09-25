import type { DeviceFingerprint, GattEndpoint } from "../core/device";
import type { WriteMode } from "../core/transmission";
import type {
  ConnectionState,
  DeviceSelectionOptions,
  MatrixTransport,
  TransportReceipt,
} from "../application/ports/transport";

export class FakeTransport implements MatrixTransport {
  readonly kind = "fake" as const;
  readonly writes: {
    endpoint: GattEndpoint;
    bytes: Uint8Array;
    mode: WriteMode;
  }[] = [];
  readonly writeAttempts: {
    endpoint: GattEndpoint;
    bytes: Uint8Array;
    mode: WriteMode;
  }[] = [];
  state: ConnectionState = "idle";
  connectionId: string | null = null;
  fingerprint: DeviceFingerprint | null;
  failWriteAt: number | null = null;
  writeDelayMs = 0;
  notificationOnWrite: Uint8Array | null = null;
  readonly #listeners = new Set<(bytes: Uint8Array) => void>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();

  constructor(fingerprint: DeviceFingerprint | null = null) {
    this.fingerprint = fingerprint;
  }
  get notificationListenerCount(): number {
    return this.#listeners.size;
  }

  async selectAndConnect(
    _options: DeviceSelectionOptions,
  ): Promise<DeviceFingerprint> {
    if (this.state !== "idle")
      throw new Error(`Cannot connect while transport is ${this.state}.`);
    if (!this.fingerprint)
      throw new Error("Fake transport has no fingerprint fixture.");
    this.connectionId = `fake:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    this.#setState("connected");
    return this.fingerprint;
  }

  async disconnect(): Promise<void> {
    this.connectionId = null;
    this.#setState("idle");
  }
  unexpectedDisconnect(): void {
    this.connectionId = null;
    this.#listeners.clear();
    this.#setState("idle");
  }
  quarantine(_reason: string): void {
    if (this.state === "connected") this.#setState("quarantined");
  }
  subscribeState(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    listener(this.state);
    return () => this.#stateListeners.delete(listener);
  }

  async read(_endpoint: GattEndpoint): Promise<Uint8Array> {
    if (this.state !== "connected")
      throw new Error("Transport is disconnected.");
    return new Uint8Array();
  }

  async subscribe(
    _endpoint: GattEndpoint,
    listener: (bytes: Uint8Array) => void,
  ): Promise<() => Promise<void>> {
    if (this.state !== "connected")
      throw new Error("Transport is disconnected.");
    this.#listeners.add(listener);
    return async () => {
      this.#listeners.delete(listener);
    };
  }

  async write(
    endpoint: GattEndpoint,
    bytes: Uint8Array,
    mode: WriteMode,
  ): Promise<TransportReceipt> {
    if (this.state !== "connected")
      throw new Error("Transport is disconnected.");
    this.writeAttempts.push({ endpoint, bytes: bytes.slice(), mode });
    const writeIndex = this.writes.length;
    if (this.failWriteAt === writeIndex)
      throw new Error(`Injected write failure at packet ${writeIndex}.`);
    if (this.notificationOnWrite)
      for (const listener of this.#listeners)
        listener(this.notificationOnWrite.slice());
    if (this.writeDelayMs > 0)
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.writeDelayMs),
      );
    this.writes.push({ endpoint, bytes: bytes.slice(), mode });
    return {
      acceptedAt: new Date().toISOString(),
      endpoint,
      writeMode: mode,
      byteLength: bytes.length,
    };
  }

  #setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.#stateListeners) listener(state);
  }
}
