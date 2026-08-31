import { describe, expect, it } from "vitest";
import { computeFitPlacement, readGifMetadata, rgbaToFramebuffer } from "../../src/render/image";

describe("image fit placement", () => {
  it("stretch maps the full source to the full target", () => {
    expect(computeFitPlacement(100, 50, 32, 16, "stretch")).toEqual({ sx: 0, sy: 0, sw: 100, sh: 50, dx: 0, dy: 0, dw: 32, dh: 16 });
  });

  it("contain letterboxes a tall source", () => {
    const placement = computeFitPlacement(16, 32, 32, 16, "contain");
    expect(placement.dh).toBe(16);
    expect(placement.dw).toBe(8);
    expect(placement.dx).toBe(12);
    expect(placement.dy).toBe(0);
  });

  it("cover crops the source symmetrically", () => {
    const placement = computeFitPlacement(100, 100, 32, 16, "cover");
    expect(placement.dw).toBe(32);
    expect(placement.dh).toBe(16);
    expect(placement.sh).toBeLessThan(100);
    expect(placement.sy).toBeGreaterThan(0);
  });

  it("center keeps 1:1 pixels and crops larger sources", () => {
    const small = computeFitPlacement(8, 8, 32, 16, "center");
    expect(small).toEqual({ sx: 0, sy: 0, sw: 8, sh: 8, dx: 12, dy: 4, dw: 8, dh: 8 });
    const large = computeFitPlacement(64, 64, 32, 16, "center");
    expect(large.sw).toBe(32);
    expect(large.sh).toBe(16);
    expect(large.sx).toBe(16);
    expect(large.sy).toBe(24);
  });

  it("rejects non-positive dimensions", () => {
    expect(() => computeFitPlacement(0, 10, 32, 16, "contain")).toThrow();
  });
});

describe("RGBA conversion", () => {
  it("composites alpha over black", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 128, 255, 255, 255, 0, 10, 20, 30, 255]);
    const frame = rgbaToFramebuffer(rgba, 4, 1);
    expect(frame.getPixel(0, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(frame.getPixel(1, 0).r).toBe(128);
    expect(frame.getPixel(2, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(frame.getPixel(3, 0)).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("rejects mismatched buffer sizes", () => {
    expect(() => rgbaToFramebuffer(new Uint8ClampedArray(5), 4, 1)).toThrow();
  });
});

describe("GIF metadata", () => {
  it("reads canvas dimensions from a GIF89a header", () => {
    const header = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 32, 0, 16, 0, 0, 0);
    expect(readGifMetadata(header)).toEqual({ byteLength: 12, width: 32, height: 16, isGif: true });
  });

  it("flags non-GIF bytes without guessing dimensions", () => {
    expect(readGifMetadata(new TextEncoder().encode("PNG not gif"))).toEqual({ byteLength: 11, width: null, height: null, isGif: false });
  });
});
