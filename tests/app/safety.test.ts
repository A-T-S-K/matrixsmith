import { describe, expect, it } from "vitest";
import type { DeviceFingerprint } from "../../src/core/device";
import type { Persistence, RiskClass } from "../../src/core/risk";
import { packetHex, type TransmissionPlan } from "../../src/core/transmission";
import { SafetyPolicy, type SafetyContext } from "../../src/app/safety";
import { COOLLEDX_ENDPOINT } from "../../src/drivers/coolledx/gatt";
import { encodeBrightness } from "../../src/drivers/coolledx/protocol";
import { knownIledHatFingerprint } from "../helpers/fixtures";

const fingerprint = knownIledHatFingerprint();

function plan(overrides: Partial<TransmissionPlan> = {}): TransmissionPlan {
  const bytes = encodeBrightness(0x40);
  return {
    id: "plan:test", driverId: "coolledx", profileId: "iledhat-31ae-32x16",
    operation: { type: "SetBrightness", raw: 0x40 }, risk: "transient", persistence: "unknown",
    validation: "experimental", evidenceRefs: [], packets: [{ index: 0, endpoint: COOLLEDX_ENDPOINT, writeMode: "without-response", bytes, hex: packetHex(bytes) }],
    ackPolicy: "none", retryPolicy: { maxAttempts: 1, retryOn: [] }, timeoutMs: 100, recoveryNotes: [], metadata: {}, ...overrides,
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
  it("blocks every other raw brightness value and operation", () => {
    expect(policy.authorize(plan({ operation: { type: "SetBrightness", raw: 0x41 } }), context()).allowed).toBe(false);
    expect(policy.authorize(plan({ operation: { type: "SetPower", on: true } }), context()).allowed).toBe(false);
  });
  it("requires the exact endpoint property", () => {
    const noWrite: DeviceFingerprint = { ...fingerprint, services: fingerprint.services.map((service) => ({ ...service, characteristics: service.characteristics.map((characteristic) => ({ ...characteristic, properties: { ...characteristic.properties, writeWithoutResponse: false } })) })) };
    expect(policy.authorize(plan(), context({ fingerprint: noWrite })).allowed).toBe(false);
  });
});
