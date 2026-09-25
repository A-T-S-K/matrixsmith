import { describe, expect, it } from "vitest";
import { Framebuffer } from "../../src/render/framebuffer";
import { FrameSequence } from "../../src/render/frame-sequence";
import {
  ANIMATION_OFF_COLOR,
  encodeFrame,
  offColorFor,
  PIXEL_OFF_COLOR,
  rgb444PixelColor,
  rgb444TextColor,
  rgb444TransferChannel,
} from "../../src/drivers/coolledux/pixels";
import {
  compileAnimation,
  compileFrameBorder,
  compileGif,
  compileGraffitiFrame,
  DEFAULT_TILE_WIDTH,
  tileColumns,
} from "../../src/drivers/coolledux/content";
import { crc32Custom, lzssDecompress } from "../../src/drivers/coolledux/wire";
import conformance from "../fixtures/coolledux/conformance.json";

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** The deterministic 32x16 quadrant test image shared with the reference fixture generator. */
function quadrantColor(
  x: number,
  y: number,
  width = 32,
  height = 16,
): string | null {
  if (x >= 14 && x < 18 && y >= 7 && y < 9) return "#FFFFFF";
  if (x < 4 && y < 4) return "#FF0000";
  if (x >= width - 4 && y < 4) return "#00FF00";
  if (x < 4 && y >= height - 4) return "#0000FF";
  if (x >= width - 4 && y >= height - 4) return "#FFFF00";
  return null;
}

function quadrantFrame(): Framebuffer {
  const frame = new Framebuffer(32, 16);
  for (let x = 0; x < 32; x += 1)
    for (let y = 0; y < 16; y += 1) {
      const color = quadrantColor(x, y);
      if (color) frame.setPixel(x, y, ...rgb(color));
    }
  return frame;
}

function invertedQuadrantFrame(): Framebuffer {
  const inversion: Record<string, string> = {
    "#FF0000": "#00FF00",
    "#00FF00": "#FF0000",
    "#0000FF": "#FFFF00",
    "#FFFF00": "#0000FF",
    "#FFFFFF": "#FF0000",
  };
  const frame = new Framebuffer(32, 16);
  for (let x = 0; x < 32; x += 1)
    for (let y = 0; y < 16; y += 1) {
      const color = quadrantColor(x, y);
      if (color) frame.setPixel(x, y, ...rgb(inversion[color] ?? color));
    }
  return frame;
}

describe("RGB444 encodings", () => {
  it.each(Object.entries(conformance.rgb444))(
    "matches the reference text and pixel encodings for %s",
    (hex, vector) => {
      const [r, g, b] = rgb(hex);
      expect(toHex(rgb444TextColor(r, g, b))).toBe(vector.text);
      expect(toHex(rgb444PixelColor(r, g, b))).toBe(vector.pixel);
    },
  );

  it("keeps the two encodings distinct where the curves diverge", () => {
    // 0x2F = 47: pixel curve collapses to 0, plain divide gives 2.
    expect(toHex(rgb444PixelColor(0x2f, 0x2f, 0x2f))).toBe("0000");
    expect(toHex(rgb444TextColor(0x2f, 0x2f, 0x2f))).toBe("0222");
  });

  it("clamps the transfer curve at both ends", () => {
    expect(rgb444TransferChannel(0)).toBe(0);
    expect(rgb444TransferChannel(47)).toBe(0);
    expect(rgb444TransferChannel(48)).toBe(1);
    expect(rgb444TransferChannel(237)).toBe(14);
    expect(rgb444TransferChannel(238)).toBe(15);
    expect(rgb444TransferChannel(255)).toBe(15);
  });

  it("exposes the hardware-confirmed off sentinels per content path", () => {
    expect(toHex(PIXEL_OFF_COLOR)).toBe(conformance.offColors.pixelOff);
    expect(toHex(ANIMATION_OFF_COLOR)).toBe(conformance.offColors.animationOff);
    expect(offColorFor("graffiti")).toEqual(PIXEL_OFF_COLOR);
    expect(offColorFor("animation")).toEqual(ANIMATION_OFF_COLOR);
  });

  it("substitutes the Graffiti off sentinel for black pixels, never literal 0x0000", () => {
    const frame = new Framebuffer(2, 1);
    frame.setPixel(0, 0, 0, 0, 0);
    frame.setPixel(1, 0, 255, 0, 0);
    expect(toHex(encodeFrame(frame, "graffiti"))).toBe("0004" + "0f00");
    expect(toHex(encodeFrame(frame, "animation"))).toBe("0000" + "0f00");
  });

  it("encodes the reference quadrant frame stream exactly (graffiti path)", () => {
    expect(toHex(encodeFrame(quadrantFrame(), "graffiti"))).toBe(
      conformance.pixelGrid.frameHex,
    );
  });
});

describe("tiling", () => {
  it("tiles 8x16 into one tile", () => {
    expect(tileColumns(8)).toEqual([{ startColumn: 0, width: 8 }]);
  });
  it("tiles 16x16 into two tiles", () => {
    expect(tileColumns(16)).toEqual([
      { startColumn: 0, width: 8 },
      { startColumn: 8, width: 8 },
    ]);
  });
  it("tiles 32x16 into four tiles at columns 0/8/16/24", () => {
    expect(tileColumns(32).map((tile) => tile.startColumn)).toEqual([
      0, 8, 16, 24,
    ]);
    expect(tileColumns(32).every((tile) => tile.width === 8)).toBe(true);
  });
  it("keeps a narrower final tile for non-multiple widths instead of cropping", () => {
    expect(tileColumns(30)).toEqual([
      { startColumn: 0, width: 8 },
      { startColumn: 8, width: 8 },
      { startColumn: 16, width: 8 },
      { startColumn: 24, width: 6 },
    ]);
  });
  it("rejects invalid dimensions", () => {
    expect(() => tileColumns(0)).toThrow();
    expect(() => tileColumns(8, 0)).toThrow();
  });
});

describe("tiled Graffiti compilation", () => {
  const vector = conformance.tiledGraffiti;

  it("produces the exact reference program bytes for the 32x16 quadrant frame", () => {
    const compiled = compileGraffitiFrame(quadrantFrame());
    expect(toHex(compiled.programBytes)).toBe(vector.programHex);
    expect(compiled.crc32).toBe(vector.crc >>> 0);
  });

  it("produces the exact reference packet list (announce + safe-LZSS chunks)", () => {
    const compiled = compileGraffitiFrame(quadrantFrame());
    expect(compiled.packets.map(toHex)).toEqual(vector.packetsHex);
    expect(compiled.compression).toBe("lzss-safe");
  });

  it("uses four 8-column tiles on 32x16 and derives dimensions from the frame", () => {
    const compiled = compileGraffitiFrame(quadrantFrame());
    expect(compiled.tileCount).toBe(4);
    expect(compiled.tileWidth).toBe(DEFAULT_TILE_WIDTH);
    // content_number byte in the program container equals the tile count.
    expect(compiled.programBytes[8]).toBe(4);
    const narrow = compileGraffitiFrame(new Framebuffer(8, 16));
    expect(narrow.tileCount).toBe(1);
  });

  it("round-trips the compressed stream back to the program bytes", () => {
    const compiled = compileGraffitiFrame(quadrantFrame());
    expect(toHex(lzssDecompress(compiled.compressedBytes))).toBe(
      toHex(compiled.programBytes),
    );
  });

  it("is deterministic", () => {
    expect(toHex(compileGraffitiFrame(quadrantFrame()).programBytes)).toBe(
      toHex(compileGraffitiFrame(quadrantFrame()).programBytes),
    );
  });
});

describe("tiled Animation compilation", () => {
  const vector = conformance.tiledAnimation;
  const sequence = (): FrameSequence =>
    new FrameSequence(
      [quadrantFrame(), invertedQuadrantFrame()],
      [{ milliseconds: 1000 }, { milliseconds: 1000 }],
    );

  it("produces the exact reference program bytes and packets", () => {
    const compiled = compileAnimation(sequence());
    expect(toHex(compiled.programBytes)).toBe(vector.programHex);
    expect(compiled.crc32).toBe(vector.crc >>> 0);
    expect(compiled.packets.map(toHex)).toEqual(vector.packetsHex);
  });

  it("keeps every tile's frame count and delay list in sync", () => {
    const compiled = compileAnimation(sequence());
    expect(compiled.tileCount).toBe(4);
    expect(compiled.programBytes[8]).toBe(4);
  });

  it("rejects invalid frame delays conservatively", () => {
    const frames = [new Framebuffer(8, 16), new Framebuffer(8, 16)];
    expect(() =>
      compileAnimation(
        new FrameSequence(frames, [
          { milliseconds: 70000 },
          { milliseconds: 100 },
        ]),
      ),
    ).toThrow(/65535/);
  });
});

describe("GIF and frame border compilation", () => {
  it("wraps raw GIF bytes unmodified into the reference packet list", () => {
    const compiled = compileGif(
      fromHex(conformance.gif.gifHex),
      conformance.gif.width,
      conformance.gif.height,
    );
    expect(compiled.packets.map(toHex)).toEqual(conformance.gif.packetsHex);
    expect(toHex(lzssDecompress(compiled.compressedBytes))).toContain(
      conformance.gif.gifHex,
    );
  });

  it("builds the reference decorative border packets", () => {
    const compiled = compileFrameBorder(32, 16);
    expect(compiled.packets.map(toHex)).toEqual(
      conformance.frameBorder.packetsHex,
    );
  });
});

describe("program integrity", () => {
  it("CRC in the announce covers exactly the uncompressed program bytes", () => {
    const compiled = compileGraffitiFrame(quadrantFrame());
    expect(crc32Custom(compiled.programBytes)).toBe(compiled.crc32);
  });
});
