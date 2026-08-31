import { describe, expect, it } from "vitest";
import type { DeviceFingerprint } from "../../src/core/device";
import type { Persistence, RiskClass } from "../../src/core/risk";
import { packetHex, type TransmissionPlan } from "../../src/core/transmission";
import { SafetyPolicy, type SafetyContext } from "../../src/app/safety";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { encodeBrightness } from "../../src/drivers/coolledx/protocol";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createCoolLedUxPlan } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const fingerprint = knownIledHatFingerprint();

function plan(overrides: Partial<TransmissionPlan> = {}): TransmissionPlan {
  const bytes = encodeBrightness(0x40);
  return {
    id: "plan:test", driverId: "coolledx", profileId: "iledhat-31ae-32x16",
    operation: { type: "SetBrightness", raw: 0x40 }, risk: "transient", persistence: "unknown",
    validation: "experimental", evidenceRefs: [], packets: [{ index: 0, endpoint: COOLLEDX_ENDPOINT, writeMode: "without-response", bytes, hex: packetHex(bytes) }],
    ackPolicy: "none", responseExpectation: { type: "none" }, execution: "live", purpose: "operation", retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs: 100, recoveryNotes: [], metadata: {}, ...overrides,
  };
}

function context(overrides: Partial<SafetyContext> = {}): SafetyContext {
  return {
    source: "live", fingerprint, selectedDriverId: "coolledx", selectedProfileId: "iledhat-31ae-32x16",
    driverMatch: { driverId: "coolledx", score: 100, confidence: "exact", reasons: [], contradictions: [] },
    ambiguous: false, experimentalSessionEnabled: true, ...overrides,
  };
}

describe("SafetyPolicy", () => {
  const policy = new SafetyPolicy();
  it("allows only the unlocked known-profile brightness experiment", () => expect(policy.authorize(plan(), context()).allowed).toBe(true));
  it("blocks unknown and ambiguous drivers", () => {
    expect(policy.authorize(plan(), context({ selectedDriverId: null, driverMatch: null })).allowed).toBe(false);
    expect(policy.authorize(plan(), context({ ambiguous: true })).allowed).toBe(false);
  });
  it("requires experimental session unlock", () => expect(policy.authorize(plan(), context({ experimentalSessionEnabled: false })).allowed).toBe(false));
  it("blocks unverified operations", () => expect(policy.authorize(plan({ validation: "unverified" }), context()).allowed).toBe(false));
  it.each<[RiskClass, Persistence]>([["persistent", "unknown"], ["destructive", "none"], ["firmware", "none"]])("blocks %s risk", (risk, persistence) => {
    expect(policy.authorize(plan({ risk, persistence }), context()).allowed).toBe(false);
  });
  it("blocks imported diagnostics", () => expect(policy.authorize(plan(), context({ source: "imported" })).allowed).toBe(false));
  it("uses explicit live capability rather than hardcoded opcodes or values", () => expect(policy.authorize(plan({ operation: { type: "SetBrightness", raw: 0x41 }, validation: "verified" }), context()).allowed).toBe(true));
  it("blocks driver-declared dry-run plans", () => expect(policy.authorize(plan({ execution: "dry-run-only", validation: "verified" }), context()).allowed).toBe(false));
  it("requires the exact endpoint property", () => {
    const noWrite: DeviceFingerprint = { ...fingerprint, services: fingerprint.services.map((service) => ({ ...service, characteristics: service.characteristics.map((characteristic) => ({ ...characteristic, properties: { ...characteristic.properties, writeWithoutResponse: false } })) })) };
    expect(policy.authorize(plan(), context({ fingerprint: noWrite })).allowed).toBe(false);
  });
  it("allows verified CoolLEDUX device info and brightness without an experimental unlock", () => {
    const uxContext = { ...context({ selectedDriverId: "coolledux", selectedProfileId: iledHat31aeProfile.id, experimentalSessionEnabled: false }), driverMatch: { driverId: "coolledux", score: 100, confidence: "exact" as const, reasons: [], contradictions: [] } };
    const driverContext = { profile: iledHat31aeProfile, fingerprint, source: "live" as const };
    expect(policy.authorize(createCoolLedUxPlan({ type: "GetDeviceInfo" }, driverContext), uxContext).allowed).toBe(true);
    expect(policy.authorize(createCoolLedUxPlan({ type: "SetBrightness", raw: 0x80 }, driverContext), uxContext).allowed).toBe(true);
    expect(policy.authorize(createCoolLedUxPlan({ type: "SetPower", on: true }, driverContext), uxContext).allowed).toBe(false);
  });
  it("allows a verified read-only probe through ambiguity but blocks replay", () => {
    const driverContext = { profile: iledHat31aeProfile, fingerprint, source: "live" as const };
    const probe = createCoolLedUxPlan({ type: "GetDeviceInfo" }, driverContext, "probe");
    const probeContext = context({ selectedDriverId: null, selectedProfileId: null, ambiguous: true, experimentalSessionEnabled: false, driverMatch: { driverId: "coolledux", score: 75, confidence: "strong", reasons: [], contradictions: [] } });
    expect(policy.authorize(probe, probeContext).allowed).toBe(true);
    expect(policy.authorize(probe, { ...probeContext, source: "replay" }).allowed).toBe(false);
  });
});
