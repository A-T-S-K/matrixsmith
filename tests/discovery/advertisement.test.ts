import { describe, expect, it } from "vitest";
import { extractAdvertisementFacts, parseHexBytes } from "../../src/discovery/advertisement";

const CAPTURE = "0201060303F0FF0EFFAE315EEA07000001100020031E0809694C6564486174";

describe("advertisement fact extraction", () => {
  it("extracts only facts encoded in the AD structures", () => {
    expect(extractAdvertisementFacts(parseHexBytes(CAPTURE))).toEqual({
      flags: 0x06,
      serviceUuids16: ["FFF0"],
      localName: "iLedHat",
      manufacturerDataHex: "AE315EEA07000001100020031E",
      manufacturerCompanyFieldHex: "AE31",
    });
  });
});
