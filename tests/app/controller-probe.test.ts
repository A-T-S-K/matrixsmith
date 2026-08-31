import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { FakeTransport } from "../../src/transport/fake";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";

const INFO = infoFixture.rxHex;

describe("active protocol probing", () => {
  it("uses an explicit safe 0x1F response to resolve CoolLEDUX and retain raw RX", async () => {
    const transport = new FakeTransport(knownIledHatFingerprint());
    const controller = new MatrixController(transport, new TraceRecorder());
    await controller.connect();
    expect(controller.session.selection?.ambiguous).toBe(true);
    transport.notificationOnWrite = parseHexBytes(INFO);
    const result = await controller.probe();
    expect(result.protocolAcknowledged).toBe(true);
    expect(result.deviceStateVerified).toBe(true);
    expect(controller.session.selection?.selected?.id).toBe("coolledux");
    expect(controller.session.profile?.driverId).toBe("coolledux");
    expect(controller.session.notifications[0]?.rawHex.replaceAll(" ", "")).toBe(INFO);
    expect(controller.session.latestDeviceInfo?.fields.brightnessRaw).toBe(0xcc);
  });

  it("replays captured protocol resolution offline without allowing TX", async () => {
    const liveTransport = new FakeTransport(knownIledHatFingerprint());
    const live = new MatrixController(liveTransport, new TraceRecorder());
    await live.connect();
    liveTransport.notificationOnWrite = parseHexBytes(INFO);
    await live.probe();
    const imported = new MatrixController(new FakeTransport(), new TraceRecorder());
    imported.importBundle(live.exportBundle());
    expect(imported.session.source).toBe("imported");
    expect(imported.session.selection?.selected?.id).toBe("coolledux");
    const plan = imported.plan({ type: "GetDeviceInfo" });
    expect(imported.evaluate(plan).allowed).toBe(false);
  });
});
