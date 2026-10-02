import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";

describe("connection generation lifecycle", () => {
  it("clears live authority on unexpected disconnect and restores desired notifications after reconnect", async () => {
    const transport = new FakeTransport(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport);
    await controller.connect();
    const firstPlan = controller.plan({ type: "SetBrightness", raw: 0x40 });
    await controller.enableNotifications(COOLLEDX_ENDPOINT);
    expect(transport.notificationListenerCount).toBe(1);

    transport.unexpectedDisconnect();
    expect(controller.session.fingerprint).toBeNull();
    expect(transport.notificationListenerCount).toBe(0);

    await controller.connect();
    expect(transport.notificationListenerCount).toBe(1);
    expect(controller.evaluate(firstPlan).allowed).toBe(false);
    expect(
      controller.plan({ type: "SetBrightness", raw: 0x40 }).targetBinding
        .connectionId,
    ).not.toBe(firstPlan.targetBinding.connectionId);
  });

  it("rejects advertisement enrichment that finishes for an older connection", async () => {
    const resolvers: ((
      value: import("../../src/core/device").AdvertisementObservation | null,
    ) => void)[] = [];
    class DeferredAdvertisementTransport extends FakeTransport {
      observeAdvertisements(): Promise<
        import("../../src/core/device").AdvertisementObservation | null
      > {
        return new Promise((resolve) => {
          resolvers.push((observation) => {
            if (observation && this.fingerprint)
              this.fingerprint = {
                ...this.fingerprint,
                advertisementObservation: observation,
              };
            resolve(observation);
          });
        });
      }
    }
    const transport = new DeferredAdvertisementTransport(
      knownIledHatFingerprint(),
    );
    const controller = new ApplicationRuntime(transport);
    await controller.connect();
    transport.unexpectedDisconnect();
    await controller.connect();
    resolvers[0]?.({
      capturedAt: new Date().toISOString(),
      source: "web-bluetooth-watch",
      rssi: -20,
      advertisedServiceUuids: [],
      manufacturerData: [],
      serviceData: [],
    });
    await Promise.resolve();
    expect(
      controller.session.fingerprint?.advertisementObservation,
    ).toBeUndefined();
  });
});

it("late persistent failure cannot consume replacement authority or mix its notifications into old diagnostics", async () => {
  const { vi } = await import("vitest");
  const { deferred } = await import("../helpers/deferred-gatt");
  const { diagnosticAnimation } = await import("../../src/render/patterns");
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  const pending =
    deferred<
      import("../../src/application/ports/transport").TransportReceipt
    >();
  const write = vi
    .spyOn(transport, "write")
    .mockReturnValueOnce(pending.promise);
  const plan = runtime.plan({
    type: "ShowAnimation",
    sequence: diagnosticAnimation(),
  });
  const outcome = runtime.sendPersistentContent(plan).catch((error) => error);
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await runtime.disconnect();
  await runtime.connect();
  runtime.session.enableExperimentalTx();
  runtime.session.confirmPlanDigest("new confirmation");
  runtime.session.recordNotification({
    timestamp: new Date().toISOString(),
    raw: Uint8Array.of(9),
    rawHex: "09",
    decoded: null,
  });
  const invalidations = runtime.trace.events.filter(
    (event) => event.type === "panel-program.invalidated",
  ).length;
  pending.reject(new Error("old write failed"));
  expect(await outcome).toHaveProperty("message", "old write failed");
  expect(runtime.session.experimentalTxEnabled).toBe(true);
  expect(runtime.session.confirmedPlanDigest).toBe("new confirmation");
  expect(
    runtime.trace.events.filter(
      (event) => event.type === "panel-program.invalidated",
    ),
  ).toHaveLength(invalidations);
  expect(
    runtime.transactions
      .at(-1)
      ?.packets.every((packet) => packet.direction === "TX"),
  ).toBe(true);
  await runtime.dispose();
});
