export const COOLLEDX_OPCODES = {
  text: 0x02,
  image: 0x03,
  animation: 0x04,
  mode: 0x06,
  speed: 0x07,
  brightness: 0x08,
  switch: 0x09,
} as const;

export function escapeCoolLedBytes(bytes: Uint8Array): Uint8Array {
  return escapeBytes(bytes);
}

export function frameCoolLedPayload(payload: Uint8Array): Uint8Array {
  return encodeEnvelope(payload);
}

export function encodeControl(opcode: number, ...args: number[]): Uint8Array {
  assertByte(opcode, "opcode");
  args.forEach((value, index) => assertByte(value, `argument ${index}`));
  return frameCoolLedPayload(Uint8Array.of(opcode, ...args));
}

export const encodeBrightness = (raw: number): Uint8Array => encodeControl(COOLLEDX_OPCODES.brightness, raw);
export const encodeSpeed = (raw: number): Uint8Array => encodeControl(COOLLEDX_OPCODES.speed, raw);
export const encodeMode = (raw: number): Uint8Array => encodeControl(COOLLEDX_OPCODES.mode, raw);
export const encodeSwitch = (on: boolean): Uint8Array => encodeControl(COOLLEDX_OPCODES.switch, on ? 0x01 : 0x00);

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${label} must be an unsigned byte.`);
}
import { encodeEnvelope, escapeBytes } from "../coolled/common/envelope";
