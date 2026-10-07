import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotificationRouter,
  ResponseAmbiguityError,
  ResponseCancelledError,
  type NotificationRecord,
} from "../../src/app/notifications";
import {
  notificationMatchesExpectation,
  type DecodedNotification,
} from "../../src/drivers/types";

const expected = {
  type: "notification",
  endpoints: [COOLLEDX_ENDPOINT],
  dispatchPacketIndex: 0,
  opcode: 0x1f,
  kind: "device-info",
  required: true,
  timeoutMs: 10,
  fulfillsOperation: true,
} as const;
const context = { connectionId: "live:one", generation: 1 };
const info: DecodedNotification = {
  family: "CoolLEDUX",
  kind: "device-info",
  opcode: 0x1f,
  summary: "info",
  payloadHex: "1F 01 40",
  fields: { brightnessRaw: 64 },
};
function record(
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  return {
    timestamp: new Date().toISOString(),
    raw: new Uint8Array(),
    rawHex: "",
    decoded: info,
    endpoint: COOLLEDX_ENDPOINT,
    ...overrides,
  };
}
function harness() {
  const router = new NotificationRouter();
  router.beginConnection(context);
  const matches = vi.fn(notificationMatchesExpectation);
  const arm = (expectation = expected) =>
    router.arm(expectation, matches, context.connectionId);
  const publish = (overrides: Partial<NotificationRecord> = {}) => {
    const received = router.recordLive(record(overrides), context);
    router.publish(received);
    return received;
  };
  return { router, arm, matches, publish };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("NotificationRouter", () => {
  it("does not satisfy a waiter with an unrelated notification", async () => {
    const { arm, publish } = harness();
    const armed = arm();
    armed.dispatch();
    publish({ decoded: { ...info, kind: "command-echo", opcode: 4 } });
    const outcome = expect(armed.promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("resolves the exact matching record and normalizes endpoint UUIDs", async () => {
    const { arm, publish } = harness();
    const armed = arm();
    armed.dispatch();
    const selected = publish({
      endpoint: { serviceUuid: "FFF0", characteristicUuid: " FFF1 " },
    });
    await expect(armed.promise).resolves.toBe(selected);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "wrong-endpoint",
    "missing-endpoint",
    "missing-context",
    "forged-import",
    "wrong-generation",
    "malformed",
  ])("excludes %s before invoking driver matching", async (kind) => {
    const { router, arm, matches } = harness();
    const armed = arm();
    armed.dispatch();
    const incoming = record({
      ...(kind === "wrong-endpoint"
        ? { endpoint: { ...COOLLEDX_ENDPOINT, characteristicUuid: "1234" } }
        : {}),
      ...(kind === "missing-endpoint" ? { endpoint: undefined } : {}),
      ...(kind === "malformed" ? { decoded: null } : {}),
      ...(kind === "forged-import"
        ? { connectionGeneration: 1, receiveSequence: 100 }
        : {}),
    });
    router.publish(
      kind === "missing-context" || kind === "forged-import"
        ? incoming
        : router.recordLive(
            incoming,
            kind === "wrong-generation"
              ? { ...context, generation: 0 }
              : context,
          ),
    );
    expect(matches).not.toHaveBeenCalled();
    const outcome = expect(armed.promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10);
    await outcome;
    expect(incoming.raw).toEqual(new Uint8Array());
  });
  it("excludes pre-dispatch records even when republished after dispatch", async () => {
    const { router, arm, publish, matches } = harness();
    const armed = arm();
    const before = publish();
    expect(matches).not.toHaveBeenCalled();
    // Registration has no response deadline until the reviewed dispatch.
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
    armed.dispatch();
    router.publish(before);
    expect(matches).not.toHaveBeenCalled();
    const selected = publish();
    await expect(armed.promise).resolves.toBe(selected);
    expect(selected.receiveSequence).toBe(2);
  });
  it("retires previous connection records even when the transport ID is reused", async () => {
    const { router } = harness();
    const old = router.recordLive(record(), context);
    const next = { ...context, generation: 2 };
    router.beginConnection(next);
    const matches = vi.fn(notificationMatchesExpectation);
    const armed = router.arm(expected, matches, context.connectionId);
    armed.dispatch();
    router.publish(old);
    expect(matches).not.toHaveBeenCalled();
    const selected = router.recordLive(record(), next);
    router.publish(selected);
    await expect(armed.promise).resolves.toBe(selected);
  });
  it.each(["cancel", "reset"])("settles %s and clears timers", async (kind) => {
    const { router, arm, publish } = harness();
    const armed = arm();
    armed.dispatch();
    const outcome = expect(armed.promise).rejects.toBeInstanceOf(
      ResponseCancelledError,
    );
    if (kind === "cancel") armed.cancel();
    else router.reset();
    await outcome;
    armed.cancel();
    publish();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not adopt same-signature late replies after an expired request", async () => {
    const { router, arm, publish, matches } = harness();
    const first = arm();
    first.dispatch();
    const timeout = expect(first.promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10);
    await timeout;
    const second = arm();
    second.dispatch();
    const late = publish();
    await expect(second.promise).rejects.toBeInstanceOf(ResponseAmbiguityError);
    expect(matches).not.toHaveBeenCalled();
    expect(late.decoded).toBe(info);
    expect(vi.getTimerCount()).toBe(0);
    // A distinct response signature is still usable in this connection.
    const different = router.arm(
      { ...expected, opcode: 4, kind: "command-echo" },
      notificationMatchesExpectation,
      context.connectionId,
    );
    different.dispatch();
    const echo = publish({
      decoded: { ...info, opcode: 4, kind: "command-echo" },
    });
    await expect(different.promise).resolves.toBe(echo);
    router.beginConnection(context);
    const fresh = arm();
    fresh.dispatch();
    const selected = publish();
    await expect(fresh.promise).resolves.toBe(selected);
  });
  it("cancelling before dispatch does not poison a normal exchange", async () => {
    const { arm, publish } = harness();
    const first = arm();
    first.cancel();
    await expect(first.promise).rejects.toThrow(/cancelled/);
    const next = arm();
    next.dispatch();
    await expect((publish(), next.promise)).resolves.toMatchObject({
      decoded: info,
    });
  });
  it("rejects missing endpoint and connection contracts without fallback", () => {
    const { router } = harness();
    expect(() =>
      router.arm(
        { ...expected, endpoints: [] },
        notificationMatchesExpectation,
        context.connectionId,
      ),
    ).toThrow(/endpoints/);
    router.reset();
    expect(() =>
      router.arm(
        expected,
        notificationMatchesExpectation,
        context.connectionId,
      ),
    ).toThrow(/connection context/);
  });
});
