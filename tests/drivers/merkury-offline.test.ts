import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { encodeRgbBlocks } from "../../src/drivers/merkury/codec";
import { merkuryRgbDriver, MERKURY_ENDPOINT } from "../../src/drivers/merkury";
import {
  merkuryEntry,
  merkuryReference,
  merkuryRegistry,
} from "../../src/app/offline-entries/merkury";
import { compileOfflineFrame } from "../../src/application/offline-compilation";
import { Framebuffer } from "../../src/render/framebuffer";
import { emptyFingerprint } from "../../src/core/device";
import type { MatrixOperation } from "../../src/core/operations";
import { prepareTransmission } from "../../src/core/transmission";
import { SafetyPolicy } from "../../src/app/safety";
import { FakeTransport } from "../../src/transport/fake";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { builtInDrivers } from "../../src/drivers/registry";

const positions: { x: number; y: number; block: number; offset: number }[] =
  JSON.parse(
    readFileSync(
      new URL("../fixtures/merkury/positions.json", import.meta.url),
      "utf8",
    ),
  );
const context = {
  profile: merkuryReference.profile,
  fingerprint: null,
  source: "offline" as const,
};
// Hand-authored first block of upstream create_picture(1): x*16, y*16, 255.
// This literal does not call this encoder or copy upstream program code.
const gradientBlock = [
  0xbc, 0x0f, 1, 0, 0, 255, 16, 0, 255, 32, 0, 255, 48, 0, 255, 64, 0, 255, 80,
  0, 255, 96, 0, 255, 112, 0, 255, 128, 0, 255, 144, 0, 255, 160, 0, 255, 176,
  0, 255, 192, 0, 255, 208, 0, 255, 224, 0, 255, 240, 0, 255, 0, 16, 255, 16,
  16, 255, 32, 16, 255, 48, 16, 255, 64, 16, 255, 80, 16, 255, 96, 16, 255, 112,
  16, 255, 128, 16, 255, 144, 16, 255, 160, 16, 255, 176, 16, 255, 192, 16, 255,
  208, 16, 255, 224, 16, 255, 240, 16, 255, 0x55,
];
describe("Merkury source-scoped offline RGB blocks", () => {
  it("matches original-source gradient literal, blank/full and boundary markers", () => {
    expect([
      ...merkuryEntry.compile("rgb-gradient").plan.packets[0]!.bytes,
    ]).toEqual(gradientBlock);
    for (const [name, value] of [
      ["blank", 0],
      ["full", 255],
    ] as const) {
      const plan = merkuryEntry.compile(name).plan;
      expect(plan.packets).toHaveLength(8);
      plan.packets.forEach((p, i) => {
        expect([...p.bytes]).toEqual([
          0xbc,
          0x0f,
          i + 1,
          ...Array<number>(96).fill(value),
          0x55,
        ]);
        expect(p.endpoint).toEqual(MERKURY_ENDPOINT);
        expect(p.delayAfterMs).toBe(20);
        expect(p.writeMode).toBe("with-response");
      });
    }
    const marker = merkuryEntry.compile("asymmetric").plan.packets;
    expect([...marker[0]!.bytes.slice(3, 6)]).toEqual([255, 0, 0]);
    expect([...marker[0]!.bytes.slice(96, 99)]).toEqual([0, 255, 0]);
    expect([...marker[1]!.bytes.slice(3, 6)]).toEqual([0, 0, 255]);
    expect([...marker[7]!.bytes.slice(96, 99)]).toEqual([17, 34, 51]);
  });
  it("places every RGB pixel against an independently authored literal location table", () => {
    expect(positions).toHaveLength(256);
    expect(new Set(positions.map(({ x, y }) => `${x},${y}`)).size).toBe(256);
    for (const { x, y, block, offset } of positions) {
      const frame = new Framebuffer(16, 16);
      frame.setPixel(x, y, 0xbc, 0x55, 0x0f);
      const plan = compileOfflineFrame(merkuryRegistry, merkuryReference, {
        type: "ShowFrame",
        frame,
      }).plan;
      plan.packets.forEach((packet, index) => {
        const expected = new Uint8Array([
          0xbc,
          0x0f,
          index + 1,
          ...Array<number>(96).fill(0),
          0x55,
        ]);
        if (index === block) expected.set([0xbc, 0x55, 0x0f], offset);
        expect(packet.bytes).toEqual(expected);
      });
    }
  });
  it("rejects wrong dimensions/counts, invalid channels and unsupported operations", () => {
    for (const [width, height] of [
      [15, 16],
      [16, 15],
      [32, 8],
      [16.5, 16],
      [NaN, 16],
    ])
      expect(() =>
        encodeRgbBlocks({
          width: width!,
          height: height!,
          data: new Uint8Array(768),
        }),
      ).toThrow(/16×16/);
    for (const length of [0, 767, 769])
      expect(() =>
        encodeRgbBlocks({
          width: 16,
          height: 16,
          data: new Uint8Array(length),
        }),
      ).toThrow(/768/);
    for (const value of [-1, 256, 1.5, NaN, Infinity, undefined]) {
      const data = Array<number | undefined>(768).fill(0);
      data[95] = value;
      expect(() =>
        encodeRgbBlocks({ width: 16, height: 16, data: data as number[] }),
      ).toThrow(/integer bytes/);
    }
    const sparse = Array<number>(768);
    expect(() =>
      encodeRgbBlocks({ width: 16, height: 16, data: sparse }),
    ).toThrow();
    for (const type of [
      "ShowText",
      "ShowAnimation",
      "SetBrightness",
      "SetPower",
      "GetDeviceInfo",
      "SetDisplayMode",
    ])
      expect(() =>
        merkuryRgbDriver.plan({ type } as MatrixOperation, context),
      ).toThrow(/Unsupported/);
    const frame = new Framebuffer(16, 16);
    expect(() =>
      merkuryRgbDriver.plan(
        { type: "ShowFrame", frame },
        { ...context, profile: { ...context.profile } },
      ),
    ).toThrow(/reference/);
    expect(() => merkuryEntry.compile("../arbitrary")).toThrow(/example/);
    expect(() =>
      compileOfflineFrame(
        merkuryRegistry,
        { ...merkuryReference, implementation: "foreign" },
        { type: "ShowFrame", frame },
      ),
    ).toThrow(/registered/);
    for (const length of [767, 769]) {
      Object.defineProperty(frame, "data", {
        value: new Uint8Array(length),
        configurable: true,
      });
      expect(() =>
        merkuryRgbDriver.plan({ type: "ShowFrame", frame }, context),
      ).toThrow(/768/);
    }
  });
  it("has deterministic independent input, preview, packet and later-compilation buffers", () => {
    const frame = new Framebuffer(16, 16);
    frame.setPixel(0, 0, 17, 34, 51);
    const first = compileOfflineFrame(merkuryRegistry, merkuryReference, {
      type: "ShowFrame",
      frame,
    });
    frame.clear();
    expect(first.preview.getPixel(0, 0)).toEqual({ r: 17, g: 34, b: 51 });
    first.preview.clear();
    const later = merkuryEntry.compile("full");
    later.plan.packets[0]!.bytes.fill(0);
    expect([...first.plan.packets[0]!.bytes.slice(3, 6)]).toEqual([17, 34, 51]);
    first.plan.packets[0]!.bytes.fill(0);
    expect(first.plan.packets[1]!.bytes[0]).toBe(0xbc);
    expect(merkuryEntry.compile("rgb-gradient")).toEqual(
      merkuryEntry.compile("rgb-gradient"),
    );
    const direct = encodeRgbBlocks({
      width: 16,
      height: 16,
      data: new Uint8Array(768),
    });
    direct[0]!.fill(255);
    expect(direct[1]![3]).toBe(0);
  });
  it("offers no physical claims or discovery and no borrowed checksum/storage contract", () => {
    expect(builtInDrivers.some((d) => d.id === merkuryRgbDriver.id)).toBe(
      false,
    );
    expect(merkuryRgbDriver.discoveryHints()).toEqual({
      filters: [],
      optionalServices: [],
    });
    const fp = {
      ...emptyFingerprint("fake", "MI Matrix Display"),
      advertisedServices: [MERKURY_ENDPOINT.serviceUuid],
    };
    expect(merkuryRegistry.match(fp).selected).toBeNull();
    expect(merkuryRgbDriver.resolveProfile(fp)).toBeNull();
    expect(merkuryRgbDriver.operations({} as never)).toEqual([]);
    expect(merkuryRgbDriver.familyProbes!({} as never)).toEqual([]);
    expect(merkuryRgbDriver.probes!(context)).toEqual([]);
    expect(merkuryRgbDriver.guidedTests!(context.profile)).toEqual([]);
    expect(merkuryRgbDriver.claimEvidence!(context.profile)).toEqual([]);
    const result = merkuryEntry.compile("blank");
    expect(result.definitionIdentity).toMatch(
      /^merkury-mi-lnl62-rgb-blocks-reviewed-v1\/sha256:[a-f0-9]{64}$/,
    );
    expect(result.plan.persistence).toBe("unknown");
    expect(result.plan.responseExpectation).toEqual({ type: "none" });
    for (const field of [
      "crc",
      "compression",
      "targetBinding",
      "contentCompilation",
    ])
      expect(result.plan.metadata).not.toHaveProperty(field);
    expect(JSON.stringify(result)).not.toMatch(/CoolLED|LZSS|authorizedAt/);
  });
  it("stays dry-run-only across all contexts and rejects exact permission/confirmation", () => {
    const fp = emptyFingerprint("fake", "MI Matrix Display");
    const binding = {
      connectionId: "test",
      fingerprintKey: "test",
      browserDeviceId: null,
    };
    for (const source of [
      "offline",
      "live",
      "fake",
      "imported",
      "replay",
    ] as const) {
      const plan = merkuryRgbDriver.plan(
        { type: "ShowFrame", frame: new Framebuffer(16, 16) },
        { ...context, source, fingerprint: source === "offline" ? null : fp },
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
    }
  });
  it("compiles without transport/evidence changes and ordinary execution cannot dispatch", async () => {
    const transport = new FakeTransport(
      emptyFingerprint("fake", "MI Matrix Display"),
    );
    const runtime = new ApplicationRuntime(
      transport,
      new TraceRecorder(),
      merkuryRegistry,
    );
    await runtime.connect();
    const read = vi.spyOn(transport, "read"),
      write = vi.spyOn(transport, "write"),
      subscribe = vi.spyOn(transport, "subscribe");
    const state = () =>
      JSON.stringify([
        runtime.session,
        runtime.trace.events,
        runtime.transactions,
        runtime.contentCompilations,
      ]);
    const before = state();
    const result = merkuryEntry.compile("asymmetric");
    expect(state()).toBe(before);
    await expect(runtime.send(result.plan)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(runtime.transactions).toHaveLength(0);
    await runtime.disconnect();
  });
});
