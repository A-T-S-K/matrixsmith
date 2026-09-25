import { INPUT_LIMITS } from "../../application/input-limits";

export function validateImageDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Image dimensions are invalid.");
  if (width * height > INPUT_LIMITS.imagePixels)
    throw new Error("Image exceeds the 24-megapixel decode budget.");
}

/** Inspect bounded headers, never allocate image-sized buffers before validation. */
export async function inspectImageDimensions(file: Blob): Promise<void> {
  if (file.size > INPUT_LIMITS.captureBytes)
    throw new Error("Image file exceeds the 25 MiB input budget.");
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string): boolean =>
    [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const dimensions = (width: number, height: number): void =>
    validateImageDimensions(width, height);
  if (
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    tag(1, "PNG\r\n\x1a\n") &&
    view.getUint32(8) === 13 &&
    tag(12, "IHDR")
  )
    return dimensions(view.getUint32(16), view.getUint32(20));
  if (bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === undefined || marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const size = view.getUint16(at);
      if (size < 2 || at + size > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (size < 8) break;
        return dimensions(view.getUint16(at + 5), view.getUint16(at + 3));
      }
      at += size;
    }
  }
  if (bytes.length >= 20 && tag(0, "RIFF") && tag(8, "WEBP")) {
    const end = view.getUint32(4, true) + 8;
    if (end > file.size) throw new Error("Image WebP container is truncated.");
    for (let at = 12; at + 8 <= Math.min(end, bytes.length);) {
      const size = view.getUint32(at + 4, true);
      const data = at + 8;
      if (data + size > end) break;
      if (tag(at, "VP8X") && size >= 10 && data + 10 <= bytes.length) {
        const u24 = (i: number): number =>
          view.getUint8(i) +
          view.getUint8(i + 1) * 256 +
          view.getUint8(i + 2) * 65536;
        return dimensions(u24(data + 4) + 1, u24(data + 7) + 1);
      }
      if (
        tag(at, "VP8 ") &&
        size >= 10 &&
        data + 10 <= bytes.length &&
        tag(data + 3, "\x9d\x01\x2a")
      )
        return dimensions(
          view.getUint16(data + 6, true) & 16383,
          view.getUint16(data + 8, true) & 16383,
        );
      if (
        tag(at, "VP8L") &&
        size >= 5 &&
        data + 5 <= bytes.length &&
        bytes[data] === 47
      ) {
        const bits = view.getUint32(data + 1, true);
        return dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
      }
      at = data + size + (size % 2);
    }
  }
  throw new Error(
    "Image header is malformed, unsupported, or exceeds the 1 MiB inspection budget. Choose a PNG, JPEG, or WebP image.",
  );
}
