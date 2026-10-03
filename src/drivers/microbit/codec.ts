/** Independent binary-octet encoder; source scope is in docs/microbit-offline.md. */
export function encodeMatrixState(input: {
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayLike<number>;
}): Uint8Array {
  if (input.width !== 5 || input.height !== 5)
    throw new RangeError("Only exact 5×5 monochrome input is supported.");
  if (!input.pixels || input.pixels.length !== 25)
    throw new RangeError("Exactly 25 binary pixels are required.");
  for (let i = 0; i < 25; i++)
    if (input.pixels[i] !== 0 && input.pixels[i] !== 1)
      throw new RangeError("Pixels must be binary 0 or 1.");
  const bytes = new Uint8Array(5);
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 5; x++)
      if (input.pixels[y * 5 + x]) bytes[y]! |= 1 << (4 - x);
  return bytes;
}
