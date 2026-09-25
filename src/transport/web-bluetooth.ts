import type {
  CharacteristicProperties,
  DeviceFingerprint,
  GattEndpoint,
  GattServiceFingerprint,
} from "../core/device";
import { normalizeUuid } from "../core/device";
import type { WriteMode } from "../core/transmission";
import type { TraceRecorder } from "../diagnostics/trace";
import type {
  ConnectionState,
  DeviceSelectionOptions,
  MatrixTransport,
  TransportReceipt,
} from "../application/ports/transport";

export type TransportStateListener = (state: ConnectionState) => void;

export class WebBluetoothTransport implements MatrixTransport {
  readonly kind = "web-bluetooth" as const;
  #state: ConnectionState = "idle";
  #fingerprint: DeviceFingerprint | null = null;
  #connectionId: string | null = null;
  #device: BluetoothDevice | null = null;
  #server: BluetoothRemoteGATTServer | null = null;
  readonly #characteristics = new Map<
    string,
    BluetoothRemoteGATTCharacteristic
  >();
  readonly #stateListeners = new Set<TransportStateListener>();
  readonly #notificationCleanups = new Set<() => void>();
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly trace: TraceRecorder) {}

  get state(): ConnectionState {
    return this.#state;
  }
  get fingerprint(): DeviceFingerprint | null {
    return this.#fingerprint;
  }
  get connectionId(): string | null {
    return this.#connectionId;
  }

  subscribeState(listener: TransportStateListener): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  async selectAndConnect(
    options: DeviceSelectionOptions,
  ): Promise<DeviceFingerprint> {
    if (!("bluetooth" in navigator))
      throw new Error("Web Bluetooth is unavailable in this browser.");
    if (this.#state !== "idle" && this.#state !== "error")
      throw new Error(`Cannot connect while transport is ${this.#state}.`);
    this.#setState("selecting");
    this.trace.record("device.selection.started", { mode: options.mode });
    try {
      const optionalServices = [
        ...new Set([
          ...options.hints.optionalServices.map(String),
          ...(options.serviceHints ?? []).map(String),
        ]),
      ];
      const manufacturerData = options.hints.optionalManufacturerData;
      const requestOptions: RequestDeviceOptions & {
        optionalManufacturerData?: number[];
      } =
        options.mode === "inspection"
          ? { acceptAllDevices: true, optionalServices }
          : { filters: [...options.hints.filters], optionalServices };
      // optionalManufacturerData widens what advertisement events may expose;
      // it never narrows the chooser and older browsers simply ignore it.
      if (manufacturerData && manufacturerData.length > 0)
        requestOptions.optionalManufacturerData = [...manufacturerData];
      const device = await navigator.bluetooth.requestDevice(requestOptions);
      return await this.#connectDevice(device, options, optionalServices);
    } catch (error) {
      this.trace.record("error", {
        scope: "connect",
        message: errorMessage(error),
      });
      await this.#cleanup(false);
      this.#setState("error");
      throw error;
    }
  }

  /**
   * Chooser-free reconnect for a device the browser has already authorized
   * (getDevices()). Falls back is the caller's job: this throws when the
   * API or the device is unavailable.
   */
  async reconnectAuthorized(
    deviceId: string,
    options: DeviceSelectionOptions,
  ): Promise<DeviceFingerprint> {
    const bluetooth = navigator.bluetooth as Bluetooth & {
      getDevices?: () => Promise<readonly BluetoothDevice[]>;
    };
    if (!bluetooth?.getDevices)
      throw new Error(
        "This browser does not support reconnecting previously authorized devices.",
      );
    if (this.#state !== "idle" && this.#state !== "error")
      throw new Error(`Cannot connect while transport is ${this.#state}.`);
    this.#setState("selecting");
    this.trace.record("device.selection.started", {
      mode: options.mode,
      reconnect: true,
    });
    try {
      const devices = await bluetooth.getDevices();
      const device = devices.find((candidate) => candidate.id === deviceId);
      if (!device)
        throw new Error(
          "The previously authorized device was not found. Use the device chooser instead.",
        );
      return await this.#connectDevice(device, options, [
        ...options.hints.optionalServices.map(String),
      ]);
    } catch (error) {
      this.trace.record("error", {
        scope: "connect",
        message: errorMessage(error),
      });
      await this.#cleanup(false);
      this.#setState("error");
      throw error;
    }
  }

  async #connectDevice(
    device: BluetoothDevice,
    options: DeviceSelectionOptions,
    optionalServices: readonly string[],
  ): Promise<DeviceFingerprint> {
    this.#device = device;
    device.addEventListener("gattserverdisconnected", this.#onDisconnected);
    this.trace.record("device.selected", {
      deviceName: device.name ?? "Unnamed device",
      browserDeviceId: device.id,
    });
    this.#setState("connecting");
    this.trace.record("gatt.connect.started", {});
    const server = await device.gatt?.connect();
    if (!server)
      throw new Error("The selected Bluetooth device has no GATT server.");
    this.#server = server;
    this.trace.record("gatt.connected", { connected: server.connected });
    const services = await this.#enumerateServices(server);
    this.#fingerprint = {
      schemaVersion: 1,
      transportKind: "web-bluetooth",
      browserDeviceId: device.id,
      ...(device.name ? { name: device.name } : {}),
      advertisedServices: [],
      requestedServices: [
        ...new Set([
          ...options.hints.filters.flatMap((filter) =>
            (filter.services ?? []).map(String),
          ),
          ...optionalServices,
        ]),
      ],
      browserGrantedServices: services.map(({ uuid }) => uuid),
      services,
      evidenceRefs: ["browser-gatt-enumeration"],
      notes:
        options.mode === "inspection"
          ? [
              "GATT enumeration includes only services granted by the browser chooser and optional service hints.",
            ]
          : [
              "Discovery filters are request parameters and are not recorded as advertisement observations.",
            ],
    };
    this.#connectionId = `connection:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    this.#setState("connected");
    return this.#fingerprint;
  }

  /**
   * Best-effort structured advertisement observation. Returns null when
   * watchAdvertisements is unsupported or nothing arrives before the
   * timeout; the observation records only what the browser actually
   * exposes — a raw advertisement byte stream is never fabricated.
   */
  async observeAdvertisements(
    timeoutMs = 4000,
  ): Promise<import("../core/device").AdvertisementObservation | null> {
    const device = this.#device as
      | (BluetoothDevice & {
          watchAdvertisements?: (options?: {
            signal?: AbortSignal;
          }) => Promise<void>;
        })
      | null;
    if (!device?.watchAdvertisements) return null;
    const abort = new AbortController();
    const connectionId = this.#connectionId;
    try {
      const observation = await new Promise<
        import("../core/device").AdvertisementObservation | null
      >((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (
          value: import("../core/device").AdvertisementObservation | null,
        ): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          device.removeEventListener("advertisementreceived", onAdvertisement);
          resolve(value);
        };
        const onAdvertisement = (event: Event): void => {
          finish(
            structureAdvertisementEvent(
              event as Event & Partial<BluetoothAdvertisingEvent>,
            ),
          );
        };
        timer = setTimeout(() => finish(null), timeoutMs);
        device.addEventListener("advertisementreceived", onAdvertisement, {
          once: true,
        });
        device.watchAdvertisements!({ signal: abort.signal }).catch(() =>
          finish(null),
        );
      });
      if (
        observation &&
        this.#fingerprint &&
        this.#device === device &&
        this.#connectionId === connectionId &&
        this.#state === "connected"
      ) {
        this.#fingerprint = {
          ...this.#fingerprint,
          advertisementObservation: observation,
        };
        this.trace.record("advertisement.observed", {
          rssi: observation.rssi ?? null,
          manufacturerEntries: observation.manufacturerData.length,
        });
      }
      return observation;
    } catch {
      return null;
    } finally {
      abort.abort();
    }
  }

  async disconnect(): Promise<void> {
    if (this.#state === "idle") return;
    this.#setState("disconnecting");
    await this.#cleanup(true);
    this.#setState("idle");
  }

  quarantine(reason: string): void {
    if (this.#state !== "connected") return;
    this.#setState("quarantined");
    this.trace.record("connection.quarantined", {
      reason,
      connectionId: this.#connectionId,
    });
  }

  async read(endpoint: GattEndpoint): Promise<Uint8Array> {
    const characteristic = await this.#resolve(endpoint);
    if (!characteristic.properties.read)
      throw new Error("Characteristic does not support reads.");
    const value = await characteristic.readValue();
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
    this.trace.record(
      "gatt.read",
      {
        serviceUuid: endpoint.serviceUuid,
        characteristicUuid: endpoint.characteristicUuid,
        byteLength: bytes.length,
      },
      bytes,
    );
    return bytes;
  }

  async subscribe(
    endpoint: GattEndpoint,
    listener: (bytes: Uint8Array) => void,
  ): Promise<() => Promise<void>> {
    const characteristic = await this.#resolve(endpoint);
    if (
      !characteristic.properties.notify &&
      !characteristic.properties.indicate
    )
      throw new Error("Characteristic does not support notifications.");
    const onValue = (event: Event): void => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      const bytes = value
        ? new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          ).slice()
        : new Uint8Array();
      listener(bytes);
    };
    characteristic.addEventListener("characteristicvaluechanged", onValue);
    const removeListener = (): void => {
      characteristic.removeEventListener("characteristicvaluechanged", onValue);
    };
    this.#notificationCleanups.add(removeListener);
    await characteristic.startNotifications();
    this.trace.record("gatt.notifications.enabled", {
      serviceUuid: endpoint.serviceUuid,
      characteristicUuid: endpoint.characteristicUuid,
    });
    return async () => {
      removeListener();
      this.#notificationCleanups.delete(removeListener);
      if (characteristic.service.device.gatt?.connected)
        await characteristic.stopNotifications();
    };
  }

  async write(
    endpoint: GattEndpoint,
    bytes: Uint8Array,
    mode: WriteMode,
  ): Promise<TransportReceipt> {
    if (this.#state !== "connected")
      throw new Error("Cannot write while disconnected.");
    let resolveQueue: (() => void) | undefined;
    const previous = this.#writeQueue;
    this.#writeQueue = new Promise<void>((resolve) => {
      resolveQueue = resolve;
    });
    await previous;
    try {
      const characteristic = await this.#resolve(endpoint);
      const writable = Uint8Array.from(bytes);
      if (mode === "without-response") {
        if (!characteristic.properties.writeWithoutResponse)
          throw new Error(
            "Characteristic does not support write without response.",
          );
        await characteristic.writeValueWithoutResponse(writable);
      } else {
        if (!characteristic.properties.write)
          throw new Error(
            "Characteristic does not support write with response.",
          );
        await characteristic.writeValueWithResponse(writable);
      }
      return {
        acceptedAt: new Date().toISOString(),
        endpoint,
        writeMode: mode,
        byteLength: bytes.length,
      };
    } finally {
      resolveQueue?.();
    }
  }

  async #enumerateServices(
    server: BluetoothRemoteGATTServer,
  ): Promise<readonly GattServiceFingerprint[]> {
    const services = await server.getPrimaryServices();
    const result: GattServiceFingerprint[] = [];
    for (const service of services) {
      this.trace.record("gatt.service.resolved", { serviceUuid: service.uuid });
      const characteristics = await service.getCharacteristics();
      const fingerprints = characteristics.map((characteristic) => {
        this.#characteristics.set(
          endpointKey({
            serviceUuid: service.uuid,
            characteristicUuid: characteristic.uuid,
          }),
          characteristic,
        );
        this.trace.record("gatt.characteristic.resolved", {
          serviceUuid: service.uuid,
          characteristicUuid: characteristic.uuid,
        });
        return {
          uuid: characteristic.uuid,
          properties: propertiesOf(characteristic.properties),
        };
      });
      result.push({
        uuid: service.uuid,
        isPrimary: service.isPrimary,
        characteristics: fingerprints,
      });
    }
    return result;
  }

  async #resolve(
    endpoint: GattEndpoint,
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    if (this.#state !== "connected" || !this.#server?.connected)
      throw new Error("Transport is disconnected.");
    const key = endpointKey(endpoint);
    const cached = this.#characteristics.get(key);
    if (cached) return cached;
    const service = await this.#server.getPrimaryService(endpoint.serviceUuid);
    const characteristic = await service.getCharacteristic(
      endpoint.characteristicUuid,
    );
    this.#characteristics.set(key, characteristic);
    return characteristic;
  }

  async #cleanup(explicit: boolean): Promise<void> {
    for (const cleanup of this.#notificationCleanups) cleanup();
    this.#notificationCleanups.clear();
    this.#characteristics.clear();
    this.#server = null;
    this.#connectionId = null;
    this.#fingerprint = null;
    if (this.#device) {
      this.#device.removeEventListener(
        "gattserverdisconnected",
        this.#onDisconnected,
      );
      this.#device.gatt?.disconnect();
    }
    this.#device = null;
    if (explicit) this.trace.record("disconnect", { explicit: true });
  }

  readonly #onDisconnected = (): void => {
    for (const cleanup of this.#notificationCleanups) cleanup();
    this.#notificationCleanups.clear();
    this.#characteristics.clear();
    this.#server = null;
    this.#connectionId = null;
    this.#fingerprint = null;
    if (this.#device)
      this.#device.removeEventListener(
        "gattserverdisconnected",
        this.#onDisconnected,
      );
    this.#device = null;
    this.#setState("idle");
    this.trace.record("disconnect", { explicit: false });
  };

  #setState(state: ConnectionState): void {
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }
}

function endpointKey(endpoint: GattEndpoint): string {
  return `${normalizeUuid(endpoint.serviceUuid)}/${normalizeUuid(endpoint.characteristicUuid)}`;
}

interface BluetoothAdvertisingEvent {
  readonly device: BluetoothDevice;
  readonly uuids: readonly string[];
  readonly name?: string;
  readonly rssi?: number;
  readonly txPower?: number;
  readonly manufacturerData: ReadonlyMap<number, DataView>;
  readonly serviceData: ReadonlyMap<string, DataView>;
}

function structureAdvertisementEvent(
  event: Event & Partial<BluetoothAdvertisingEvent>,
): import("../core/device").AdvertisementObservation {
  const manufacturerData: { companyId: number; dataHex: string }[] = [];
  if (event.manufacturerData)
    for (const [companyId, view] of event.manufacturerData)
      manufacturerData.push({ companyId, dataHex: viewHex(view) });
  const serviceData: { uuid: string; dataHex: string }[] = [];
  if (event.serviceData)
    for (const [uuid, view] of event.serviceData)
      serviceData.push({ uuid, dataHex: viewHex(view) });
  return {
    capturedAt: new Date().toISOString(),
    source: "web-bluetooth-watch",
    ...(event.name ? { name: event.name } : {}),
    ...(typeof event.rssi === "number" ? { rssi: event.rssi } : {}),
    ...(typeof event.txPower === "number" ? { txPower: event.txPower } : {}),
    advertisedServiceUuids: [...(event.uuids ?? [])].map(String),
    manufacturerData,
    serviceData,
  };
}

function viewHex(view: DataView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function propertiesOf(
  properties: BluetoothCharacteristicProperties,
): CharacteristicProperties {
  return {
    read: properties.read,
    notify: properties.notify,
    indicate: properties.indicate,
    write: properties.write,
    writeWithoutResponse: properties.writeWithoutResponse,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
