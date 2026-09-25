import { describe, expect, it } from "vitest";
import {
  createImageTransferPayload,
  encodeTransferPackets,
  xorChecksum,
} from "../../src/drivers/coolledx/transfer";

describe("CoolLEDX transfer codec", () => {
  it("computes XOR over exactly the supplied record fields", () => {
    expect(xorChecksum(new Uint8Array())).toBe(0);
    expect(xorChecksum(Uint8Array.of(0, 0, 3, 0, 0, 3, 0xaa, 0xbb, 0xcc))).toBe(
      3 ^ 3 ^ 0xaa ^ 0xbb ^ 0xcc,
    );
    expect(xorChecksum(Uint8Array.of(1, 2, 3))).not.toBe(
      xorChecksum(Uint8Array.of(1, 2, 4)),
    );
  });

  it("uses a 26-byte image header and 128-byte chunks", () => {
    const pixels = Uint8Array.from({ length: 192 }, (_, index) => index);
    const payload = createImageTransferPayload(pixels);
    expect(payload.length).toBe(218);
    expect([...payload.slice(24, 26)]).toEqual([0, 192]);
    const packets = encodeTransferPackets(0x03, payload);
    expect(packets).toHaveLength(2);
    expect(packets[0]?.[0]).toBe(0x01);
    expect(packets[0]?.at(-1)).toBe(0x03);
  });

  it("frames an empty transfer deterministically", () => {
    expect([
      ...(encodeTransferPackets(0x03, new Uint8Array())[0] ?? []),
    ]).toEqual([1, 0, 8, 2, 7, 0, 0, 0, 0, 0, 0, 0, 3]);
  });
});
