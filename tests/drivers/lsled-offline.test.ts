import { describe, expect, it, vi } from "vitest";
import {
  emptyFingerprint,
  type DeviceFingerprint,
} from "../../src/core/device";
import { lsledLegacyDriver, LSLED_ENDPOINT } from "../../src/drivers/lsled";
import { builtInDrivers, DriverRegistry } from "../../src/drivers/registry";
import {
  offlineReference,
  offlineRegistry,
  compileOfflineExample,
} from "../../src/app/offline-catalog";
import { compileOfflineFrame } from "../../src/application/offline-compilation";
import { SafetyPolicy } from "../../src/app/safety";
import { prepareTransmission } from "../../src/core/transmission";
import { Framebuffer } from "../../src/render/framebuffer";
import { FakeTransport } from "../../src/transport/fake";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import type { MatrixOperation } from "../../src/core/operations";
function fingerprint(
  read = true,
  notify = true,
  write = true,
): DeviceFingerprint {
  return {
    ...emptyFingerprint("fake", "LSLED"),
    services: [
      {
        uuid: "fee0",
        isPrimary: true,
        characteristics: [
          {
            uuid: "fee1",
            properties: {
              read,
              notify,
              write,
              indicate: false,
              writeWithoutResponse: false,
            },
          },
        ],
      },
    ],
  };
}
describe("LSLED independent offline contribution", () => {
  it("matches only candidates; OEM/open/next-gen clues never resolve a physical reference", () => {
    const oem = offlineRegistry.match(fingerprint());
    expect(oem.selected).toBeNull();
    expect(oem.matches[0]).toMatchObject({
      confidence: "candidate",
      contradictions: [],
    });
    expect(oem.matches[0]!.reasons.join(" ")).toContain("OEM");
    const open = {
      ...fingerprint(false, false),
      name: "LED Badge Magic",
      advertisedServices: ["f055"],
    };
    expect(lsledLegacyDriver.match(open).reasons.join(" ")).toContain(
      "open legacy",
    );
    expect(lsledLegacyDriver.match(open).reasons.join(" ")).toContain(
      "next-gen",
    );
    expect(lsledLegacyDriver.resolveProfile(open)).toBeNull();
    expect(
      lsledLegacyDriver.match(emptyFingerprint("fake", "LSLED")),
    ).toMatchObject({ confidence: "weak", contradictions: [] });
    expect(
      lsledLegacyDriver.match(fingerprint(true, false)).contradictions,
    ).not.toHaveLength(0);
    expect(
      lsledLegacyDriver.match(fingerprint(false, false, false)).confidence,
    ).toBe("none");
    expect(lsledLegacyDriver.discoveryHints()).toEqual({
      filters: [],
      optionalServices: [],
    });
    expect(builtInDrivers.some((d) => d.id === lsledLegacyDriver.id)).toBe(
      false,
    );
    expect(lsledLegacyDriver.claimEvidence!(offlineReference.profile)).toEqual(
      [],
    );
    expect(offlineReference.profile.quirks).toBeUndefined();
  });
  it("compiles semantic ShowFrame without target bindings, fabricated TX, physical claims or CoolLED metadata", () => {
    const result = compileOfflineExample("asymmetric");
    expect(result.kind).toBe("offline-planned-bytes");
    expect(result.definitionIdentity).toMatch(
      /^lsled-legacy-monochrome-reviewed-v1\/sha256:[a-f0-9]{64}$/,
    );
    expect(result.reference.sourceBasis).toHaveLength(3);
    expect(result.plan.execution).toBe("dry-run-only");
    expect(
      lsledLegacyDriver.plan(
        { type: "ShowFrame", frame: result.preview },
        {
          profile: offlineReference.profile,
          fingerprint: fingerprint(),
          source: "live",
        },
      ).execution,
    ).toBe("dry-run-only");
    expect(result.plan).not.toHaveProperty("targetBinding");
    expect(result.plan).not.toHaveProperty("contentCompilation");
    expect(result.plan.responseExpectation).toEqual({ type: "none" });
    expect(result.plan.metadata).toMatchObject({
      timing: "unknown",
      acknowledgement: "unknown",
      headerSize: 64,
      programSize: 130,
    });
    expect(result.plan.packets.map((p) => p.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    for (const packet of result.plan.packets)
      expect(packet.endpoint).toEqual(LSLED_ENDPOINT);
    expect(result.preview.getPixel(43, 10)).toEqual({ r: 255, g: 255, b: 255 });
    expect(result.preview.getPixel(43, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("rejects unsupported operations and reference substitution", () => {
    const context = {
      profile: offlineReference.profile,
      fingerprint: null,
      source: "offline" as const,
    };
    for (const operation of [
      { type: "GetDeviceInfo" },
      { type: "SetBrightness", raw: 1 },
      { type: "SetDisplayMode", mode: "static" },
      { type: "ShowAnimation" },
      { type: "ShowText", text: "a" },
      { type: "SetPower", on: true },
    ] as MatrixOperation[])
      expect(() => lsledLegacyDriver.plan(operation, context)).toThrow(
        /Unsupported/,
      );
    expect(
      lsledLegacyDriver.familyProbes!({
        fingerprint: fingerprint(),
        endpoints: [],
        source: "fake",
      }),
    ).toEqual([]);
    expect(() =>
      compileOfflineFrame(new DriverRegistry([]), offlineReference, {
        type: "ShowFrame",
        frame: new Framebuffer(44, 11),
      }),
    ).toThrow(/registered/);
    expect(() =>
      lsledLegacyDriver.plan(
        { type: "ShowFrame", frame: new Framebuffer(44, 11) },
        { ...context, profile: { ...offlineReference.profile } },
      ),
    ).toThrow(/reference/);
    const frame = new Framebuffer(44, 11);
    frame.setPixel(0, 0, 1, 1, 1);
    expect(() =>
      compileOfflineFrame(offlineRegistry, offlineReference, {
        type: "ShowFrame",
        frame,
      }),
    ).toThrow(/black\/white/);
    frame.setPixel(0, 0, 255, 0, 0);
    expect(() =>
      compileOfflineFrame(offlineRegistry, offlineReference, {
        type: "ShowFrame",
        frame,
      }),
    ).toThrow();
    expect(() =>
      compileOfflineFrame(offlineRegistry, offlineReference, {
        type: "ShowFrame",
        frame: new Framebuffer(48, 11),
      }),
    ).toThrow();
    const liveDriver = {
      ...lsledLegacyDriver,
      plan: (
        op: MatrixOperation,
        ctx: Parameters<typeof lsledLegacyDriver.plan>[1],
      ) => ({ ...lsledLegacyDriver.plan(op, ctx), execution: "live" as const }),
    };
    expect(() =>
      compileOfflineFrame(new DriverRegistry([liveDriver]), offlineReference, {
        type: "ShowFrame",
        frame: new Framebuffer(44, 11),
      }),
    ).toThrow(/dry-run/);
  });
  it("central policy independently rejects dry-run intent even with connected-looking live context, unlock and exact persistent confirmation", () => {
    const binding = {
      connectionId: "test",
      fingerprintKey: "test",
      browserDeviceId: null,
    };
    const prepared = prepareTransmission(
      compileOfflineExample("blank").plan,
      binding,
    );
    // Remove other conservative blockers to prove dry-run is an independent gate.
    const permissive = prepareTransmission(
      { ...prepared, validation: "experimental", persistence: "persistent" },
      binding,
    );
    const decision = new SafetyPolicy().authorize(permissive, {
      source: "live",
      fingerprint: fingerprint(),
      selectedDriverId: permissive.driverId,
      selectedProfileId: permissive.profileId,
      driverMatch: {
        driverId: permissive.driverId,
        score: 100,
        confidence: "exact",
        reasons: [],
        contradictions: [],
      },
      ambiguous: false,
      experimentalSessionEnabled: true,
      targetBinding: binding,
      confirmedPlanDigest: permissive.digest,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual([
      "The driver marked this plan dry-run-only.",
    ]);
  });
  it("compilation has zero transport activity and ordinary send cannot execute its result", async () => {
    const transport = new FakeTransport(fingerprint());
    const runtime = new ApplicationRuntime(
      transport,
      new TraceRecorder(),
      offlineRegistry,
    );
    await runtime.connect();
    const read = vi.spyOn(transport, "read");
    const subscribe = vi.spyOn(transport, "subscribe");
    const write = vi.spyOn(transport, "write");
    const prior = JSON.stringify(runtime.session);
    const priorEvents = runtime.trace.events.length;
    const priorTransactions = runtime.transactions.length;
    const priorCompilations = runtime.contentCompilations.length;
    const result = compileOfflineExample("checkerboard");
    expect(JSON.stringify(runtime.session)).toBe(prior);
    expect(runtime.trace.events).toHaveLength(priorEvents);
    expect(runtime.transactions).toHaveLength(priorTransactions);
    expect(runtime.contentCompilations).toHaveLength(priorCompilations);
    expect(read).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await expect(runtime.send(result.plan)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    const binding = {
      connectionId: transport.connectionId!,
      fingerprintKey: "connected-test",
      browserDeviceId: null,
    };
    const prepared = prepareTransmission(result.plan, binding);
    await expect(
      runtime.sendPersistentContent(prepared, { confirmedConsequence: true }),
    ).rejects.toThrow();
    expect(subscribe).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(runtime.transactions).toHaveLength(priorTransactions);
    expect(runtime.contentCompilations).toHaveLength(priorCompilations);
    expect(transport.writes).toEqual([]);
    await runtime.disconnect();
  });
});
