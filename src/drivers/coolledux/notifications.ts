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
  const value = payload[1];
  return {
    family: "CoolLEDUX", kind: "command-response", opcode,
    summary: value === undefined ? `Response for opcode 0x${opcode.toString(16).padStart(2, "0")}.` : `Response for opcode 0x${opcode.toString(16).padStart(2, "0")} with value 0x${value.toString(16).padStart(2, "0")}.`,
    payloadHex, fields: { ...(value === undefined ? {} : { value }) }, ...(value === undefined ? {} : { status: value }),
    ...(payload.length > 2 ? { unknownTailHex: packetHex(payload.slice(2)) } : {}),
  };
}
