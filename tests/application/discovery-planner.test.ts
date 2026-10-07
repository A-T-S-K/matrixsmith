import { describe, expect, it } from "vitest";
import { DriverRegistry } from "../../src/drivers/registry";
import {
  discoveryCatalog,
  nextDiscoveryStep,
} from "../../src/application/services/discovery-planner";
import { machineOutcome } from "../../src/application/discovery-outcome";
import { discoveryDriver } from "../helpers/discovery-driver";
import { syntheticFingerprint } from "../helpers/synthetic-driver";
import type { ExecutionResult } from "../../src/app/executor";

const context = {
  fingerprint: syntheticFingerprint(),
  endpoints: [],
  source: "live" as const,
};
describe("reviewed deterministic discovery", () => {
  it("equal GATT and score candidates select the same useful step in either registry order", () => {
    const a = discoveryDriver("a", 0x91);
    const b = discoveryDriver("b", 0x92, {
      metadata: { distinguishes: ["a", "b"] },
    });
    for (const drivers of [
      [a, b],
      [b, a],
    ]) {
      const catalog = discoveryCatalog(new DriverRegistry(drivers), context);
      expect(
        nextDiscoveryStep(catalog, new Set(), new Set(["a", "b"]))?.id,
      ).toBe("b/info");
      expect(
        nextDiscoveryStep(catalog, new Set(["b/info"]), new Set(["a", "b"]))
          ?.id,
      ).toBe("a/info");
    }
  });
  it("uses stable IDs for exact utility ties and respects prerequisites and contribution availability", () => {
    const a = discoveryDriver("a", 0x91);
    const b = discoveryDriver("b", 0x92);
    const c = discoveryDriver("c", 0x93, {
      metadata: { prerequisites: ["a/info"] },
    });
    const d = discoveryDriver("d", 0x94, { metadata: { available: false } });
    const steps = discoveryCatalog(new DriverRegistry([d, c, b, a]), context);
    expect(
      nextDiscoveryStep(steps, new Set(), new Set(["a", "b", "c", "d"]))?.id,
    ).toBe("a/info");
    expect(
      nextDiscoveryStep(
        steps,
        new Set(["a/info", "b/info"]),
        new Set(["c", "d"]),
        new Set(),
      ),
    ).toBeNull();
    expect(
      nextDiscoveryStep(
        steps,
        new Set(["a/info", "b/info"]),
        new Set(["c", "d"]),
      )?.id,
    ).toBe("c/info");
  });
  it("legacy negatives and malformed/unmapped responses remain inconclusive", () => {
    const response = {
      family: "a",
      kind: "info",
      payloadHex: "00",
      summary: "vector",
      fields: {},
    };
    const result = {
      response,
      responseRecord: { decoded: response },
      protocolAcknowledged: true,
      responseTimedOut: false,
      responseAmbiguous: false,
    } as ExecutionResult;
    expect(
      machineOutcome(result, { matched: false, reason: "legacy unmatched" }),
    ).toBe("inconclusive");
    expect(
      machineOutcome(result, {
        matched: false,
        reason: "reviewed negative",
        rejection: { driverId: "a" },
      }),
    ).toBe("rejected");
    expect(
      machineOutcome(
        { ...result, responseTimedOut: true },
        { matched: true, confidence: "exact", summary: "invalid" },
      ),
    ).toBe("timeout");
    expect(
      machineOutcome(
        { ...result, responseRecord: null },
        { matched: true, confidence: "exact", summary: "invalid" },
      ),
    ).toBe("inconclusive");
    expect(
      machineOutcome(
        { ...result, response: { ...response, envelopeError: "malformed" } },
        { matched: true, confidence: "exact", summary: "invalid" },
      ),
    ).toBe("inconclusive");
  });
});
