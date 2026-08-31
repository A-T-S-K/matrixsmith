import { describe, expect, it } from "vitest";
import { parseAdvertisement } from "../../src/discovery/advertisement";

const CAPTURE = "0201060303F0FF0EFFAE315EEA07000001100020031E0809694C6564486174";

describe("advertisement parser", () => {
  it("splits the confirmed capture without assigning speculative field meanings", () => {
    const bytes = Uint8Array.from(CAPTURE.match(/../g) ?? [], (hex) => Number.parseInt(hex, 16));
    const structures = parseAdvertisement(bytes);
    expect(structures.map(({ type }) => type)).toEqual([0x01, 0x03, 0xff, 0x09]);
    expect([...structures[1]!.data]).toEqual([0xf0, 0xff]);
    expect(new TextDecoder().decode(structures[3]!.data)).toBe("iLedHat");
    expect([...structures[2]!.data]).toEqual([0xae, 0x31, 0x5e, 0xea, 0x07, 0x00, 0x00, 0x01, 0x10, 0x00, 0x20, 0x03, 0x1e]);
  });

  it("rejects truncated structures", () => {
    expect(() => parseAdvertisement(Uint8Array.of(3, 1, 6))).toThrow(/Malformed/);
  });
});
