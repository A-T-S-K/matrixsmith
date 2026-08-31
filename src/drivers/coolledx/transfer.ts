import { frameCoolLedPayload } from "./protocol";

export const COOLLEDX_CHUNK_SIZE = 128;

export function xorChecksum(bytes: Uint8Array): number {
  let checksum = 0;
  for (const byte of bytes) checksum ^= byte;
  return checksum;
}

export function encodeTransferPackets(opcode: number, payload: Uint8Array): readonly Uint8Array[] {
  if (payload.length > 0xffff) throw new RangeError("CoolLEDX transfer payload exceeds the 16-bit protocol length.");
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 0xff) throw new RangeError("Opcode must be an unsigned byte.");
  const chunkCount = Math.max(1, Math.ceil(payload.length / COOLLEDX_CHUNK_SIZE));
  const packets: Uint8Array[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = payload.slice(index * COOLLEDX_CHUNK_SIZE, (index + 1) * COOLLEDX_CHUNK_SIZE);
    const record = new Uint8Array(7 + chunk.length);
    record[0] = 0;
    record[1] = payload.length >>> 8;
    record[2] = payload.length & 0xff;
    record[3] = index >>> 8;
    record[4] = index & 0xff;
    record[5] = chunk.length;
    record.set(chunk, 6);
    record[record.length - 1] = xorChecksum(record.slice(0, -1));
    const command = new Uint8Array(record.length + 1);
    command[0] = opcode;
    command.set(record, 1);
    packets.push(frameCoolLedPayload(command));
  }
  return packets;
}

export function createImageTransferPayload(pixels: Uint8Array): Uint8Array {
  if (pixels.length > 0xffff) throw new RangeError("Image pixel payload exceeds the 16-bit length field.");
  const payload = new Uint8Array(26 + pixels.length);
  payload[24] = pixels.length >>> 8;
  payload[25] = pixels.length & 0xff;
  payload.set(pixels, 26);
  return payload;
}

export function createAnimationTransferPayload(frames: Uint8Array, frameCount: number, speedMs: number): Uint8Array {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 0xff) throw new RangeError("Frame count must fit one byte.");
  if (!Number.isInteger(speedMs) || speedMs < 0 || speedMs > 0xffff) throw new RangeError("Animation speed must fit two bytes.");
  const payload = new Uint8Array(27 + frames.length);
  payload[24] = frameCount;
  payload[25] = speedMs >>> 8;
  payload[26] = speedMs & 0xff;
  payload.set(frames, 27);
  return payload;
}
