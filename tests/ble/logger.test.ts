import { describe, expect, it } from "vitest";
import { BleLogger, toHex } from "../../src/ble/logger";

describe("BLE logger", () => {
  it("marks unknown writes as blocked", () => {
    const logger = new BleLogger();
    logger.blockedTx("protocol unavailable");
    expect(logger.entries[0]).toMatchObject({ kind: "TX", txSafety: "blocked", detail: "protocol unavailable" });
  });

  it("formats bytes as unambiguous uppercase hex", () => {
    expect(toHex(Uint8Array.of(0, 1, 15, 16, 255))).toBe("00010F10FF");
  });
});
