import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createDiagnosticBundle,
  safeParseDiagnosticBundle,
  serializeDiagnosticBundle,
} from "../../src/diagnostics/bundle";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { assessDevice } from "../../src/domain/device/assessment";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const schema = JSON.parse(
  readFileSync(
    new URL("../../public/bundle-v3.schema.json", import.meta.url),
    "utf8",
  ),
) as {
  required: string[];
  properties: Record<string, { const?: unknown }>;
  $defs: Record<string, unknown>;
};

describe("Bundle V3 JSON Schema", () => {
  it("tracks every required runtime bundle field and resource collection", () => {
    const bundle = JSON.parse(
      serializeDiagnosticBundle(
        createDiagnosticBundle({
          fingerprint: knownIledHatFingerprint(),
          driverMatches: [],
          selectedDriver: null,
          selectedProfile: null,
          capabilities: [],
          trace: [],
          observations: [],
        }),
      ),
    ) as Record<string, unknown>;
    expect(schema.properties.schemaVersion?.const).toBe(3);
    expect(schema.required.sort()).toEqual(Object.keys(bundle).sort());
    expect(schema.$defs).toHaveProperty("fingerprint");
    expect(schema.$defs).toHaveProperty("transaction");
    expect(schema.$defs).toHaveProperty("assessment");
    const parsed = safeParseDiagnosticBundle(JSON.stringify(bundle));
    expect(parsed).toEqual({ success: true, data: expect.any(Object) });
  });

  it("accepts driver-contributed actions in a known-device assessment", () => {
    const fingerprint = knownIledHatFingerprint();
    const capabilities = coolLedUxDriver.capabilities(iledHat31aeProfile);
    const assessment = assessDevice({
      target: {
        kind: "profile-resolved",
        fingerprint,
        driverId: coolLedUxDriver.id,
        profile: iledHat31aeProfile,
      },
      evidence: coolLedUxDriver.claimEvidence?.(iledHat31aeProfile) ?? [],
      capabilities,
      operations: coolLedUxDriver.operations,
      live: true,
    });
    const json = serializeDiagnosticBundle(
      createDiagnosticBundle({
        fingerprint,
        driverMatches: [],
        selectedDriver: coolLedUxDriver.id,
        selectedProfile: iledHat31aeProfile.id,
        capabilities,
        assessment,
        trace: [],
        observations: [],
      }),
    );
    expect(safeParseDiagnosticBundle(json)).toEqual({
      success: true,
      data: expect.any(Object),
    });
  });
});
