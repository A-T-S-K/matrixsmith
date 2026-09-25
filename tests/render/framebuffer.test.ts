import { describe, expect, it } from "vitest";
import { Framebuffer } from "../../src/render/framebuffer";
import { orientationPattern } from "../../src/render/patterns";

describe("Framebuffer", () => {
  it("uses row-major RGB888 host storage", () => {
    const frame = new Framebuffer(32, 16);
    frame.setPixel(31, 15, 1, 2, 3);
    expect(frame.data.length).toBe(32 * 16 * 3);
    expect(frame.getPixel(31, 15)).toEqual({ r: 1, g: 2, b: 3 });
    expect([...frame.data.slice(-3)]).toEqual([1, 2, 3]);
  });

  it("bounds-checks coordinates", () => {
    const frame = new Framebuffer(32, 16);
    expect(() => frame.setPixel(32, 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => frame.getPixel(0, -1)).toThrow(RangeError);
  });

  it("clamps RGB values", () => {
    const frame = new Framebuffer(32, 16);
    frame.setPixel(0, 0, -4, 12.6, 999);
    expect(frame.getPixel(0, 0)).toEqual({ r: 0, g: 13, b: 255 });
  });
});

describe("orientation pattern", () => {
  it("has uniquely colored corners", () => {
    const frame = orientationPattern();
    expect(frame.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0 });
    expect(frame.getPixel(31, 0)).toEqual({ r: 0, g: 255, b: 0 });
    expect(frame.getPixel(0, 15)).toEqual({ r: 0, g: 0, b: 255 });
    expect(frame.getPixel(31, 15)).toEqual({ r: 255, g: 255, b: 0 });
    expect(frame.getPixel(15, 7)).toEqual({ r: 255, g: 255, b: 255 });
  });
});
