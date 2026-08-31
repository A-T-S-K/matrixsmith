import { describe, expect, it } from "vitest";
import { parseCoolLedManufacturerData } from "../../src/drivers/coolled/common/advertisement";
import { parseHexBytes } from "../../src/discovery/advertisement";

describe("iLedHat manufacturer layout", () => {
  it("extracts conservative raw metadata without calling the identifier a MAC", () => {
    const result = parseCoolLedManufacturerData(parseHexBytes("AE315EEA07000001100020031E"));
    expect(result).toMatchObject({ companyId: 0x31ae, height: 16, width: 32, colorModeRaw: 3, firmwareRaw: 30 });
    expect([...(result?.deviceIdentifierBytes ?? [])].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()).toBe("5EEA07000001");
  });
});
