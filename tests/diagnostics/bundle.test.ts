import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { createDiagnosticBundle, notificationPacketsFromBundle, parseDiagnosticBundle, serializeDiagnosticBundle } from "../../src/diagnostics/bundle";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";

describe("diagnostic bundles", () => {
  it("round-trips the known device with exact raw trace hex", () => {
    const trace = new TraceRecorder();
    trace.record("notification.raw", { endpoint: "FFF1" }, Uint8Array.of(0x03, 0x00));
    const fingerprint = knownIledHatFingerprint();
    const bundle = createDiagnosticBundle({ fingerprint, driverMatches: [], selectedDriver: null, selectedProfile: null, capabilities: [], trace: trace.events, observations: [] });
    const parsed = parseDiagnosticBundle(serializeDiagnosticBundle(bundle));
    expect(parsed.fingerprint).toEqual(fingerprint);
    expect(parsed.trace[0]?.rawHex).toBe("0300");
    expect([...notificationPacketsFromBundle(parsed)[0] ?? []]).toEqual([0x03, 0x00]);
  });

  it("validates imports defensively", () => {
    expect(() => parseDiagnosticBundle("not json")).toThrow(/valid JSON/);
    expect(() => parseDiagnosticBundle('{"schemaVersion":99}')).toThrow(/schemaVersion/);
  });

  it("matches imported evidence offline and cannot transmit", async () => {
    const fingerprint = knownIledHatFingerprint();
    const controller = new MatrixController(new FakeTransport(fingerprint));
    const json = serializeDiagnosticBundle(createDiagnosticBundle({ fingerprint, driverMatches: [], selectedDriver: null, selectedProfile: null, capabilities: [], trace: [], observations: [] }));
    controller.importBundle(json);
    expect(controller.session.selection?.selected).toBeNull();
    expect(controller.session.selection?.ambiguous).toBe(true);
    expect(() => controller.plan({ type: "SetBrightness", raw: 0x40 })).toThrow(/non-ambiguous/);
  });
});
