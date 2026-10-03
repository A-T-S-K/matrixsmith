/** Independent implementation of BadgeBLE.md's legacy layout; see docs/lsled-offline.md. */
export const LEGACY_WIDTH = 44;
export const LEGACY_HEIGHT = 11;
export const LEGACY_PIXEL_COUNT = 484;
export interface LegacyBitmap {
  readonly width: number;
  readonly height: number;
  /** Row-major binary samples, 0=off, 1=on. */
  readonly pixels: ArrayLike<number>;
  readonly mode?: "fixed";
}
export interface LegacyProgram {
  readonly pixels: Uint8Array;
  readonly headerSize: 64;
  readonly bitmapSize: 66;
  readonly programSize: 130;
  readonly paddingSize: 14;
  readonly timestampPolicy: "six-zero-bytes";
  readonly bytes: Uint8Array;
  readonly packets: readonly Uint8Array[];
}
export function encodeLegacyBitmap(input: LegacyBitmap): LegacyProgram {
  // Check shape/count before iterating or allocating anything proportional to input.
  if (input.width !== LEGACY_WIDTH || input.height !== LEGACY_HEIGHT)
    throw new RangeError("Only 44×11 monochrome bitmaps are supported.");
  if (input.mode !== undefined && input.mode !== "fixed")
    throw new RangeError("Only fixed mode is supported.");
  if (!input.pixels || input.pixels.length !== LEGACY_PIXEL_COUNT)
    throw new RangeError("Exactly 484 binary pixels are required.");
  for (let i = 0; i < LEGACY_PIXEL_COUNT; i++)
    if (input.pixels[i] !== 0 && input.pixels[i] !== 1)
      throw new RangeError("Pixels must be binary 0 or 1.");
  const pixels = new Uint8Array(LEGACY_PIXEL_COUNT);
  for (let i = 0; i < LEGACY_PIXEL_COUNT; i++) pixels[i] = input.pixels[i]!;
  const bytes = new Uint8Array(144);
  bytes.set([0x77, 0x61, 0x6e, 0x67, 0, 0]);
  bytes[8] = 0x04; // bank 0: speed 0, fixed; unused banks remain zero.
  new DataView(bytes.buffer).setUint16(0x10, 6, false);
  // Timestamp at 0x26 stays zero: declared offline policy, purpose unknown.
  for (let x = 0; x < LEGACY_WIDTH; x++)
    for (let y = 0; y < LEGACY_HEIGHT; y++)
      if (pixels[y * LEGACY_WIDTH + x])
        bytes[64 + Math.floor(x / 8) * 11 + y]! |= 1 << (7 - (x % 8));
  // Four unused low bits of the last group and fourteen final bytes stay zero.
  return {
    pixels,
    headerSize: 64,
    bitmapSize: 66,
    programSize: 130,
    paddingSize: 14,
    timestampPolicy: "six-zero-bytes",
    bytes,
    packets: Array.from({ length: 9 }, (_, i) =>
      bytes.slice(i * 16, (i + 1) * 16),
    ),
  };
}
