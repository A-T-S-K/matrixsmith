/** Independent fixed-frame encoder; scope and source conflicts: docs/merkury-offline.md. */
export function encodeRgbBlocks(input: {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}): readonly Uint8Array[] {
  if (input.width !== 16 || input.height !== 16)
    throw new RangeError("Only exact 16×16 RGB input is supported.");
  if (!input.data || input.data.length !== 768)
    throw new RangeError("Exactly 768 RGB channel values are required.");
  for (let i = 0; i < 768; i++) {
    const channel = input.data[i];
    if (!Number.isInteger(channel) || channel! < 0 || channel! > 255)
      throw new RangeError("RGB channels must be integer bytes from 0 to 255.");
  }
  return Array.from({ length: 8 }, (_, block) => {
    const bytes = new Uint8Array(100);
    bytes.set([0xbc, 0x0f, block + 1]);
    for (let channel = 0; channel < 96; channel++)
      bytes[3 + channel] = input.data[block * 96 + channel]!;
    bytes[99] = 0x55;
    return bytes;
  });
}
