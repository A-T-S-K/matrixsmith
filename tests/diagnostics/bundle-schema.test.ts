import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import generated from "../../src/diagnostics/generated/bundle-validator.js";
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

const ajv = new Ajv2020({ allErrors: false });
addFormats(ajv, { mode: "full" });
const compiled = ajv.compile(schema);
function checkSchema(value: unknown): void {
  expect(compiled(value), JSON.stringify(compiled.errors)).toBe(true);
  expect(generated(value), JSON.stringify(generated.errors)).toBe(true);
}

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
    checkSchema(bundle);
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
    checkSchema(JSON.parse(json));
    expect(safeParseDiagnosticBundle(json)).toEqual({
      success: true,
      data: expect.any(Object),
    });
  });
});

it("accepts current runtime exports with real transactions, notifications and investigation evidence", async () => {
  const { ApplicationRuntime } = await import("../../src/application/runtime");
  const { ScriptedCoolLedUxDevice } =
    await import("../helpers/scripted-device");
  const { TraceRecorder } = await import("../../src/diagnostics/trace");
  for (const fingerprint of [
    knownIledHatFingerprint(),
    {
      ...knownIledHatFingerprint(),
      name: "unknown offline",
      services: [],
      advertisedServices: [],
    },
    {
      ...knownIledHatFingerprint(),
      name: "unknown provisional",
      rawAdvertisementHex: undefined,
      manufacturerDataHex: undefined,
      manuallyConfirmedGeometry: undefined,
    },
  ]) {
    const transport = new ScriptedCoolLedUxDevice(fingerprint);
    const runtime = new ApplicationRuntime(transport, new TraceRecorder());
    await runtime.connect();
    if (fingerprint.name === "unknown provisional") {
      await runtime.probe();
      runtime.confirmProvisionalGeometry(32, 16);
      expect(runtime.session.profile?.id).toContain("provisional");
    }
    if (fingerprint.name === "iLedHat") {
      await runtime.probe();
      runtime.recordObservation("Actual synthetic observation");
      await runtime.runGuidedTestTransfer("coolledux-graffiti-timing", {
        confirmedConsequence: true,
        reason: "initial-experiment",
        attemptId: "attempt:schema",
      });
      runtime.recordGuidedTestObservations(
        "coolledux-graffiti-timing",
        [
          { kind: "boolean", fieldId: "initial-correct", value: "yes" },
          {
            kind: "duration",
            fieldId: "image-visible",
            milliseconds: 1420,
            measuredBy: "matrixsmith-timer",
          },
        ],
        runtime.transactions.slice(-1).map((tx) => tx.id),
      );
    }
    for (const privacy of ["shareable", "full-local-archive"] as const) {
      const json = runtime.exportBundle(privacy);
      checkSchema(JSON.parse(json));
      expect(safeParseDiagnosticBundle(json).success).toBe(true);
    }
    await runtime.dispose();
  }
});

it("compiled and generated structural validators agree on mutations without changing input", () => {
  const valid = JSON.parse(
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
  ) as Record<string, any>;
  const mutations: ((value: Record<string, any>) => void)[] = [
    (value) => {
      value.unpublished = true;
    },
    (value) => {
      value.matrixsmithVersion = "";
    },
    (value) => {
      value.privacy = "safe";
    },
    (value) => {
      value.schemaVersion = "3";
    },
    (value) => {
      value.fingerprint.notes = "not an array";
    },
    (value) => {
      delete value.observations;
    },
    ...[
      "2026-02-30T00:00:00Z",
      "2026-10-01",
      "yesterday",
      "2026-10-01T10:00:00",
    ].map((createdAt) => (value: Record<string, any>) => {
      value.createdAt = createdAt;
    }),
    (value) => {
      value.trace = Array.from({ length: 50001 }, () => ({}));
    },
    (value) => {
      value.transactions = Array.from({ length: 10001 }, () => ({}));
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(valid);
    mutate(value);
    const before = JSON.stringify(value);
    expect(compiled(value)).toBe(false);
    expect(generated(value)).toBe(false);
    expect(safeParseDiagnosticBundle(before).success).toBe(false);
    expect(JSON.stringify(value)).toBe(before);
  }
  const generic = { ...valid, observations: [{}] };
  expect(compiled(generic)).toBe(true);
  expect(generated(generic)).toBe(true);
  expect(safeParseDiagnosticBundle(JSON.stringify(generic)).success).toBe(
    false,
  );
  const dates = ["2024-02-29T10:20:30Z", "2026-10-01T10:20:30+02:00"];
  for (const createdAt of dates) checkSchema({ ...valid, createdAt });
  expect(
    safeParseDiagnosticBundle(
      JSON.stringify({
        ...valid,
        observations: Array.from({ length: 1000 }, () => ({})),
      }),
    ),
  ).toMatchObject({ success: false, errors: expect.any(Array) });
  const failure = safeParseDiagnosticBundle(
    JSON.stringify({
      ...valid,
      observations: Array.from({ length: 1000 }, () => ({})),
    }),
  );
  if (!failure.success) expect(failure.errors.length).toBeLessThanOrEqual(32);
});
