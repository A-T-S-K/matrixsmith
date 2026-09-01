import { packetHex } from "../../core/transmission";
import type { DecodedNotification } from "../types";
import { decodeEnvelope } from "../coolled/common/envelope";
import { COOLLEDUX_OPCODES } from "./protocol";

export function decodeCoolLedUxNotification(packet: Uint8Array): DecodedNotification | null {
  let payload: Uint8Array;
  try { payload = decodeEnvelope(packet).payload; } catch (error) {
    return {
      family: "CoolLEDUX", kind: "malformed-envelope", summary: "Malformed CoolLED envelope",
      payloadHex: "", fields: {}, envelopeError: error instanceof Error ? error.message : String(error),
    };
  }
  const opcode = payload[0];
  if (opcode === undefined) return null;
  const payloadHex = packetHex(payload);
  if (opcode === COOLLEDUX_OPCODES.brightness && payload.length >= 2) {
    const level = payload[1] ?? 0;
    return { family: "CoolLEDUX", kind: "command-echo", opcode, summary: `Brightness command echoed at raw level ${level}.`, payloadHex, success: true, fields: { brightnessRaw: level }, ...(payload.length > 2 ? { unknownTailHex: packetHex(payload.slice(2)) } : {}) };
  }
  if (opcode === COOLLEDUX_OPCODES.deviceInfo) {
    if (payload.length < 3) return { family: "CoolLEDUX", kind: "malformed-device-info", opcode, summary: "Device-info response lacks the confirmed three-byte prefix.", payloadHex, fields: {}, unknownTailHex: packetHex(payload.slice(1)) };
    const powerRaw = payload[1] ?? 0;
    const brightnessRaw = payload[2] ?? 0;
    return {
      family: "CoolLEDUX", kind: "device-info", opcode,
      summary: `Device info: power raw ${powerRaw}, brightness raw ${brightnessRaw}.`, payloadHex, success: true,
      fields: { payloadLength: payload.length, powerRaw, powerOn: powerRaw === 1 ? true : null, brightnessRaw },
      unknownTailHex: packetHex(payload.slice(3)),
    };
  }
  // Stored-program upload receipts. Upstream (coolledux-ble@4f5656d)
  // documents that notify traffic during uploads is NOT a reliable per-chunk
  // acknowledgement and defines no payload semantics for it, so decoding here
  // is structural: raw bytes are named by position, never as success/failure.
  if (opcode === 0x02 && payload.length === 2) {
    const statusRaw = payload[1] ?? 0;
    return {
      family: "CoolLEDUX", kind: "program-announce-receipt", opcode,
      summary: `Stored-program announce receipt (status raw 0x${statusRaw.toString(16).padStart(2, "0")}; semantics unmapped).`,
      payloadHex, status: statusRaw, fields: { statusRaw },
    };
  }
  if (opcode === 0x03 && payload.length === 5) {
    const reservedRaw = payload[1] ?? 0;
    const chunkIndex = ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);
    const statusRaw = payload[4] ?? 0;
    return {
      family: "CoolLEDUX", kind: "program-chunk-receipt", opcode,
      summary: `Stored-program chunk receipt for index ${chunkIndex} (status raw 0x${statusRaw.toString(16).padStart(2, "0")}; not a reliable per-chunk acknowledgement).`,
      payloadHex, status: statusRaw, fields: { reservedRaw, chunkIndex, statusRaw },
    };
  }
  const value = payload[1];
  return {
    family: "CoolLEDUX", kind: "command-response", opcode,
    summary: value === undefined ? `Response for opcode 0x${opcode.toString(16).padStart(2, "0")}.` : `Response for opcode 0x${opcode.toString(16).padStart(2, "0")} with value 0x${value.toString(16).padStart(2, "0")}.`,
    payloadHex, fields: { ...(value === undefined ? {} : { value }) }, ...(value === undefined ? {} : { status: value }),
    ...(payload.length > 2 ? { unknownTailHex: packetHex(payload.slice(2)) } : {}),
  };
}
