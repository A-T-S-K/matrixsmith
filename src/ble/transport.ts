import { IO_CHARACTERISTIC_UUID, SERVICE_UUID } from "./uuids";
import type { DiagnosticState } from "./device";
import { initialDiagnosticState } from "./device";
import { BleLogger, toHex } from "./logger";

export type StateListener = (state: Readonly<DiagnosticState>) => void;

/**
 * Phase-2 transport: discovery, connection, characteristic read, and notifications only.
 * It intentionally exposes no write method while the FFF1 protocol is unknown.
 */
export class SafeBleTransport {
  readonly logger: BleLogger;
  readonly #stateListeners = new Set<StateListener>();
  #state = initialDiagnosticState();
  #device: BluetoothDevice | null = null;
  #characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  constructor(logger = new BleLogger()) {
    this.logger = logger;
  }

  get state(): Readonly<DiagnosticState> {
    return this.#state;
  }

  subscribe(listener: StateListener): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (!("bluetooth" in navigator)) {
      throw this.#recordError(new Error("Web Bluetooth is unavailable in this browser."));
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });
      this.#device = device;
      device.addEventListener("gattserverdisconnected", this.#onDisconnected);
      this.#patch({ deviceSelected: true, deviceName: device.name ?? "Unnamed device" });
      this.logger.add("CONNECT", `selected ${device.name ?? "unnamed device"}`);

      const server = await device.gatt?.connect();
      if (!server) throw new Error("The selected device has no GATT server.");
      this.#patch({ gattConnected: server.connected });

      const service = await server.getPrimaryService(SERVICE_UUID);
      this.#patch({ serviceFound: true });
      this.logger.add("SERVICE_DISCOVERED", SERVICE_UUID);

      const characteristic = await service.getCharacteristic(IO_CHARACTERISTIC_UUID);
      this.#characteristic = characteristic;
      const properties = characteristic.properties;
      this.#patch({
        characteristicFound: true,
        readSupported: properties.read,
        notifySupported: properties.notify,
        writeWithoutResponseSupported: properties.writeWithoutResponse,
      });
      this.logger.add("CHARACTERISTIC_DISCOVERED", IO_CHARACTERISTIC_UUID);

      characteristic.addEventListener("characteristicvaluechanged", this.#onNotification);
      await characteristic.startNotifications();
      this.#patch({ notificationsEnabled: true });
      this.logger.add("NOTIFICATIONS_ENABLED");
    } catch (error) {
      this.#recordError(error);
      await this.disconnect();
      throw error;
    }
  }

  async read(): Promise<Uint8Array> {
    if (!this.#characteristic) throw this.#recordError(new Error("FFF1 is not connected."));
    if (!this.#characteristic.properties.read) {
      throw this.#recordError(new Error("FFF1 does not report READ support."));
    }
    try {
      const value = await this.#characteristic.readValue();
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      this.logger.add("RX", bytes.length === 0 ? "<empty read>" : toHex(bytes));
      return bytes.slice();
    } catch (error) {
      throw this.#recordError(error);
    }
  }

  async disconnect(): Promise<void> {
    const characteristic = this.#characteristic;
    this.#characteristic = null;
    if (characteristic) {
      characteristic.removeEventListener("characteristicvaluechanged", this.#onNotification);
      if (characteristic.service.device.gatt?.connected && this.#state.notificationsEnabled) {
        try {
          await characteristic.stopNotifications();
        } catch (error) {
          this.#recordError(error);
        }
      }
    }
    if (this.#device) {
      this.#device.removeEventListener("gattserverdisconnected", this.#onDisconnected);
      this.#device.gatt?.disconnect();
    }
    this.#patchDisconnected();
  }

  blockUnknownWrite(reason = "protocol unknown; raw writes are disabled"): never {
    this.logger.blockedTx(reason);
    throw new Error(reason);
  }

  readonly #onNotification = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    this.logger.add("RX", value ? toHex(value) : "<empty notification>");
  };

  readonly #onDisconnected = (): void => {
    this.#characteristic = null;
    this.#patchDisconnected();
  };

  #patchDisconnected(): void {
    const wasConnected = this.#state.gattConnected;
    this.#patch({
      gattConnected: false,
      serviceFound: false,
      characteristicFound: false,
      readSupported: false,
      notifySupported: false,
      writeWithoutResponseSupported: false,
      notificationsEnabled: false,
    });
    if (wasConnected) this.logger.add("DISCONNECT");
  }

  #patch(patch: Partial<DiagnosticState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#stateListeners) listener(this.#state);
  }

  #recordError(error: unknown): Error {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.logger.add("ERROR", `${normalized.name}: ${normalized.message}`);
    return normalized;
  }
}
