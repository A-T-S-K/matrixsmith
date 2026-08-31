import { describe, expect, it } from "vitest";
import { FONT_GLYPH_HEIGHT, glyphColumns, measureText, renderText, scrollOffsets, textColumns } from "../../src/render/font";
import { Framebuffer } from "../../src/render/framebuffer";

function litPixels(frame: Framebuffer): [number, number][] {
  const lit: [number, number][] = [];
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
    const pixel = frame.getPixel(x, y);
    if (pixel.r || pixel.g || pixel.b) lit.push([x, y]);
  }
  return lit;
}

describe("embedded bitmap font", () => {
  it("provides five columns per glyph for the printable ASCII range", () => {
    for (let code = 32; code <= 126; code += 1) expect(glyphColumns(String.fromCodePoint(code))).toHaveLength(5);
  });

  it("substitutes a visible fallback for unsupported code points", () => {
    expect(glyphColumns("→")).toEqual([0x7f, 0x41, 0x41, 0x41, 0x7f]);
  });

  it("spaces glyphs by one blank column and measures deterministically", () => {
    expect(textColumns("HI")).toHaveLength(11);
    expect(measureText("HI")).toEqual({ width: 11, height: FONT_GLYPH_HEIGHT });
    expect(measureText("")).toEqual({ width: 0, height: FONT_GLYPH_HEIGHT });
  });
});

describe("text rasterization", () => {
  it("is deterministic for identical inputs", () => {
    const a = renderText("HI", 32, 16, { color: { r: 255, g: 0, b: 0 } });
    const b = renderText("HI", 32, 16, { color: { r: 255, g: 0, b: 0 } });
    expect([...a.data]).toEqual([...b.data]);
  });

  it("renders the exact expected pixels for a known glyph", () => {
    // "I" is columns [0x00, 0x41, 0x7f, 0x41, 0x00]: full center stroke with serifs.
    const frame = renderText("I", 5, 7, { color: { r: 255, g: 255, b: 255 } });
    expect(frame.getPixel(2, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(frame.getPixel(2, 6)).toEqual({ r: 255, g: 255, b: 255 });
    expect(frame.getPixel(1, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(frame.getPixel(1, 3)).toEqual({ r: 0, g: 0, b: 0 });
    expect(frame.getPixel(0, 3)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("vertically centers the seven-row font on a sixteen-row canvas", () => {
    const frame = renderText("I", 32, 16, { color: { r: 0, g: 255, b: 0 }, alignment: "left" });
    const rows = new Set(litPixels(frame).map(([, y]) => y));
    expect(Math.min(...rows)).toBe(4);
    expect(Math.max(...rows)).toBe(10);
  });

  it("honors alignment", () => {
    const left = renderText("HI", 32, 16, { color: { r: 255, g: 255, b: 255 }, alignment: "left" });
    const center = renderText("HI", 32, 16, { color: { r: 255, g: 255, b: 255 }, alignment: "center" });
    const right = renderText("HI", 32, 16, { color: { r: 255, g: 255, b: 255 }, alignment: "right" });
    expect(Math.min(...litPixels(left).map(([x]) => x))).toBe(0);
    expect(Math.min(...litPixels(center).map(([x]) => x))).toBe(10);
    // "I" ends with a structurally blank column, so the rightmost LIT pixel
    // sits one column inside the right edge.
    expect(Math.max(...litPixels(right).map(([x]) => x))).toBe(30);
  });

  it("clips text wider than the canvas without throwing", () => {
    const frame = renderText("WWWWWWWWWW", 32, 16, { color: { r: 255, g: 255, b: 255 } });
    expect(litPixels(frame).every(([x]) => x >= 0 && x < 32)).toBe(true);
  });

  it("paints the background color everywhere text is absent", () => {
    const frame = renderText("I", 8, 16, { color: { r: 255, g: 0, b: 0 }, background: { r: 0, g: 0, b: 40 } });
    expect(frame.getPixel(7, 0)).toEqual({ r: 0, g: 0, b: 40 });
  });

  it("computes scroll offsets that enter from the right and fully exit left", () => {
    const offsets = scrollOffsets("HI", 32, 4);
    expect(offsets[0]).toBe(32);
    expect(offsets[offsets.length - 1]).toBe(-11);
    const first = renderText("HI", 32, 16, { color: { r: 255, g: 255, b: 255 }, alignment: "left", offsetX: offsets[0]! });
    expect(litPixels(first)).toHaveLength(0);
  });
});
