import { describe, expect, it } from "vitest";
import { encodeLegacyBitmap } from "../../src/drivers/lsled/codec";
import { packetHex } from "../../src/core/transmission";
import vectors from "../fixtures/lsled/vectors.json";
const compactHex = (bytes: Uint8Array) =>
  packetHex(bytes).replaceAll(" ", "").toLowerCase();
const encode = (pixels: ArrayLike<number>) =>
  encodeLegacyBitmap({ width: 44, height: 11, pixels });
describe("source-scoped legacy codec", () => {
  it("matches an independently authored literal bit-string oracle and reconstructs sequential packets", () => {
    const pixels = new Uint8Array(484);
    for (const [x, y] of vectors.points) pixels[y! * 44 + x!] = 1;
    const result = encode(pixels);
    const expected =
      vectors.headerHex + vectors.groupsHex.join("") + vectors.finalPaddingHex;
    expect(compactHex(result.bytes)).toBe(expected);
    expect(result.packets.map(compactHex).join("")).toBe(expected);
    expect(result.packets).toHaveLength(9);
    for (const packet of result.packets) expect(packet).toHaveLength(16);
    expect(result).toMatchObject({
      headerSize: 64,
      bitmapSize: 66,
      programSize: 130,
      paddingSize: 14,
      timestampPolicy: "six-zero-bytes",
    });
    expect(encode(pixels).bytes).toEqual(result.bytes);
  });
  it("all off/on preserves partial-width bits, unused banks, separator, timestamp and padding", () => {
    const off = encode(new Uint8Array(484));
    expect(compactHex(off.bytes.slice(0, 64))).toBe(vectors.headerHex);
    expect(off.bytes.slice(64).every((v) => v === 0)).toBe(true);
    const on = encode(new Uint8Array(484).fill(1));
    expect([...on.bytes.slice(64, 119)]).toEqual(Array(55).fill(255));
    expect([...on.bytes.slice(119, 130)]).toEqual(Array(11).fill(240));
    expect(on.bytes.slice(130).every((v) => v === 0)).toBe(true);
    expect([...on.bytes.slice(16, 18)]).toEqual([0, 6]);
  });
  it("every individual pixel has exactly its group/row byte and MSB-first bit (including corners and axes)", () => {
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 44; x++) {
        const pixels = new Uint8Array(484);
        pixels[y * 44 + x] = 1;
        const bitmap = encode(pixels).bytes.slice(64, 130);
        expect(bitmap[Math.floor(x / 8) * 11 + y]).toBe(128 >> (x % 8));
        expect([...bitmap].filter(Boolean)).toHaveLength(1);
      }
  });
  it("rejects wrong dimensions, counts, values and modes before reading oversize input", () => {
    for (const width of [0, 43, 48, Infinity, NaN])
      expect(() =>
        encodeLegacyBitmap({ width, height: 11, pixels: [] }),
      ).toThrow();
    expect(() =>
      encodeLegacyBitmap({ width: 44, height: 12, pixels: [] }),
    ).toThrow();
    for (const value of [2, -1, 0.5, NaN, Infinity]) {
      const pixels = Array(484).fill(0);
      pixels[483] = value;
      expect(() => encode(pixels)).toThrow(/binary/);
    }
    expect(() => encode([])).toThrow(/484/);
    expect(() =>
      encode({
        length: 1e12,
        get 0(): number {
          throw Error("must not read");
        },
      }),
    ).toThrow(/484/);
    expect(() =>
      encodeLegacyBitmap({
        width: 44,
        height: 11,
        pixels: new Uint8Array(484),
        mode: "scroll" as "fixed",
      }),
    ).toThrow(/fixed/);
  });
});
