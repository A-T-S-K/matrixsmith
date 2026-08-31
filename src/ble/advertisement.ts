export interface AdStructure {
  readonly type: number;
  readonly data: Uint8Array;
}

export function parseAdvertisement(bytes: Uint8Array): AdStructure[] {
  const structures: AdStructure[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];
    if (length === undefined || length === 0) break;
    const end = offset + 1 + length;
    if (end > bytes.length || length < 1) throw new Error(`Malformed AD structure at offset ${offset}`);
    const type = bytes[offset + 1];
    if (type === undefined) throw new Error(`Missing AD type at offset ${offset}`);
    structures.push({ type, data: bytes.slice(offset + 2, end) });
    offset = end;
  }
  return structures;
}
