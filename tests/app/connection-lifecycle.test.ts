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
