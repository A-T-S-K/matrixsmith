import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ILEDHAT_RGB444, processImage, type DecodedImageSource } from "../../src/render/image";

describe("supplied-logo production reducer golden invariants", () => {
  it("retains black, the orange accent, a bounded hard palette, determinism, and interactive runtime", () => {
    const source = decodeRgbaPng(readFileSync("research/image-reduction/fixtures/atsk-logo.png"));
    const recipe = { mode: "artwork" as const, composition: { mode: "foreground-trim" as const, opticalScaleX: 1.35 } };
    const started = performance.now(); const first = processImage(source, 32, 16, recipe, ILEDHAT_RGB444); const elapsed = performance.now() - started;
    const second = processImage(source, 32, 16, recipe, ILEDHAT_RGB444);
    expect([...first.frame.data]).toEqual([...second.frame.data]);
    expect(first.frame.width).toBe(32); expect(first.frame.height).toBe(16);
    expect(first.outputColorCount).toBeGreaterThanOrEqual(3); expect(first.outputColorCount).toBeLessThanOrEqual(6);
    expect([...first.frame.data].every((value) => value % 17 === 0)).toBe(true);
    let black = 0; let orange = 0; let orangeMinX = 32; let orangeMaxX = -1;
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 32; x += 1) { const pixel = first.frame.getPixel(x, y); if (pixel.r === 0 && pixel.g === 0 && pixel.b === 0) black += 1; if (pixel.r > pixel.g + 50 && pixel.r > pixel.b + 80) { orange += 1; orangeMinX = Math.min(orangeMinX, x); orangeMaxX = Math.max(orangeMaxX, x); } }
    expect(black).toBeGreaterThan(200); expect(orange).toBeGreaterThan(4);
    expect((orangeMinX + orangeMaxX) / 2).toBeGreaterThan(12); expect((orangeMinX + orangeMaxX) / 2).toBeLessThan(20);
    expect(elapsed).toBeLessThan(1000);
  });

  it.each([
    ["thin_line_icon.png", "artwork"],
    ["pixel_art_sprite.png", "pixel-art"],
    ["gradient.png", "photo"],
    ["transparent.png", "artwork"],
  ] as const)("processes corpus fixture %s deterministically", (name, mode) => {
    const source = decodeRgbaPng(readFileSync(`research/image-reduction/fixtures/${name}`));
    const recipe = { mode, composition: { mode: "contain" as const } };
    const first = processImage(source, 32, 16, recipe, ILEDHAT_RGB444); const second = processImage(source, 32, 16, recipe, ILEDHAT_RGB444);
    expect([...first.frame.data]).toEqual([...second.frame.data]);
    expect([...first.frame.data].every((value) => value % 17 === 0)).toBe(true);
    expect(first.outputColorCount).toBeGreaterThan(1);
  });
});

/** Minimal test-only decoder for the fixture's non-interlaced 8-bit RGBA PNG. */
function decodeRgbaPng(bytes: Uint8Array): DecodedImageSource {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 8; let width = 0; let height = 0; let colorType = 0; const idat: Uint8Array[] = [];
  while (offset < bytes.length) { const length = view.getUint32(offset); const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)); const data = bytes.slice(offset + 8, offset + 8 + length); offset += 12 + length; if (type === "IHDR") { const header = new DataView(data.buffer, data.byteOffset, data.byteLength); width = header.getUint32(0); height = header.getUint32(4); expect(data[8]).toBe(8); colorType = data[9] ?? 0; expect(data[12]).toBe(0); } else if (type === "IDAT") idat.push(data); else if (type === "IEND") break; }
  expect(colorType).toBe(6); const channels = 4; const raw = inflateSync(Buffer.concat(idat.map((value) => Buffer.from(value)))); const stride = width * channels; const rgba = new Uint8ClampedArray(width * height * channels); let input = 0; let transparent = 0;
  for (let y = 0; y < height; y += 1) { const filter = raw[input++] ?? 0; for (let x = 0; x < stride; x += 1) { const value = raw[input++] ?? 0; const left = x >= channels ? rgba[y * stride + x - channels] ?? 0 : 0; const up = y > 0 ? rgba[(y - 1) * stride + x] ?? 0 : 0; const upLeft = y > 0 && x >= channels ? rgba[(y - 1) * stride + x - channels] ?? 0 : 0; rgba[y * stride + x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + Math.floor((left + up) / 2) : value + paeth(left, up, upLeft)) & 0xff; } }
  for (let i = 3; i < rgba.length; i += 4) if ((rgba[i] ?? 255) < 255) transparent += 1;
  return { rgba, width, height, hasAlpha: transparent > 0, transparentFraction: transparent / (width * height) };
}
function paeth(a: number, b: number, c: number): number { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
