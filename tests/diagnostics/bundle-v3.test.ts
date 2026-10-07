import { describe, expect, it } from "vitest";
import {
  BUNDLE_INPUT_LIMITS,
  BUNDLE_MAX_NESTING_DEPTH,
  BundleValidationError,
  createDiagnosticBundle,
  createShareableBundle,
  parseDiagnosticBundle,
  safeParseDiagnosticBundle,
  serializeDiagnosticBundle,
} from "../../src/diagnostics/bundle";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import validateStructure from "../../src/diagnostics/generated/bundle-validator.js";

function bundle() {
  return createDiagnosticBundle({
    fingerprint: knownIledHatFingerprint(),
    driverMatches: [],
    selectedDriver: "coolledux",
    selectedProfile: "iledhat-31ae-32x16",
    capabilities: [],
    trace: [],
    observations: [],
  });
}

describe("Bundle V3 codec", () => {
  it.each([false, true])(
    "rejects 10,000 nested objects under the byte budget (unknown field: %s)",
    (unknownField) => {
      const json = JSON.stringify({
        ...bundle(),
        ...(unknownField ? { unknown: true } : {}),
      }).replace(
        '"advertisementEvidence":null',
        `"advertisementEvidence":${'{"child":'.repeat(10_000)}null${"}".repeat(10_000)}`,
      );
      expect(new TextEncoder().encode(json).byteLength).toBeLessThan(
        BUNDLE_INPUT_LIMITS.diagnosticBundleBytes,
      );
      expect(validateStructure(JSON.parse(json))).toBe(!unknownField);
      const result = safeParseDiagnosticBundle(json);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toEqual([
          {
            path: expect.stringMatching(/^\$\.advertisementEvidence/),
            code: "too_deep",
            message: expect.stringContaining(
              `${BUNDLE_MAX_NESTING_DEPTH}-level`,
            ),
          },
        ]);
        expect(result.errors[0]!.path.length).toBeLessThanOrEqual(256);
      }
    },
  );

  it("counts both arrays and objects and accepts the nesting boundary", () => {
    const atBoundary = {
      ...bundle(),
      advertisementEvidence: JSON.parse(
        '{"children":' +
          "[".repeat(BUNDLE_MAX_NESTING_DEPTH - 2) +
          "null" +
          "]".repeat(BUNDLE_MAX_NESTING_DEPTH - 2) +
          "}",
      ),
    };
    expect(safeParseDiagnosticBundle(JSON.stringify(atBoundary)).success).toBe(
      true,
    );
    atBoundary.advertisementEvidence.children = [
      atBoundary.advertisementEvidence.children,
    ];
    expect(safeParseDiagnosticBundle(JSON.stringify(atBoundary))).toMatchObject(
      {
        success: false,
        errors: [{ code: "too_deep" }],
      },
    );
  });

  it("returns mandatory structural errors before semantic errors", () => {
    const result = safeParseDiagnosticBundle(
      JSON.stringify({
        ...bundle(),
        unknown: true,
        observations: [{}],
      }),
    );
    expect(result).toMatchObject({
      success: false,
      errors: [{ path: "$.unknown", code: "invalid_value" }],
    });
    if (!result.success) expect(result.errors).toHaveLength(1);
  });

  it("round-trips the only supported schema", () => {
    const parsed = parseDiagnosticBundle(serializeDiagnosticBundle(bundle()));
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.privacy).toBe("full-local-archive");
  });

  it("rejects v1 and v2 rather than migrating them", () => {
    for (const schemaVersion of [1, 2]) {
      const value = JSON.parse(serializeDiagnosticBundle(bundle())) as Record<
        string,
        unknown
      >;
      value.schemaVersion = schemaVersion;
      const result = safeParseDiagnosticBundle(JSON.stringify(value));
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            path: "$.schemaVersion",
            code: "unsupported_version",
          }),
        );
    }
  });

  it("returns field-addressed errors for malformed nested input", () => {
    const value = JSON.parse(serializeDiagnosticBundle(bundle())) as Record<
      string,
      any
    >;
    value.fingerprint.services[0].characteristics[0].properties.notify = "yes";
    const result = safeParseDiagnosticBundle(JSON.stringify(value));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.map((error) => error.path)).toContain(
        "$.fingerprint.services[0].characteristics[0].properties.notify",
      );
    }
    value.transactions = [{ packets: [{ direction: "RX", hex: "xyz" }] }];
    expect(safeParseDiagnosticBundle(JSON.stringify(value))).toMatchObject({
      success: false,
      errors: [{ path: "$.transactions[0].id", code: "invalid_value" }],
    });
  });

  it("enforces the byte and collection budgets before returning data", () => {
    const oversized = `{"padding":"${"x".repeat(BUNDLE_INPUT_LIMITS.diagnosticBundleBytes)}"}`;
    expect(() => parseDiagnosticBundle(oversized)).toThrow(
      BundleValidationError,
    );
    const value = JSON.parse(serializeDiagnosticBundle(bundle())) as Record<
      string,
      unknown
    >;
    value.trace = Array.from(
      { length: BUNDLE_INPUT_LIMITS.traceEvents + 1 },
      () => ({
        timestamp: "2026-09-02T00:00:00.000Z",
        type: "app.started",
        metadata: {},
      }),
    );
    const result = safeParseDiagnosticBundle(JSON.stringify(value));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errors).toContainEqual(
        expect.objectContaining({ path: "$.trace", code: "too_many" }),
      );
  });

  it("makes privacy behavior explicit and leaves the forensic bundle untouched", () => {
    const full = bundle();
    const shareable = createShareableBundle(full);
    expect(full.fingerprint.browserDeviceId).toBeTruthy();
    expect(shareable.privacy).toBe("shareable");
    expect(shareable.fingerprint.browserDeviceId).toBeUndefined();
    expect(shareable.fingerprint.name).toBeUndefined();
    expect(shareable.trace).toEqual([]);
    expect(shareable.advertisementEvidence).toBeNull();
  });
});

it("redacts identifiers embedded in notes and structured advertisements", () => {
  const fingerprint = {
    ...knownIledHatFingerprint(),
    browserDeviceId: "private-unit-123",
    notes: ["Connected private-unit-123"],
    advertisementObservation: {
      capturedAt: new Date().toISOString(),
      source: "web-bluetooth-watch" as const,
      name: "Private display",
      advertisedServiceUuids: [],
      manufacturerData: [],
      serviceData: [],
    },
  };
  const full = createDiagnosticBundle({
    fingerprint,
    driverMatches: [],
    selectedDriver: null,
    selectedProfile: null,
    capabilities: [],
    trace: [],
    observations: [],
  });
  const shareable = createShareableBundle(full);
  expect(JSON.stringify(shareable)).not.toContain("private-unit-123");
  expect(shareable.fingerprint.advertisementObservation).toBeUndefined();
  expect(
    parseDiagnosticBundle(serializeDiagnosticBundle(shareable)).privacy,
  ).toBe("shareable");
  expect(JSON.stringify(full)).toContain("private-unit-123");
});
