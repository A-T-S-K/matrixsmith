import { describe, expect, it } from "vitest";
import { encodeBrightness, encodeMode, encodeSpeed, encodeSwitch, escapeCoolLedBytes, frameCoolLedPayload } from "../../src/drivers/coolledx/protocol";

const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ").toUpperCase();

describe("CoolLEDX framing", () => {
  it("escapes only 01, 02, and 03", () => {
    expect(hex(escapeCoolLedBytes(Uint8Array.of(0, 1, 2, 3, 4)))).toBe("00 02 05 02 06 02 07 04");
  });

  it("frames a generic payload with an escaped big-endian length", () => {
    expect(hex(frameCoolLedPayload(Uint8Array.of(0x08, 0x10)))).toBe("01 00 02 06 08 10 03");
  });

  it("reproduces pinned licensed-source control vectors", () => {
    expect(hex(encodeBrightness(0x10))).toBe("01 00 02 06 08 10 03");
    expect(hex(encodeMode(0x01))).toBe("01 00 02 06 06 02 05 03");
    expect(hex(encodeSpeed(0x10))).toBe("01 00 02 06 07 10 03");
    expect(hex(encodeSwitch(false))).toBe("01 00 02 06 09 00 03");
    expect(hex(encodeSwitch(true))).toBe("01 00 02 06 09 02 05 03");
  });

  it("generates the separated iLedHat experiment vectors", () => {
    expect(hex(encodeBrightness(0x40))).toBe("01 00 02 06 08 40 03");
    expect(hex(encodeBrightness(0xc0))).toBe("01 00 02 06 08 C0 03");
  });
});
