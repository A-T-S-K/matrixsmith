import { describe, expect, it } from "vitest";
import { createDiagnosticBundle, parseDiagnosticBundle, serializeDiagnosticBundle } from "../../src/diagnostics/bundle";
import { knownIledHatFingerprint } from "../helpers/fixtures";

function v1BundleJson(): string {
  // Exactly what a pre-content MatrixSmith exported: schemaVersion 1, no
  // validations / contentCompilations / importedEvidence collections.
  return JSON.stringify({
    schemaVersion: 1,
    matrixsmithVersion: "0.1.0",
    createdAt: "2026-08-31T12:00:00.000Z",
    fingerprint: knownIledHatFingerprint(),
    driverMatches: [{ driverId: "coolledux", score: 100, confidence: "exact", reasons: [], contradictions: [] }],
    selectedDriver: "coolledux",
    selectedProfile: "iledhat-31ae-32x16",
    capabilities: [],
    trace: [{ timestamp: "2026-08-31T12:00:01.000Z", type: "app.started", metadata: {} }],
    observations: [{ id: "observation:1", recordedAt: "2026-08-31T12:00:02.000Z", summary: "note", confidence: "observed" }],
    advertisementEvidence: null,
    transactions: [],
    diagnosticRuns: [],
  });
}

describe("diagnostic bundle schema v2", () => {
  it("keeps v1 bundles readable and migrates them to v2 with empty new collections", () => {
    const bundle = parseDiagnosticBundle(v1BundleJson());
    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.selectedDriver).toBe("coolledux");
    expect(bundle.validations).toEqual([]);
    expect(bundle.contentCompilations).toEqual([]);
    expect(bundle.importedEvidence).toEqual([]);
    expect(bundle.observations).toHaveLength(1);
  });

  it("serializes and round-trips the new v2 collections", () => {
    const bundle = createDiagnosticBundle({
      fingerprint: knownIledHatFingerprint(), driverMatches: [], selectedDriver: "coolledux", selectedProfile: "iledhat-31ae-32x16",
      capabilities: [], trace: [], observations: [],
      validations: [{ id: "v", workflowId: "coolledux-validate-static-frame", recordedAt: "t", profileId: "p", status: "passed", validatedAreas: ["static-frame"], rejectedAreas: [], answers: [], transactionIds: [], findings: [] }],
      contentCompilations: [{ id: "c", createdAt: "t", operation: "ShowFrame", contentType: "graffiti", profileId: "p", width: 32, height: 16, tileWidth: 8, tileCount: 4, programBytes: 1146, crc32: 1, compressedBytes: 1290, compression: "lzss-safe", chunkCount: 11, pacingMs: 60 }],
      importedEvidence: [{ provenance: "nRF Connect text log import", transactionCount: 5, warnings: [] }],
    });
    expect(bundle.schemaVersion).toBe(2);
    const parsed = parseDiagnosticBundle(serializeDiagnosticBundle(bundle));
    expect(parsed.validations).toHaveLength(1);
    expect(parsed.contentCompilations?.[0]?.chunkCount).toBe(11);
    expect(parsed.importedEvidence?.[0]?.provenance).toContain("nRF Connect");
  });

  it("still rejects unknown schema versions", () => {
    expect(() => parseDiagnosticBundle('{"schemaVersion":3}')).toThrow(/schemaVersion/);
  });
});
