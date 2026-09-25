import { describe, expect, it } from "vitest";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { decodeEnvelope } from "../../src/drivers/coolled/common/envelope";
import { decodeCoolLedNotification } from "../../src/drivers/coolledx/notifications";
import { decodeCoolLedUxNotification } from "../../src/drivers/coolledux/notifications";
import {
  encodeBrightness,
  encodeDeviceInfoQuery,
} from "../../src/drivers/coolledux/protocol";
import infoCc from "../fixtures/iledhat/coolledux-device-info-cc.json";
import info40 from "../fixtures/iledhat/coolledux-device-info-40.json";
import classicRejection from "../fixtures/iledhat/coolledx-brightness-rejection.json";

describe("CoolLEDUX direct protocol", () => {
  const compactHex = (bytes: Uint8Array): string =>
    [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  it("encodes exact golden commands", () => {
    expect(compactHex(encodeBrightness(0x40))).toBe("01000206044003");
    expect(compactHex(encodeBrightness(0xcc))).toBe("0100020604CC03");
    expect(compactHex(encodeDeviceInfoQuery())).toBe("010002051F03");
  });
  it.each([
    [infoCc.rxHex, 0xcc],
    [info40.rxHex, 0x40],
  ])("decodes the 48-byte hardware device-info response", (raw, brightness) => {
    expect(decodeEnvelope(parseHexBytes(raw)).payload).toHaveLength(48);
    const decoded = decodeCoolLedUxNotification(parseHexBytes(raw));
    expect(decoded?.kind).toBe("device-info");
    expect(decoded?.fields).toMatchObject({
      payloadLength: 48,
      powerRaw: 1,
      powerOn: true,
      brightnessRaw: brightness,
    });
    expect(decoded?.unknownTailHex).toBeTruthy();
  });
  it("accepts a variable-length known prefix and rejects a truncated one conservatively", () => {
    expect(
      decodeCoolLedUxNotification(parseHexBytes("0100041F0205405503"))?.kind,
    ).toBe("device-info");
    expect(
      decodeCoolLedUxNotification(parseHexBytes("010002061F020503"))?.kind,
    ).toBe("malformed-device-info");
  });
  it("decodes a brightness echo", () =>
    expect(
      decodeCoolLedUxNotification(parseHexBytes("01000206044003"))?.fields
        .brightnessRaw,
    ).toBe(0x40));
  it("preserves classic 08 FE as rejection-like with unmapped semantics", () => {
    const decoded = decodeCoolLedNotification(
      parseHexBytes(classicRejection.rxHex),
    );
    expect(decoded).toMatchObject({
      family: "CoolLEDX",
      opcode: 8,
      status: 0xfe,
      success: false,
    });
    expect(decoded?.summary).toMatch(/exact semantics unmapped/);
  });
});
