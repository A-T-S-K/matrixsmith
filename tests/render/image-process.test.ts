import { describe, expect, it } from "vitest";
import { analyzeImage, ILEDHAT_RGB444, processImage, type DecodedImageSource } from "../../src/render/image";
import { reducePhoto } from "../../src/render/image/photo";

function source(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): DecodedImageSource {
  const rgba = new Uint8ClampedArray(width * height * 4); let transparent = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const value = pixel(x, y); rgba.set(value, (y * width + x) * 4); if (value[3] < 255) transparent += 1; }
  return { rgba, width, height, hasAlpha: transparent > 0, transparentFraction: transparent / (width * height) };
}

describe("content-routed image processing", () => {
  it("averages photos in linear light instead of nonlinear sRGB", () => {
    const input = source(2, 1, (x) => x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const frame = reducePhoto(input, 1, 1, { mode: "contain" }, 0);
    expect(frame.getPixel(0, 0).r).toBeGreaterThanOrEqual(187);
    expect(frame.getPixel(0, 0).r).toBeLessThanOrEqual(189);
  });

  it("keeps pixel art hard, deterministic, and RGB444-realizable", () => {
    const input = source(4, 4, (x, y) => ((x >> 1) + (y >> 1)) % 2 ? [255, 128, 0, 255] : [0, 0, 0, 255]);
    const recipe = { mode: "pixel-art" as const, composition: { mode: "contain" as const } };
    const first = processImage(input, 8, 8, recipe, ILEDHAT_RGB444);
    const second = processImage(input, 8, 8, recipe, ILEDHAT_RGB444);
    expect([...first.frame.data]).toEqual([...second.frame.data]);
    expect(first.outputColorCount).toBe(2);
    expect([...first.frame.data].every((value) => value % 17 === 0)).toBe(true);
  });

  it("protects a small chromatic artwork accent and emits a bounded hard palette", () => {
    const input = source(24, 24, (x, y) => {
      if (x >= 10 && x <= 13 && y >= 5 && y <= 18) return [255, 92, 0, 255];
      if (x === 3 || x === 20 || y === 3 || y === 20) return [180, 180, 180, 255];
      return [0, 0, 0, 255];
    });
    const result = processImage(input, 32, 16, { mode: "artwork", composition: { mode: "contain" } }, ILEDHAT_RGB444);
    expect(result.frame.getPixel(0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(result.outputColorCount).toBeLessThanOrEqual(6);
    expect([...result.frame.data].some((_, i, data) => i % 3 === 0 && (data[i] ?? 0) > (data[i + 1] ?? 0) + 50)).toBe(true);
  });

  it("routes uncertain Auto content to the Photo-safe path", () => {
    const input = source(11, 7, (x, y) => [x * 19 % 255, y * 31 % 255, (x * y * 7) % 255, 255]);
    const analysis = analyzeImage(input);
    const result = processImage(input, 32, 16, { mode: "auto", composition: { mode: "contain" } }, ILEDHAT_RGB444);
    if (analysis.confidence !== "high") expect(result.resolvedMode).toBe("photo");
  });
});
