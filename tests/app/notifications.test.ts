import { describe, expect, it } from "vitest";
import { NotificationRouter } from "../../src/app/notifications";
import {
  notificationMatchesExpectation,
  type DecodedNotification,
} from "../../src/drivers/types";

const expected = {
  type: "notification",
  opcode: 0x1f,
  kind: "device-info",
  required: true,
  timeoutMs: 10,
  fulfillsOperation: true,
} as const;
const unrelated: DecodedNotification = {
  family: "CoolLEDUX",
  kind: "command-echo",
  opcode: 4,
  summary: "echo",
  payloadHex: "04 40",
  fields: { brightnessRaw: 64 },
};

describe("NotificationRouter", () => {
  it("does not satisfy a waiter with an unrelated notification", async () => {
    const router = new NotificationRouter();
    const armed = router.arm(expected, notificationMatchesExpectation);
    router.publish({
      timestamp: new Date().toISOString(),
      raw: new Uint8Array(),
      rawHex: "",
      decoded: unrelated,
    });
    await expect(armed.promise).rejects.toThrow(/timed out/);
  });

  it("resolves a matching decoded response", async () => {
    const router = new NotificationRouter();
    const armed = router.arm(
      { ...expected, timeoutMs: 50 },
      notificationMatchesExpectation,
    );
    const info: DecodedNotification = {
      family: "CoolLEDUX",
      kind: "device-info",
      opcode: 0x1f,
      summary: "info",
      payloadHex: "1F 01 40",
      fields: { brightnessRaw: 64 },
    };
    router.publish({
      timestamp: new Date().toISOString(),
      raw: new Uint8Array(),
      rawHex: "",
      decoded: info,
    });
    await expect(armed.promise).resolves.toBe(info);
  });
});
