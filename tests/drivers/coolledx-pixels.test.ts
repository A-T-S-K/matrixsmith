import { describe, expect, it } from "vitest";
import { packCoolLedPixels } from "../../src/drivers/coolledx/pixels";
import { Framebuffer } from "../../src/render/framebuffer";

const solid = (r: number, g: number, b: number): Framebuffer => { const frame = new Framebuffer(32, 16); frame.fill(r, g, b); return frame; };

describe("CoolLEDX pixel packing", () => {
  it.each([
    ["black", 0, 0, 0, 0x00, 0x00, 0x00],
    ["red", 255, 0, 0, 0xff, 0x00, 0x00],
    ["green", 0, 255, 0, 0x00, 0xff, 0x00],
    ["blue", 0, 0, 255, 0x00, 0x00, 0xff],
    ["white", 255, 255, 255, 0xff, 0xff, 0xff],
  ])("packs %s into separate channel planes", (_name, r, g, b, er, eg, eb) => {
    const packed = packCoolLedPixels(solid(r as number, g as number, b as number));
    expect(packed).toHaveLength(192);
    expect(new Set(packed.slice(0, 64))).toEqual(new Set([er]));
    expect(new Set(packed.slice(64, 128))).toEqual(new Set([eg]));
    expect(new Set(packed.slice(128))).toEqual(new Set([eb]));
  });

  it("uses column-major bytes with the top pixel in the MSB", () => {
    const frame = solid(0, 0, 0);
    frame.setPixel(0, 0, 255, 0, 0);
    frame.setPixel(31, 15, 0, 0, 255);
    frame.setPixel(31, 0, 0, 255, 0);
    expect(packCoolLedPixels(frame)[0]).toBe(0x80);
    expect(packCoolLedPixels(frame)[64 + 62]).toBe(0x80);
    expect(packCoolLedPixels(frame)[128 + 63]).toBe(0x01);
  });

  it("packs horizontal and vertical stripes predictably", () => {
    const frame = solid(0, 0, 0);
    for (let y = 0; y < 16; y += 1) frame.setPixel(3, y, 255, 0, 0);
    for (let x = 0; x < 32; x += 1) frame.setPixel(x, 7, 0, 255, 0);
    const packed = packCoolLedPixels(frame);
    expect([...packed.slice(6, 8)]).toEqual([0xfe, 0xff]);
    expect(packed[64]).toBe(0x01);
  });
});
