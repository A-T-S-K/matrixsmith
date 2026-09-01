import type { DeviceFingerprint, GattEndpoint } from "../core/device";
import type { WriteMode } from "../core/transmission";
import type { ConnectionState, DeviceSelectionOptions, MatrixTransport, TransportReceipt } from "../transport/types";
import { ILEDHAT_ADVERTISEMENT_HEX } from "../profiles/iledhat-31ae-32x16";
import { parseHexBytes } from "../discovery/advertisement";

/**
 * DEV-ONLY simulated iLedHat. Loaded exclusively from a dynamic import behind
 * `import.meta.env.DEV`, so production bundles never contain it. It exists so
 * the real guided workflows — including transfers and physical-timing stages —
 * can be exercised and visually reviewed in a browser without hardware.
 *
 * It emulates only what was actually captured from the physical unit: 0x1F
 * answers with the recorded structured device-info frame, and 0x04 echoes.
 * Nothing here is evidence; sessions driven by it are clearly simulated.
 */

const OPCODE_INDEX = 4;
const VALUE_INDEX = 5;
const DEVICE_INFO_CC = "0100301F0205CC00000000020509020504020700000500001E001000AE310020001007694C65644861740000000000000000000000000003";
const DEVICE_INFO_40 = "0100301F02054000000000020509020504020700000500001E001000AE310020001007694C65644861740000000000000000000000000003";

export class SimulatedIledHatTransport implements MatrixTransport {
  readonly kind = "web-bluetooth" as const;
  state: ConnectionState = "idle";
  fingerprint: DeviceFingerprint | null = null;
  brightness = 0xcc;
  /** Milliseconds of simulated per-packet latency, so transfers feel real. */
  writeDelayMs = 4;
  /**
   * Which simulated physical unit this is. Two units share the profile, the
   * name and the GATT shape and differ only in the browser authorization id —
   * exactly the case where orchestration must not leak between displays.
   */
  readonly unit: string;
  /**
   * Fail the next write, once. The transfer-failure path is otherwise
   * unreachable by hand, and it is the one that used to strand an attempt
   * in progress forever.
   */
  failNextWrite = false;
  readonly #listeners = new Set<(bytes: Uint8Array) => void>();

  /**
   * Present as a display MatrixSmith knows nothing about: the same FFF0/FFF1
   * transport, a different name, no manufacturer data. The conservative
   * unknown-device path is otherwise unreachable by hand from the simulator.
   */
  readonly unknown: boolean;

  constructor(unit = "simulated-iledhat", unknown = false) { this.unit = unit; this.unknown = unknown; }

  async selectAndConnect(_options: DeviceSelectionOptions): Promise<DeviceFingerprint> {
    this.state = "connected";
    this.fingerprint = simulatedFingerprint(this.unit, this.unknown);
    return this.fingerprint;
  }

  async reconnectAuthorized(_deviceId: string, options: DeviceSelectionOptions): Promise<DeviceFingerprint> {
    return this.selectAndConnect(options);
  }

  async listAuthorizedDevices(): Promise<readonly { id: string; name: string }[]> {
    return [{ id: this.unit, name: `iLedHat (simulated ${this.unit})` }];
  }

  async disconnect(): Promise<void> { this.state = "idle"; this.fingerprint = null; }

  async read(_endpoint: GattEndpoint): Promise<Uint8Array> { return new Uint8Array(); }

  async subscribe(_endpoint: GattEndpoint, listener: (bytes: Uint8Array) => void): Promise<() => Promise<void>> {
    this.#listeners.add(listener);
    return async () => { this.#listeners.delete(listener); };
  }

  async write(_endpoint: GattEndpoint, bytes: Uint8Array, mode: WriteMode): Promise<TransportReceipt> {
    if (this.state !== "connected") throw new Error("Transport is disconnected.");
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("Simulated write failure."); }
    const reply = this.#respond(bytes);
    if (reply) for (const listener of this.#listeners) listener(reply);
    if (this.writeDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.writeDelayMs));
    return { acceptedAt: new Date().toISOString(), endpoint: _endpoint, writeMode: mode, byteLength: bytes.length };
  }

  #respond(bytes: Uint8Array): Uint8Array | null {
    const opcode = bytes[OPCODE_INDEX];
    if (opcode === 0x1f) return parseHexBytes(this.brightness === 0xcc ? DEVICE_INFO_CC : DEVICE_INFO_40);
    if (opcode === 0x04) { this.brightness = bytes[VALUE_INDEX] ?? this.brightness; return bytes.slice(); }
    return null;
  }
}

function simulatedFingerprint(unit: string, unknown = false): DeviceFingerprint {
  return {
    schemaVersion: 1,
    transportKind: "web-bluetooth",
    browserDeviceId: unit,
    name: unknown ? "Generic LED Panel" : "iLedHat",
    advertisedServices: ["0000fff0-0000-1000-8000-00805f9b34fb"],
    ...(unknown ? {} : { rawAdvertisementHex: ILEDHAT_ADVERTISEMENT_HEX, manufacturerDataHex: "AE315EEA07000001100020031E" }),
    services: [{
      uuid: "0000fff0-0000-1000-8000-00805f9b34fb",
      isPrimary: true,
      characteristics: [{
        uuid: "0000fff1-0000-1000-8000-00805f9b34fb",
        properties: { read: true, notify: true, indicate: false, write: false, writeWithoutResponse: true },
      }],
    }],
    ...(unknown ? {} : { manuallyConfirmedGeometry: { width: 32, height: 16 } }),
    evidenceRefs: ["iledhat-advertisement", "iledhat-gatt", "manual-geometry"],
    notes: [`Simulated device ${unit} for local UX review — not evidence.`],
  };
}
