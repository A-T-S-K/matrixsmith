import { describe, expect, it } from "vitest";
import type { DeviceFingerprint } from "../../src/core/device";
import type { Persistence, RiskClass } from "../../src/core/risk";
import {
  packetHex,
  prepareTransmission,
  type TargetBinding,
  type TransmissionPlan,
} from "../../src/core/transmission";
import { SafetyPolicy, type SafetyContext } from "../../src/app/safety";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { encodeBrightness } from "../../src/drivers/coolledx/protocol";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createCoolLedUxPlan } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const fingerprint = knownIledHatFingerprint();
const targetBinding: TargetBinding = {
  connectionId: "connection:test",
  fingerprintKey: "fingerprint:test",
  browserDeviceId: fingerprint.browserDeviceId ?? null,
};

function plan(overrides: Partial<TransmissionPlan> = {}) {
  const bytes = encodeBrightness(0x40);
  return prepareTransmission(
    {
      id: "plan:test",
      driverId: "coolledx",
      profileId: "iledhat-31ae-32x16",
      operation: { type: "SetBrightness", raw: 0x40 },
      risk: "transient",
      persistence: "unknown",
      validation: "experimental",
      evidenceRefs: [],
      packets: [
        {
          index: 0,
          endpoint: COOLLEDX_ENDPOINT,
          writeMode: "without-response",
          bytes,
          hex: packetHex(bytes),
        },
      ],
      responseExpectation: { type: "none" },
      execution: "live",
      purpose: "operation",
      timeoutMs: 100,
      recoveryNotes: [],
      metadata: {},
      ...overrides,
    },
    targetBinding,
  );
}

function context(overrides: Partial<SafetyContext> = {}): SafetyContext {
  return {
    source: "live",
    fingerprint,
    selectedDriverId: "coolledx",
    selectedProfileId: "iledhat-31ae-32x16",
    driverMatch: {
      driverId: "coolledx",
      score: 100,
      confidence: "exact",
      reasons: [],
      contradictions: [],
    },
    ambiguous: false,
    experimentalSessionEnabled: true,
    targetBinding,
    confirmedPlanDigest: null,
    ...overrides,
  };
}

describe("SafetyPolicy", () => {
  const policy = new SafetyPolicy();
  it("allows only the unlocked known-profile brightness experiment", () =>
    expect(policy.authorize(plan(), context()).allowed).toBe(true));
  it("blocks unknown and ambiguous drivers", () => {
    expect(
      policy.authorize(
        plan(),
        context({ selectedDriverId: null, driverMatch: null }),
      ).allowed,
    ).toBe(false);
    expect(policy.authorize(plan(), context({ ambiguous: true })).allowed).toBe(
      false,
    );
  });
  it("requires experimental session unlock", () =>
    expect(
      policy.authorize(plan(), context({ experimentalSessionEnabled: false }))
        .allowed,
    ).toBe(false));
  it("blocks unverified operations", () =>
    expect(
      policy.authorize(plan({ validation: "unverified" }), context()).allowed,
    ).toBe(false));
  it.each<[RiskClass, Persistence]>([
    ["persistent", "unknown"],
    ["destructive", "none"],
    ["firmware", "none"],
  ])("blocks %s risk", (risk, persistence) => {
    expect(
      policy.authorize(plan({ risk, persistence }), context()).allowed,
    ).toBe(false);
  });
  it("blocks imported diagnostics", () =>
    expect(
      policy.authorize(plan(), context({ source: "imported" })).allowed,
    ).toBe(false));
  it("uses explicit live capability rather than hardcoded opcodes or values", () =>
    expect(
      policy.authorize(
        plan({
          operation: { type: "SetBrightness", raw: 0x41 },
          validation: "verified",
        }),
        context(),
      ).allowed,
    ).toBe(true));
  it("blocks driver-declared dry-run plans", () =>
    expect(
      policy.authorize(
        plan({ execution: "dry-run-only", validation: "verified" }),
        context(),
      ).allowed,
    ).toBe(false));
  it("requires the exact endpoint property", () => {
    const noWrite: DeviceFingerprint = {
      ...fingerprint,
      services: fingerprint.services.map((service) => ({
        ...service,
        characteristics: service.characteristics.map((characteristic) => ({
          ...characteristic,
          properties: {
            ...characteristic.properties,
            writeWithoutResponse: false,
          },
        })),
      })),
    };
    expect(
      policy.authorize(plan(), context({ fingerprint: noWrite })).allowed,
    ).toBe(false);
  });
  it("rejects a prepared plan after its packet bytes change", () => {
    const prepared = plan();
    prepared.packets[0]!.bytes[0] = prepared.packets[0]!.bytes[0]! ^ 0xff;
    expect(policy.authorize(prepared, context()).reasons.join(" ")).toMatch(
      /changed after its digest/i,
    );
  });
  it("binds authorization to the connection generation and browser device", () => {
    const prepared = plan();
    expect(
      policy.authorize(
        prepared,
        context({
          targetBinding: { ...targetBinding, connectionId: "connection:new" },
        }),
      ).allowed,
    ).toBe(false);
    expect(
      policy.authorize(
        prepared,
        context({
          targetBinding: { ...targetBinding, browserDeviceId: "another-unit" },
        }),
      ).allowed,
    ).toBe(false);
  });
  it("digests target, safety, write mode, bytes, pacing, and consequence", () => {
    const baseline = plan();
    const variants = [
      plan({ risk: "read-only" }),
      plan({
        packets: [{ ...baseline.packets[0]!, writeMode: "with-response" }],
      }),
      plan({ packets: [{ ...baseline.packets[0]!, delayAfterMs: 9 }] }),
      plan({ operation: { type: "SetBrightness", raw: 0x41 } }),
      prepareTransmission(baseline, {
        ...targetBinding,
        connectionId: "connection:other",
      }),
    ];
    expect(
      new Set([baseline.digest, ...variants.map(({ digest }) => digest)]).size,
    ).toBe(variants.length + 1);
  });
  it("confirms persistent effects by digest and gives authorization its own packet copy", () => {
    const prepared = plan({
      risk: "persistent",
      persistence: "persistent",
      validation: "experimental",
    });
    const decision = policy.authorize(
      prepared,
      context({ confirmedPlanDigest: prepared.digest }),
    );
    expect(decision.allowed).toBe(true);
    prepared.packets[0]!.bytes[0] = prepared.packets[0]!.bytes[0]! ^ 0xff;
    expect(decision.authorized!.plan.packets[0]!.bytes[0]).not.toBe(
      prepared.packets[0]!.bytes[0],
    );
  });
  it("authorizes verified routine persistent content directly while retaining digest and target checks", () => {
    const prepared = plan({
      risk: "persistent",
      persistence: "persistent",
      validation: "verified",
    });
    const decision = policy.authorize(
      prepared,
      context({ experimentalSessionEnabled: false, confirmedPlanDigest: null }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.authorized?.digest).toBe(prepared.digest);
  });
  it("allows verified CoolLEDUX device info and brightness without an experimental unlock", () => {
    const uxContext = {
      ...context({
        selectedDriverId: "coolledux",
        selectedProfileId: iledHat31aeProfile.id,
        experimentalSessionEnabled: false,
      }),
      driverMatch: {
        driverId: "coolledux",
        score: 100,
        confidence: "exact" as const,
        reasons: [],
        contradictions: [],
      },
    };
    const driverContext = {
      profile: iledHat31aeProfile,
      fingerprint,
      source: "live" as const,
    };
    expect(
      policy.authorize(
        prepareTransmission(
          createCoolLedUxPlan({ type: "GetDeviceInfo" }, driverContext),
          targetBinding,
        ),
        uxContext,
      ).allowed,
    ).toBe(true);
    expect(
      policy.authorize(
        prepareTransmission(
          createCoolLedUxPlan(
            { type: "SetBrightness", raw: 0x80 },
            driverContext,
          ),
          targetBinding,
        ),
        uxContext,
      ).allowed,
    ).toBe(true);
    expect(
      policy.authorize(
        prepareTransmission(
          createCoolLedUxPlan({ type: "SetPower", on: true }, driverContext),
          targetBinding,
        ),
        uxContext,
      ).allowed,
    ).toBe(false);
  });
  it("allows a verified read-only probe through ambiguity but blocks replay", () => {
    const driverContext = {
      profile: iledHat31aeProfile,
      fingerprint,
      source: "live" as const,
    };
    const probe = prepareTransmission(
      createCoolLedUxPlan({ type: "GetDeviceInfo" }, driverContext, "probe"),
      targetBinding,
    );
    const probeContext = context({
      selectedDriverId: null,
      selectedProfileId: null,
      ambiguous: true,
      experimentalSessionEnabled: false,
      driverMatch: {
        driverId: "coolledux",
        score: 75,
        confidence: "strong",
        reasons: [],
        contradictions: [],
      },
    });
    expect(policy.authorize(probe, probeContext).allowed).toBe(true);
    expect(
      policy.authorize(probe, { ...probeContext, source: "replay" }).allowed,
    ).toBe(false);
  });
});
