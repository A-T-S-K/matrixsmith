import { describe, expect, it, vi } from "vitest";
import { encodeMatrixState } from "../../src/drivers/microbit/codec";
import {
  microbitLedDriver,
  MICROBIT_LED_ENDPOINT,
} from "../../src/drivers/microbit";
import {
  microbitEntry,
  microbitReference,
  microbitRegistry,
} from "../../src/app/offline-entries/microbit";
import { compileOfflineFrame } from "../../src/application/offline-compilation";
import { builtInDrivers } from "../../src/drivers/registry";
import { emptyFingerprint } from "../../src/core/device";
import { Framebuffer } from "../../src/render/framebuffer";
import type { MatrixOperation } from "../../src/core/operations";
import { prepareTransmission } from "../../src/core/transmission";
import { SafetyPolicy } from "../../src/app/safety";
import { FakeTransport } from "../../src/transport/fake";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";

// Independently authored octets for every position; no encoder-derived oracle.
const singlePixelValues = [
  [0x10, 0, 0, 0, 0],
  [0x08, 0, 0, 0, 0],
  [0x04, 0, 0, 0, 0],
  [0x02, 0, 0, 0, 0],
  [0x01, 0, 0, 0, 0],
  [0, 0x10, 0, 0, 0],
  [0, 0x08, 0, 0, 0],
  [0, 0x04, 0, 0, 0],
  [0, 0x02, 0, 0, 0],
  [0, 0x01, 0, 0, 0],
  [0, 0, 0x10, 0, 0],
  [0, 0, 0x08, 0, 0],
  [0, 0, 0x04, 0, 0],
  [0, 0, 0x02, 0, 0],
  [0, 0, 0x01, 0, 0],
  [0, 0, 0, 0x10, 0],
  [0, 0, 0, 0x08, 0],
  [0, 0, 0, 0x04, 0],
  [0, 0, 0, 0x02, 0],
  [0, 0, 0, 0x01, 0],
  [0, 0, 0, 0, 0x10],
  [0, 0, 0, 0, 0x08],
  [0, 0, 0, 0, 0x04],
  [0, 0, 0, 0, 0x02],
  [0, 0, 0, 0, 0x01],
];
const context = {
  profile: microbitReference.profile,
  fingerprint: null,
  source: "offline" as const,
};
describe("pinned DAL LED Matrix State offline reference", () => {
  it("matches literal blank/full/asymmetric and all 25 pixel vectors", () => {
    for (const [name, expected] of [
      ["blank", [0, 0, 0, 0, 0]],
      ["full", [31, 31, 31, 31, 31]],
      ["asymmetric", [16, 1, 8, 4, 18]],
    ] as const) {
      const result = microbitEntry.compile(name);
      expect([...result.plan.packets[0]!.bytes]).toEqual(expected);
      expect(result.plan.packets).toHaveLength(1);
      expect(result.plan.packets[0]!.endpoint).toEqual(MICROBIT_LED_ENDPOINT);
      expect(result.plan.packets[0]!.writeMode).toBe("with-response");
    }
    singlePixelValues.forEach((expected, position) => {
      const pixels = new Uint8Array(25);
      pixels[position] = 1;
      const encoded = encodeMatrixState({ width: 5, height: 5, pixels });
      expect([...encoded]).toEqual(expected);
      expect(encoded.every((byte) => (byte & 0xe0) === 0)).toBe(true);
    });
  });
  it("rejects geometry/count/value failures before iterating oversized input", () => {
    const pixels = new Uint8Array(25);
    for (const [width, height] of [
      [4, 5],
      [5, 6],
      [NaN, 5],
      [1e9, 1e9],
    ])
      expect(() =>
        encodeMatrixState({ width: width!, height: height!, pixels }),
      ).toThrow(/5×5/);
    for (const length of [0, 24, 26, 1e9]) {
      const forbidden = new Proxy(
        { length },
        {
          get(target, key) {
            if (key !== "length") throw Error("iterated invalid buffer");
            return target.length;
          },
        },
      );
      expect(() =>
        encodeMatrixState({
          width: 5,
          height: 5,
          pixels: forbidden as unknown as ArrayLike<number>,
        }),
      ).toThrow(/25 binary/);
    }
    for (const value of [2, -1, 255, NaN, 0.5]) {
      const bad = Array<number>(25).fill(0);
      bad[24] = value;
      expect(() =>
        encodeMatrixState({ width: 5, height: 5, pixels: bad }),
      ).toThrow(/binary/);
    }
    const frame = new Framebuffer(5, 5);
    frame.setPixel(0, 0, 1, 1, 1);
    expect(() =>
      microbitLedDriver.plan({ type: "ShowFrame", frame }, context),
    ).toThrow(/black\/white/);
    frame.setPixel(0, 0, 255, 0, 0);
    expect(() =>
      microbitLedDriver.plan({ type: "ShowFrame", frame }, context),
    ).toThrow();
    for (const length of [74, 76]) {
      Object.defineProperty(frame, "data", {
        value: new Uint8Array(length),
        configurable: true,
      });
      expect(() =>
        microbitLedDriver.plan({ type: "ShowFrame", frame }, context),
      ).toThrow(/5×5/);
    }
    for (const type of [
      "ShowText",
      "ShowAnimation",
      "SetBrightness",
      "SetPower",
      "GetDeviceInfo",
      "SetDisplayMode",
    ])
      expect(() =>
        microbitLedDriver.plan({ type } as MatrixOperation, context),
      ).toThrow(/Unsupported/);
    expect(() =>
      microbitLedDriver.plan(
        { type: "ShowFrame", frame: new Framebuffer(6, 5) },
        context,
      ),
    ).toThrow();
    expect(() =>
      microbitLedDriver.plan(
        { type: "ShowFrame", frame: new Framebuffer(5, 5) },
        { ...context, profile: { ...context.profile } },
      ),
    ).toThrow(/reference/);
  });
  it("is isolated from discovery, physical claims and borrowed delivery metadata", () => {
    expect(builtInDrivers.some((d) => d.id === microbitLedDriver.id)).toBe(
      false,
    );
    expect(microbitLedDriver.discoveryHints()).toEqual({
      filters: [],
      optionalServices: [],
    });
    const fp = {
      ...emptyFingerprint("fake", "BBC micro:bit"),
      advertisedServices: [MICROBIT_LED_ENDPOINT.serviceUuid],
    };
    expect(microbitRegistry.match(fp).selected).toBeNull();
    expect(microbitLedDriver.resolveProfile(fp)).toBeNull();
    expect(
      microbitLedDriver.familyProbes!({
        fingerprint: fp,
        endpoints: [],
        source: "fake",
      }),
    ).toEqual([]);
    expect(microbitLedDriver.probes!(context)).toEqual([]);
    expect(microbitLedDriver.claimEvidence!(context.profile)).toEqual([]);
    const result = microbitEntry.compile("asymmetric");
    expect(result.definitionIdentity).toMatch(
      /^microbit-dal-led-matrix-reviewed-v1\/sha256:[a-f0-9]{64}$/,
    );
    expect(result.plan.metadata.delivery).toBe("direct-characteristic-value");
    expect(result.plan.metadata.consequence).toContain(
      "stops display animation",
    );
    expect(result.plan.persistence).toBe("unknown");
    expect(result.plan.responseExpectation).toEqual({ type: "none" });
    for (const field of [
      "headerSize",
      "programSize",
      "paddingSize",
      "crc",
      "compression",
      "targetBinding",
      "contentCompilation",
    ]) {
      expect(result.plan.metadata).not.toHaveProperty(field);
      expect(result.plan).not.toHaveProperty(field);
    }
    expect(JSON.stringify(result)).not.toMatch(
      /Graffiti|LZSS|CoolLED|authorizedAt/,
    );
    expect(() =>
      compileOfflineFrame(
        microbitRegistry,
        {
          ...microbitReference,
          implementation: "lsled-legacy-monochrome-reviewed-v1",
        },
        { type: "ShowFrame", frame: new Framebuffer(5, 5) },
      ),
    ).toThrow(/registered/);
  });
  it("retains independent deterministic buffers after input mutation and later compilation", () => {
    const frame = new Framebuffer(5, 5);
    frame.setPixel(0, 0, 255, 255, 255);
    const first = compileOfflineFrame(microbitRegistry, microbitReference, {
      type: "ShowFrame",
      frame,
    });
    frame.data.fill(0);
    const later = microbitEntry.compile("full");
    later.plan.packets[0]!.bytes.fill(0);
    expect(first.preview.getPixel(0, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect([...first.plan.packets[0]!.bytes]).toEqual([16, 0, 0, 0, 0]);
    expect(microbitEntry.compile("full").plan.packets[0]!.hex).toBe(
      "1F 1F 1F 1F 1F",
    );
  });
  it("keeps dry-run intent in every context and policy rejects even with unlock/confirmation", () => {
    const fp = emptyFingerprint("fake", "micro:bit");
    const binding = {
      connectionId: "test",
      fingerprintKey: "test",
      browserDeviceId: null,
    };
    const plan = microbitLedDriver.plan(
      { type: "ShowFrame", frame: new Framebuffer(5, 5) },
      { ...context, source: "live", fingerprint: fp },
    );
    expect(plan.execution).toBe("dry-run-only");
    const prepared = prepareTransmission(
      { ...plan, validation: "experimental", persistence: "persistent" },
      binding,
    );
    const decision = new SafetyPolicy().authorize(prepared, {
      source: "live",
      fingerprint: fp,
      selectedDriverId: plan.driverId,
      selectedProfileId: plan.profileId,
      driverMatch: {
        driverId: plan.driverId,
        score: 100,
        confidence: "exact",
        reasons: [],
        contradictions: [],
      },
      ambiguous: false,
      experimentalSessionEnabled: true,
      targetBinding: binding,
      confirmedPlanDigest: prepared.digest,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "The driver marked this plan dry-run-only.",
    );
  });
  it("compiles without transport activity or evidence mutation and ordinary execution rejects", async () => {
    const transport = new FakeTransport(emptyFingerprint("fake", "micro:bit"));
    const runtime = new ApplicationRuntime(
      transport,
      new TraceRecorder(),
      microbitRegistry,
    );
    await runtime.connect();
    const read = vi.spyOn(transport, "read"),
      write = vi.spyOn(transport, "write"),
      subscribe = vi.spyOn(transport, "subscribe");
    const before = JSON.stringify([
      runtime.session,
      runtime.trace.events,
      runtime.transactions,
      runtime.contentCompilations,
    ]);
    const result = microbitEntry.compile("asymmetric");
    expect(
      JSON.stringify([
        runtime.session,
        runtime.trace.events,
        runtime.transactions,
        runtime.contentCompilations,
      ]),
    ).toBe(before);
    await expect(runtime.send(result.plan)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(runtime.transactions).toHaveLength(0);
    await runtime.disconnect();
  });
});
