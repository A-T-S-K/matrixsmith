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
  const output: number[] = [];
  for (const byte of bytes) {
    if (byte >= 0x01 && byte <= 0x03) output.push(0x02, byte ^ 0x04);
    else output.push(byte);
  }
  return Uint8Array.from(output);
}

export function frameCoolLedPayload(payload: Uint8Array): Uint8Array {
  if (payload.length > 0xffff) throw new RangeError("CoolLEDX framed payload exceeds the 16-bit protocol length.");
  const unescaped = new Uint8Array(payload.length + 2);
  unescaped[0] = payload.length >>> 8;
  unescaped[1] = payload.length & 0xff;
  unescaped.set(payload, 2);
  const escaped = escapeCoolLedBytes(unescaped);
  const framed = new Uint8Array(escaped.length + 2);
  framed[0] = 0x01;
  framed.set(escaped, 1);
  framed[framed.length - 1] = 0x03;
  return framed;
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
