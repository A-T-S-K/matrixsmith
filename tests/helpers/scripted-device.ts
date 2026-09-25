import { FakeTransport } from "../../src/transport/fake";
import { parseHexBytes } from "../../src/discovery/advertisement";
import type { GattEndpoint } from "../../src/core/device";
import type { WriteMode } from "../../src/core/transmission";
import type { TransportReceipt } from "../../src/application/ports/transport";
import infoCc from "../fixtures/iledhat/coolledux-device-info-cc.json";
import info40 from "../fixtures/iledhat/coolledux-device-info-40.json";

const OPCODE_INDEX = 4;
const VALUE_INDEX = 5;

/**
 * Emulates the physical iLedHat CoolLEDUX behaviour recorded in fixtures:
 * 0x1F queries answer with the captured structured device-info frame for the
 * current brightness state, and 0x04 brightness commands echo their own bytes.
 * Only the two captured brightness states (0xCC and 0x40) are representable.
 */
export class ScriptedCoolLedUxDevice extends FakeTransport {
  brightness = 0xcc;
  /** Echo brightness commands without changing device state. */
  ignoreBrightnessState = false;
  /** Apply only the first brightness write; later writes echo but stick. */
  stickAfterFirstBrightnessWrite = false;
  /** Answer nothing at all (forces response timeouts). */
  silent = false;
  /** Answer every query with these raw bytes instead of the scripted reply. */
  unrelatedResponse: Uint8Array | null = null;
  #brightnessWrites = 0;

  override async write(
    endpoint: GattEndpoint,
    bytes: Uint8Array,
    mode: WriteMode,
  ): Promise<TransportReceipt> {
    this.notificationOnWrite = this.#respond(bytes);
    return super.write(endpoint, bytes, mode);
  }

  #respond(bytes: Uint8Array): Uint8Array | null {
    if (this.silent) return null;
    if (this.unrelatedResponse) return this.unrelatedResponse.slice();
    const opcode = bytes[OPCODE_INDEX];
    if (opcode === 0x1f)
      return parseHexBytes(
        this.brightness === 0xcc ? infoCc.rxHex : info40.rxHex,
      );
    if (opcode === 0x04) {
      this.#brightnessWrites += 1;
      const apply =
        !this.ignoreBrightnessState &&
        !(this.stickAfterFirstBrightnessWrite && this.#brightnessWrites > 1);
      if (apply) this.brightness = bytes[VALUE_INDEX] ?? this.brightness;
      return bytes.slice();
    }
    return null;
  }
}
