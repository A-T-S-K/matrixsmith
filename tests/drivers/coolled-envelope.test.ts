import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope, escapeBytes, unescapeBytes } from "../../src/drivers/coolled/common/envelope";
import { parseHexBytes } from "../../src/discovery/advertisement";

describe("shared CoolLED envelope", () => {
  const compactHex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  it.each(["", "00", "04 40", "01 02 03"])("round-trips payload %s", (hex) => {
    const payload = parseHexBytes(hex);
    expect(decodeEnvelope(encodeEnvelope(payload)).payload).toEqual(payload);
  });
  it("escapes and unescapes every reserved byte", () => {
    expect([...escapeBytes(Uint8Array.of(1, 2, 3))]).toEqual([2, 5, 2, 6, 2, 7]);
    expect([...unescapeBytes(Uint8Array.of(2, 5, 2, 6, 2, 7))]).toEqual([1, 2, 3]);
  });
  it("rejects malformed framing, escapes, and length", () => {
    expect(() => decodeEnvelope(parseHexBytes("00000003"))).toThrow(/start/);
    expect(() => decodeEnvelope(parseHexBytes("01000004"))).toThrow(/end/);
    expect(() => decodeEnvelope(parseHexBytes("0100000203"))).toThrow(/truncated escape/);
    expect(() => decodeEnvelope(parseHexBytes("010002064003"))).toThrow(/length mismatch/);
  });
  it.each([
    ["0100020608FE03", "08FE"],
    ["01000206044003", "0440"],
    ["010002051F03", "1F"],
  ])("decodes hardware packet %s", (raw, payload) => expect(compactHex(decodeEnvelope(parseHexBytes(raw)).payload)).toBe(payload));
});
