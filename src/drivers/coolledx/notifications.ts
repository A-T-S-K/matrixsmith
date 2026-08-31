import type { DecodedNotification } from "../types";
import { packetHex } from "../../core/transmission";
import { decodeEnvelope } from "../coolled/common/envelope";

const ERROR_NAMES: Readonly<Record<number, string>> = {
  0x00: "success",
  0x01: "transmission failed",
  0x02: "device abnormality",
  0x03: "data error",
  0x04: "data length error",
  0x05: "data id error",
  0x06: "data checksum error",
};

export function decodeCoolLedNotification(packet: Uint8Array): DecodedNotification | null {
  let payload: Uint8Array;
  try { payload = decodeEnvelope(packet).payload; } catch (error) {
    return { family: "CoolLEDX", kind: "malformed-envelope", summary: "Malformed CoolLED envelope", payloadHex: "", fields: {}, envelopeError: error instanceof Error ? error.message : String(error) };
  }
  const opcode = payload[0];
  const code = payload[1];
  if (opcode === undefined) return null;
  if (opcode === 0x08 && code === 0xfe) return {
    family: "CoolLEDX", kind: "command-response", opcode, code, status: code, success: false,
    summary: "Classic brightness response value 0xFE; rejection/error-like, exact semantics unmapped.",
    payloadHex: packetHex(payload), fields: { value: code, semanticsMapped: false },
  };
  if (code === undefined || !(code in ERROR_NAMES)) return { family: "CoolLEDX", kind: "command-response", opcode, summary: `Unmapped response for opcode 0x${opcode.toString(16).padStart(2, "0")}.`, payloadHex: packetHex(payload), fields: {}, ...(payload.length > 1 ? { unknownTailHex: packetHex(payload.slice(1)) } : {}) };
  return {
    family: "CoolLEDX",
    kind: "transfer-ack",
    opcode,
    code,
    success: code === 0,
    summary: ERROR_NAMES[code] ?? `unknown status 0x${code.toString(16).padStart(2, "0")}`,
    payloadHex: packetHex(payload),
    fields: { status: code },
  };
}
