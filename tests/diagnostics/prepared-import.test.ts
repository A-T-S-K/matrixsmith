import { expect, it, vi } from "vitest";
import {
  BUNDLE_INPUT_LIMITS,
  BundleValidationError,
  createDiagnosticBundle,
  parseDiagnosticBundle,
  prepareDiagnosticBundleImport,
  readPreparedDiagnosticBundle,
  type PreparedDiagnosticBundleImport,
} from "../../src/diagnostics/bundle";
import { knownIledHatFingerprint } from "../helpers/fixtures";

function source() {
  return createDiagnosticBundle({
    fingerprint: knownIledHatFingerprint(),
    driverMatches: [],
    selectedDriver: null,
    selectedProfile: null,
    capabilities: [],
    trace: [],
    observations: [],
    advertisementEvidence: { nested: { values: ["original"] } },
  });
}

it("authenticates identity rather than fields, prototypes or serialized markers", () => {
  const json = JSON.stringify(source());
  const token = prepareDiagnosticBundleImport(json);
  const data = readPreparedDiagnosticBundle(token);
  const forgeries = [
    data,
    { validated: true, bundle: data },
    { ...token },
    structuredClone(token),
    JSON.parse(JSON.stringify(token)),
    Object.create(token),
    new Proxy(token, {}),
    null,
    "validated",
  ];
  for (const forged of forgeries)
    expect(() =>
      readPreparedDiagnosticBundle(forged as PreparedDiagnosticBundleImport),
    ).toThrow(/Invalid prepared/);
  expect(readPreparedDiagnosticBundle(token)).toBe(data);
});

it("owns a deeply immutable graph while ordinary parser results stay editable", () => {
  const original = source();
  const json = JSON.stringify(original);
  const data = readPreparedDiagnosticBundle(
    prepareDiagnosticBundleImport(json),
  );
  const nested = data.advertisementEvidence!.nested as { values: string[] };
  expect(() => nested.values.push("injected")).toThrow(TypeError);
  expect(() =>
    Object.assign(data.fingerprint.services[0]!, { uuid: "bad" }),
  ).toThrow(TypeError);
  expect(() => Object.assign(data, { schemaVersion: 999 })).toThrow(TypeError);
  expect(JSON.stringify(data)).toBe(json);
  expect(JSON.stringify(original)).toBe(json);
  const ordinary = parseDiagnosticBundle(json);
  expect(Object.isFrozen(ordinary)).toBe(false);
  expect(Object.isFrozen(ordinary.fingerprint)).toBe(false);
});

it("rejects capabilities issued by an incompatible module instance", async () => {
  const token = prepareDiagnosticBundleImport(JSON.stringify(source()));
  vi.resetModules();
  const other = await import("../../src/diagnostics/bundle");
  expect(() => other.readPreparedDiagnosticBundle(token)).toThrow(
    /Invalid prepared/,
  );
  expect(readPreparedDiagnosticBundle(token).schemaVersion).toBe(3);
});

it.each([
  ["malformed", "{"],
  ["unsupported", '{"schemaVersion":999}'],
  ["oversized", " ".repeat(BUNDLE_INPUT_LIMITS.diagnosticBundleBytes + 1)],
  [
    "over-depth",
    JSON.stringify(source())
      .replace(
        '"advertisementEvidence":',
        '"advertisementEvidence":' + '{"child":'.repeat(100),
      )
      .replace(
        '"nested":{"values":["original"]}}',
        '"nested":{"values":["original"]}}' + "}".repeat(100),
      ),
  ],
  ["semantic", JSON.stringify({ ...source(), createdAt: "not a date" })],
])("never issues a capability for %s input", (_, json) => {
  expect(() => prepareDiagnosticBundleImport(json)).toThrow(
    BundleValidationError,
  );
});
