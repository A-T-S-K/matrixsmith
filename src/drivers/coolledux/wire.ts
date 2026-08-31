import { encodeEnvelope } from "../coolled/common/envelope";

/**
 * CoolLEDUX stored-program wire primitives: the custom CRC-32 variant, the
 * Okumura-style LZSS compressor (regular and safe/literal-only), and the
 * announce/data chunk packet builders.
 *
 * Implemented independently in TypeScript from the protocol facts documented
 * by the pinned CharlesLennon/coolledux-ble@4f5656d (MIT) reference; the
 * pinned implementation supplies golden conformance vectors (see
 * tests/fixtures/coolledux/conformance.json).
 */

export const CRC32_POLY = 0x04c11db7;
export const UX_PACKAGE_SIZE = 128;
/** Pacing between stored-program packet writes; the executor owns timing. */
export const UX_CHUNK_DELAY_MS = 60;

/** Custom CRC-32: poly 0x04C11DB7, init 0xFFFFFFFF, MSB-first, NO final complement. */
export function crc32Custom(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    for (let shift = 0; shift < 8; shift += 1) {
      const bit = (byte >>> (7 - shift)) & 1;
      const top = (crc >>> 31) & 1;
      crc = (crc << 1) >>> 0;
      if (top) crc = (crc ^ CRC32_POLY) >>> 0;
      if (bit) crc = (crc ^ CRC32_POLY) >>> 0;
    }
  }
  return crc >>> 0;
}

const N = 512;
const F = 18;
const THRESHOLD = 2;
const NIL = N;

/**
 * Classic Okumura LZSS with CoolLEDUX parameters (N=512, F=18, THRESHOLD=2).
 * The output need not bit-match the vendor app's encoder; any valid stream
 * with these parameters decodes deterministically on the firmware.
 */
export function lzssCompress(data: Uint8Array): Uint8Array {
  const length = data.length;
  if (length === 0) return new Uint8Array(0);
  const textBuf = new Uint8Array(N + F - 1);
  const lson = new Int32Array(N + 1);
  const rson = new Int32Array(N + 257);
  const dad = new Int32Array(N + 1);
  for (let i = N + 1; i < N + 257; i += 1) rson[i] = NIL;
  for (let i = 0; i < N; i += 1) dad[i] = NIL;

  let matchPosition = 0;
  let matchLength = 0;

  const insertNode = (r: number): void => {
    let cmp = 1;
    let p = N + 1 + (textBuf[r] ?? 0);
    lson[r] = NIL;
    rson[r] = NIL;
    matchLength = 0;
    for (;;) {
      if (cmp >= 0) {
        if (rson[p] === NIL) { rson[p] = r; dad[r] = p; return; }
        p = rson[p]!;
      } else {
        if (lson[p] === NIL) { lson[p] = r; dad[r] = p; return; }
        p = lson[p]!;
      }
      let i = 1;
      let broke = false;
      while (i < F) {
        cmp = (textBuf[r + i] ?? 0) - (textBuf[p + i] ?? 0);
        if (cmp !== 0) { broke = true; break; }
        i += 1;
      }
      if (!broke) cmp = 0;
      if (i > matchLength) {
        matchPosition = p;
        matchLength = i;
        if (matchLength >= F) break;
      }
    }
    dad[r] = dad[p]!;
    lson[r] = lson[p]!;
    rson[r] = rson[p]!;
    dad[lson[p]!] = r;
    dad[rson[p]!] = r;
    if (rson[dad[p]!] === p) rson[dad[p]!] = r;
    else lson[dad[p]!] = r;
    dad[p] = NIL;
  };

  const deleteNode = (p: number): void => {
    if (dad[p] === NIL) return;
    let q: number;
    if (rson[p] === NIL) q = lson[p]!;
    else if (lson[p] === NIL) q = rson[p]!;
    else {
      q = lson[p]!;
      if (rson[q] !== NIL) {
        while (rson[q] !== NIL) q = rson[q]!;
        rson[dad[q]!] = lson[q]!;
        dad[lson[q]!] = dad[q]!;
        lson[q] = lson[p]!;
        dad[lson[p]!] = q;
      }
      rson[q] = rson[p]!;
      dad[rson[p]!] = q;
    }
    dad[q] = dad[p]!;
    if (rson[dad[p]!] === p) rson[dad[p]!] = q;
    else lson[dad[p]!] = q;
    dad[p] = NIL;
  };

  const out: number[] = [];
  const codeBuf = new Uint8Array(17);
  codeBuf[0] = 0;
  let codeBufPtr = 1;
  let mask = 1;
  let s = 0;
  let r = N - F;
  let srcPos = 0;
  let i = 0;
  while (i < F && srcPos < length) {
    textBuf[r + i] = data[srcPos] ?? 0;
    i += 1;
    srcPos += 1;
  }
  let textLen = i;
  if (textLen === 0) return new Uint8Array(0);
  for (let j = 1; j <= F; j += 1) insertNode(r - j);
  insertNode(r);

  for (;;) {
    if (matchLength > textLen) matchLength = textLen;
    if (matchLength <= THRESHOLD) {
      matchLength = 1;
      codeBuf[0] = (codeBuf[0]! | mask) & 0xff;
      codeBuf[codeBufPtr] = textBuf[r] ?? 0;
      codeBufPtr += 1;
    } else {
      codeBuf[codeBufPtr] = matchPosition & 0xff;
      codeBufPtr += 1;
      codeBuf[codeBufPtr] = (((matchPosition >>> 4) & 0xf0) | (matchLength - (THRESHOLD + 1))) & 0xff;
      codeBufPtr += 1;
    }
    mask = (mask << 1) & 0xff;
    if (mask === 0) {
      for (let j = 0; j < codeBufPtr; j += 1) out.push(codeBuf[j]!);
      codeBuf[0] = 0;
      codeBufPtr = 1;
      mask = 1;
    }
    const lastMatchLength = matchLength;
    let n = 0;
    while (n < lastMatchLength && srcPos < length) {
      deleteNode(s);
      const c = data[srcPos] ?? 0;
      srcPos += 1;
      textBuf[s] = c;
      if (s < F - 1) textBuf[s + N] = c;
      s = (s + 1) % N;
      r = (r + 1) % N;
      insertNode(r);
      n += 1;
    }
    while (n < lastMatchLength) {
      deleteNode(s);
      s = (s + 1) % N;
      r = (r + 1) % N;
      textLen -= 1;
      if (textLen > 0) insertNode(r);
      n += 1;
    }
    if (textLen <= 0) break;
  }
  if (codeBufPtr > 1) for (let j = 0; j < codeBufPtr; j += 1) out.push(codeBuf[j]!);
  return Uint8Array.from(out);
}

/**
 * All-literal LZSS stream: still fully valid for the same N/F/THRESHOLD
 * format, but with no back-references. Confirmed on real hardware (by the
 * pinned reference) to be the reliable choice for multi-color raw-pixel
 * frames over write-without-response, where a single dropped byte in a
 * back-reference chain desyncs everything after it.
 */
export function lzssCompressSafe(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const codeBuf = new Uint8Array(17);
  codeBuf[0] = 0;
  let ptr = 1;
  let mask = 1;
  for (const byte of data) {
    codeBuf[0] = (codeBuf[0]! | mask) & 0xff;
    codeBuf[ptr] = byte;
    ptr += 1;
    mask = (mask << 1) & 0xff;
    if (mask === 0) {
      for (let j = 0; j < ptr; j += 1) out.push(codeBuf[j]!);
      codeBuf[0] = 0;
      ptr = 1;
      mask = 1;
    }
  }
  if (ptr > 1) for (let j = 0; j < ptr; j += 1) out.push(codeBuf[j]!);
  return Uint8Array.from(out);
}

/**
 * Deterministic LZSS decoder for round-trip verification (N=512, F=18,
 * THRESHOLD=2). Mirrors the firmware's expected decode semantics; used only
 * in tests and diagnostics, never on the wire.
 */
export function lzssDecompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const textBuf = new Uint8Array(N + F - 1);
  let r = N - F;
  let flags = 0;
  let index = 0;
  for (;;) {
    flags >>>= 1;
    if ((flags & 0x100) === 0) {
      if (index >= data.length) break;
      flags = (data[index] ?? 0) | 0xff00;
      index += 1;
    }
    if ((flags & 1) !== 0) {
      if (index >= data.length) break;
      const c = data[index] ?? 0;
      index += 1;
      out.push(c);
      textBuf[r] = c;
      r = (r + 1) % N;
    } else {
      if (index + 1 >= data.length) break;
      const low = data[index] ?? 0;
      const high = data[index + 1] ?? 0;
      index += 2;
      const position = low | ((high & 0xf0) << 4);
      const count = (high & 0x0f) + THRESHOLD + 1;
      for (let k = 0; k < count; k += 1) {
        const c = textBuf[(position + k) % N] ?? 0;
        out.push(c);
        textBuf[r] = c;
        r = (r + 1) % N;
      }
    }
  }
  return Uint8Array.from(out);
}

export function xorAll(data: Uint8Array): number {
  let value = 0;
  for (const byte of data) value ^= byte;
  return value & 0xff;
}

function u16be(value: number): [number, number] { return [(value >>> 8) & 0xff, value & 0xff]; }
function u32be(value: number): [number, number, number, number] { return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]; }

/** Program announce (cmd 0x02): custom CRC32, uncompressed length, index, count, show count, in the standard envelope. */
export function buildAnnouncePacket(programBytes: Uint8Array, index: number, count: number, showCount: number): Uint8Array {
  const crc = crc32Custom(programBytes);
  const payload = Uint8Array.of(0x02, ...u32be(crc), ...u32be(programBytes.length), index & 0xff, count & 0xff, showCount & 0xff);
  return encodeEnvelope(payload);
}

export interface DataChunk {
  readonly index: number;
  readonly length: number;
  readonly packet: Uint8Array;
}

/**
 * Data chunk packets (cmd 0x03): reserved byte, total compressed size (u32),
 * chunk index (u16), chunk length (u16), data, then an XOR checksum over the
 * preceding sub-payload, all wrapped in the standard envelope.
 */
export function buildDataChunkPackets(compressed: Uint8Array, chunkSize = UX_PACKAGE_SIZE): readonly DataChunk[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError("Chunk size must be a positive integer.");
  const chunks: DataChunk[] = [];
  for (let offset = 0, index = 0; offset < compressed.length; offset += chunkSize, index += 1) {
    const data = compressed.slice(offset, offset + chunkSize);
    const sub = Uint8Array.of(0x00, ...u32be(compressed.length), ...u16be(index), ...u16be(data.length), ...data);
    const payload = Uint8Array.of(0x03, ...sub, xorAll(sub));
    chunks.push({ index, length: data.length, packet: encodeEnvelope(payload) });
  }
  return chunks;
}
