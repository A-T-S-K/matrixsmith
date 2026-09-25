export interface DecodedEnvelope {
  readonly raw: Uint8Array;
  readonly payload: Uint8Array;
  readonly declaredLength: number;
}

export function escapeBytes(bytes: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (const byte of bytes) {
    if (byte >= 0x01 && byte <= 0x03) output.push(0x02, byte ^ 0x04);
    else output.push(byte);
  }
  return Uint8Array.from(output);
}

export function unescapeBytes(bytes: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 0x02) {
      output.push(byte ?? 0);
      continue;
    }
    const escaped = bytes[index + 1];
    if (escaped === undefined)
      throw new Error("CoolLED envelope contains a truncated escape sequence.");
    if (escaped < 0x05 || escaped > 0x07)
      throw new Error(
        `CoolLED envelope contains invalid escape byte 0x${escaped.toString(16).padStart(2, "0")}.`,
      );
    output.push(escaped ^ 0x04);
    index += 1;
  }
  return Uint8Array.from(output);
}

export function encodeEnvelope(payload: Uint8Array): Uint8Array {
  if (payload.length > 0xffff)
    throw new RangeError("CoolLED payload exceeds the 16-bit envelope length.");
  const body = new Uint8Array(payload.length + 2);
  body[0] = payload.length >>> 8;
  body[1] = payload.length & 0xff;
  body.set(payload, 2);
  const escaped = escapeBytes(body);
  const packet = new Uint8Array(escaped.length + 2);
  packet[0] = 0x01;
  packet.set(escaped, 1);
  packet[packet.length - 1] = 0x03;
  return packet;
}

export function decodeEnvelope(packet: Uint8Array): DecodedEnvelope {
  const raw = packet.slice();
  if (raw.length < 4 || raw[0] !== 0x01)
    throw new Error("CoolLED envelope has an invalid start byte.");
  if (raw[raw.length - 1] !== 0x03)
    throw new Error("CoolLED envelope has an invalid end byte.");
  const body = unescapeBytes(raw.slice(1, -1));
  if (body.length < 2)
    throw new Error("CoolLED envelope is missing its length field.");
  const declaredLength = ((body[0] ?? 0) << 8) | (body[1] ?? 0);
  const actualLength = body.length - 2;
  if (actualLength !== declaredLength)
    throw new Error(
      `CoolLED envelope length mismatch: declared ${declaredLength}, decoded ${actualLength}.`,
    );
  return { raw, payload: body.slice(2), declaredLength };
}
