import { encodeEnvelope } from "../coolled/common/envelope";

export const COOLLEDUX_OPCODES = {
  brightness: 0x04,
  power: 0x05,
  mirror: 0x0c,
  deviceInfo: 0x1f,
} as const;

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff)
    throw new RangeError(`${label} must be an unsigned byte.`);
}

export function encodeCoolLedUxCommand(
  opcode: number,
  ...args: number[]
): Uint8Array {
  assertByte(opcode, "opcode");
  args.forEach((value, index) => assertByte(value, `argument ${index}`));
  return encodeEnvelope(Uint8Array.of(opcode, ...args));
}

export const encodeBrightness = (raw: number): Uint8Array =>
  encodeCoolLedUxCommand(COOLLEDUX_OPCODES.brightness, raw);
export const encodePower = (on: boolean): Uint8Array =>
  encodeCoolLedUxCommand(COOLLEDUX_OPCODES.power, on ? 1 : 0);
export const encodeMirror = (on: boolean): Uint8Array =>
  encodeCoolLedUxCommand(COOLLEDUX_OPCODES.mirror, on ? 1 : 0);
export const encodeDeviceInfoQuery = (): Uint8Array =>
  encodeCoolLedUxCommand(COOLLEDUX_OPCODES.deviceInfo);
