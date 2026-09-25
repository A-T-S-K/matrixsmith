import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { FakeTransport } from "../../src/transport/fake";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";

const INFO = infoFixture.rxHex;

describe("active protocol probing", () => {
  it("keeps 0x1F available as an optional refresh on the already-known profile", async () => {
    const transport = new FakeTransport(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport, new TraceRecorder());
    await controller.connect();
    // The characterized profile resolves from its own evidence, so the probe
    // is no longer a gate — it still runs, and still refreshes device state.
    expect(controller.session.selection?.ambiguous).toBe(false);
    expect(controller.session.selection?.selected?.id).toBe("coolledux");
    transport.notificationOnWrite = parseHexBytes(INFO);
    const result = await controller.probe();
    expect(result.protocolAcknowledged).toBe(true);
    expect(result.deviceStateVerified).toBe(true);
    expect(controller.session.selection?.selected?.id).toBe("coolledux");
    expect(controller.session.profile?.driverId).toBe("coolledux");
    expect(
      controller.session.notifications[0]?.rawHex.replaceAll(" ", ""),
    ).toBe(INFO);
    expect(controller.session.latestDeviceInfo?.fields.brightnessRaw).toBe(
      0xcc,
    );
    const rx = controller.transactions[0]?.packets.find(
      ({ direction }) => direction === "RX",
    );
    expect(rx?.endpoint).toEqual({
      serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
      characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
    });
    expect(rx?.relation).toBe("matched-response");
  });

  it("replays captured protocol resolution offline without allowing TX", async () => {
    const liveTransport = new FakeTransport(knownIledHatFingerprint());
    const live = new ApplicationRuntime(liveTransport, new TraceRecorder());
    await live.connect();
    liveTransport.notificationOnWrite = parseHexBytes(INFO);
    await live.probe();
    const imported = new ApplicationRuntime(
      new FakeTransport(),
      new TraceRecorder(),
    );
    imported.importBundle(live.exportBundle());
    expect(imported.session.source).toBe("imported");
    expect(imported.session.selection?.selected?.id).toBe("coolledux");
    expect(() => imported.plan({ type: "GetDeviceInfo" })).toThrow(
      /live connected physical target/i,
    );
  });
});
