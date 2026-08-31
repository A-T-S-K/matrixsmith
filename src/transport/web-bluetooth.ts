import type { CharacteristicProperties, DeviceFingerprint, GattEndpoint, GattServiceFingerprint } from "../core/device";
import { normalizeUuid } from "../core/device";
import type { WriteMode } from "../core/transmission";
import type { TraceRecorder } from "../diagnostics/trace";
import type { ConnectionState, DeviceSelectionOptions, MatrixTransport, TransportReceipt } from "./types";

export type TransportStateListener = (state: ConnectionState) => void;

export class WebBluetoothTransport implements MatrixTransport {
  readonly kind = "web-bluetooth" as const;
  #state: ConnectionState = "idle";
  #fingerprint: DeviceFingerprint | null = null;
  #device: BluetoothDevice | null = null;
  #server: BluetoothRemoteGATTServer | null = null;
  readonly #characteristics = new Map<string, BluetoothRemoteGATTCharacteristic>();
  readonly #stateListeners = new Set<TransportStateListener>();
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly trace: TraceRecorder) {}

  get state(): ConnectionState { return this.#state; }
  get fingerprint(): DeviceFingerprint | null { return this.#fingerprint; }

  subscribeState(listener: TransportStateListener): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  async selectAndConnect(options: DeviceSelectionOptions): Promise<DeviceFingerprint> {
    if (!("bluetooth" in navigator)) throw new Error("Web Bluetooth is unavailable in this browser.");
    if (this.#state !== "idle" && this.#state !== "error") throw new Error(`Cannot connect while transport is ${this.#state}.`);
    this.#setState("selecting");
    this.trace.record("device.selection.started", { mode: options.mode });
    try {
      const optionalServices = [...new Set([
        ...options.hints.optionalServices.map(String),
        ...(options.serviceHints ?? []).map(String),
      ])];
      const requestOptions: RequestDeviceOptions = options.mode === "inspection"
        ? { acceptAllDevices: true, optionalServices }
        : { filters: [...options.hints.filters], optionalServices };
      const device = await navigator.bluetooth.requestDevice(requestOptions);
      this.#device = device;
      device.addEventListener("gattserverdisconnected", this.#onDisconnected);
      this.trace.record("device.selected", { deviceName: device.name ?? "Unnamed device", browserDeviceId: device.id });
      this.#setState("connecting");
      this.trace.record("gatt.connect.started", {});
      const server = await device.gatt?.connect();
      if (!server) throw new Error("The selected Bluetooth device has no GATT server.");
      this.#server = server;
      this.trace.record("gatt.connected", { connected: server.connected });
      const services = await this.#enumerateServices(server);
      this.#fingerprint = {
        schemaVersion: 1,
        transportKind: "web-bluetooth",
        browserDeviceId: device.id,
        ...(device.name ? { name: device.name } : {}),
        advertisedServices: [],
        requestedServices: [...new Set([...options.hints.filters.flatMap((filter) => (filter.services ?? []).map(String)), ...optionalServices])],
        browserGrantedServices: services.map(({ uuid }) => uuid),
        services,
        evidenceRefs: ["browser-gatt-enumeration"],
        notes: options.mode === "inspection"
          ? ["GATT enumeration includes only services granted by the browser chooser and optional service hints."]
          : ["Discovery filters are request parameters and are not recorded as advertisement observations."],
      };
      this.#setState("connected");
      return this.#fingerprint;
    } catch (error) {
      this.trace.record("error", { scope: "connect", message: errorMessage(error) });
      await this.#cleanup(false);
      this.#setState("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#state === "idle") return;
    this.#setState("disconnecting");
    await this.#cleanup(true);
    this.#setState("idle");
  }

  async read(endpoint: GattEndpoint): Promise<Uint8Array> {
    const characteristic = await this.#resolve(endpoint);
    if (!characteristic.properties.read) throw new Error("Characteristic does not support reads.");
    const value = await characteristic.readValue();
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    this.trace.record("gatt.read", { serviceUuid: endpoint.serviceUuid, characteristicUuid: endpoint.characteristicUuid, byteLength: bytes.length }, bytes);
    return bytes;
  }

  async subscribe(endpoint: GattEndpoint, listener: (bytes: Uint8Array) => void): Promise<() => Promise<void>> {
    const characteristic = await this.#resolve(endpoint);
    if (!characteristic.properties.notify && !characteristic.properties.indicate) throw new Error("Characteristic does not support notifications.");
    const onValue = (event: Event): void => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      const bytes = value ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() : new Uint8Array();
      listener(bytes);
    };
    characteristic.addEventListener("characteristicvaluechanged", onValue);
    await characteristic.startNotifications();
    this.trace.record("gatt.notifications.enabled", { serviceUuid: endpoint.serviceUuid, characteristicUuid: endpoint.characteristicUuid });
    return async () => {
      characteristic.removeEventListener("characteristicvaluechanged", onValue);
      if (characteristic.service.device.gatt?.connected) await characteristic.stopNotifications();
    };
  }

  async write(endpoint: GattEndpoint, bytes: Uint8Array, mode: WriteMode): Promise<TransportReceipt> {
    if (this.#state !== "connected") throw new Error("Cannot write while disconnected.");
    let resolveQueue: (() => void) | undefined;
    const previous = this.#writeQueue;
    this.#writeQueue = new Promise<void>((resolve) => { resolveQueue = resolve; });
    await previous;
    try {
      const characteristic = await this.#resolve(endpoint);
      const writable = Uint8Array.from(bytes);
      if (mode === "without-response") {
        if (!characteristic.properties.writeWithoutResponse) throw new Error("Characteristic does not support write without response.");
        await characteristic.writeValueWithoutResponse(writable);
      } else {
        if (!characteristic.properties.write) throw new Error("Characteristic does not support write with response.");
        await characteristic.writeValueWithResponse(writable);
      }
      return { acceptedAt: new Date().toISOString(), endpoint, writeMode: mode, byteLength: bytes.length };
    } finally {
      resolveQueue?.();
    }
  }

  async #enumerateServices(server: BluetoothRemoteGATTServer): Promise<readonly GattServiceFingerprint[]> {
    const services = await server.getPrimaryServices();
    const result: GattServiceFingerprint[] = [];
    for (const service of services) {
      this.trace.record("gatt.service.resolved", { serviceUuid: service.uuid });
      const characteristics = await service.getCharacteristics();
      const fingerprints = characteristics.map((characteristic) => {
        this.#characteristics.set(endpointKey({ serviceUuid: service.uuid, characteristicUuid: characteristic.uuid }), characteristic);
        this.trace.record("gatt.characteristic.resolved", { serviceUuid: service.uuid, characteristicUuid: characteristic.uuid });
        return { uuid: characteristic.uuid, properties: propertiesOf(characteristic.properties) };
      });
      result.push({ uuid: service.uuid, isPrimary: service.isPrimary, characteristics: fingerprints });
    }
    return result;
  }

  async #resolve(endpoint: GattEndpoint): Promise<BluetoothRemoteGATTCharacteristic> {
    if (this.#state !== "connected" || !this.#server?.connected) throw new Error("Transport is disconnected.");
    const key = endpointKey(endpoint);
    const cached = this.#characteristics.get(key);
    if (cached) return cached;
    const service = await this.#server.getPrimaryService(endpoint.serviceUuid);
    const characteristic = await service.getCharacteristic(endpoint.characteristicUuid);
    this.#characteristics.set(key, characteristic);
    return characteristic;
  }

  async #cleanup(explicit: boolean): Promise<void> {
    this.#characteristics.clear();
    this.#server = null;
    if (this.#device) {
      this.#device.removeEventListener("gattserverdisconnected", this.#onDisconnected);
      this.#device.gatt?.disconnect();
    }
    this.#device = null;
    if (explicit) this.trace.record("disconnect", { explicit: true });
  }

  readonly #onDisconnected = (): void => {
    this.#characteristics.clear();
    this.#server = null;
    this.#setState("idle");
    this.trace.record("disconnect", { explicit: false });
  };

  #setState(state: ConnectionState): void {
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }
}

function endpointKey(endpoint: GattEndpoint): string { return `${normalizeUuid(endpoint.serviceUuid)}/${normalizeUuid(endpoint.characteristicUuid)}`; }

function propertiesOf(properties: BluetoothCharacteristicProperties): CharacteristicProperties {
  return {
    read: properties.read,
    notify: properties.notify,
    indicate: properties.indicate,
    write: properties.write,
    writeWithoutResponse: properties.writeWithoutResponse,
  };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
