import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import generated from "../../src/diagnostics/generated/bundle-validator.js";
import { generateForensicAppendix } from "../../src/investigation/reports";
import { expect, it } from "vitest";
import {
  createDiagnosticBundle,
  safeParseDiagnosticBundle,
  serializeDiagnosticBundle,
} from "../../src/diagnostics/bundle";
import {
  DEFAULT_REPORT_OPTIONS,
  generateMarkdownReport,
  reportDataFromBundle,
} from "../../src/diagnostics/report";
import type { ContentCompilationRecord } from "../../src/diagnostics/content-evidence";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { readFileSync } from "node:fs";
const ajv = new Ajv2020();
addFormats(ajv, { mode: "full" });
const compiled = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL("../../public/bundle-v3.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);
const record: ContentCompilationRecord = {
  id: "gif-conversion",
  createdAt: "2026-10-01T00:00:00Z",
  operation: "ShowAnimation",
  contentType: "animation",
  profileId: "fixture",
  width: 32,
  height: 16,
  tileWidth: 8,
  tileCount: 4,
  programBytes: 400,
  crc32: 0,
  compressedBytes: 410,
  compression: "lzss-safe",
  chunkCount: 3,
  pacingMs: 60,
  frameCount: 4,
  frameDelaysMs: [100, 200, 300, 400],
  sourceDimensions: "4×2",
  originalContent: "gif",
  deliveryBackend: "local-gif-raster-animation",
  totalDurationMs: 1000,
  sourceRepetition: "infinite",
};
const bundle = () =>
  createDiagnosticBundle({
    fingerprint: knownIledHatFingerprint(),
    driverMatches: [],
    selectedDriver: null,
    selectedProfile: null,
    capabilities: [],
    trace: [],
    observations: [],
    contentCompilations: [record],
  });
it.each(["infinite", "unknown", 1] as const)(
  "round trips GIF provenance with %s repetition without binary data",
  (repetition) => {
    const data = bundle();
    const json = serializeDiagnosticBundle({
      ...data,
      contentCompilations: [{ ...record, sourceRepetition: repetition }],
    });
    expect(compiled(JSON.parse(json))).toBe(true);
    expect(generated(JSON.parse(json))).toBe(true);
    const parsed = safeParseDiagnosticBundle(json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Invalid bundle");
    expect(parsed.data.contentCompilations[0]).toMatchObject({
      ...record,
      sourceRepetition: repetition,
    });
    expect(json).not.toMatch(/gifBytes|GIF89a|sequence|Infinity/);
    const report = generateMarkdownReport(
      reportDataFromBundle(parsed.data),
      DEFAULT_REPORT_OPTIONS,
    );
    expect(report).toContain(
      "Original content: GIF; delivery: local GIF decode → raster animation",
    );
    expect(report).toContain("100/200/300/400 ms");
  },
);
it("validates added fields and publishes matching schema keys", () => {
  for (const extras of [
    { originalContent: "png" },
    { deliveryBackend: "native" },
    { totalDurationMs: "bad" },
    { totalDurationMs: 0 },
    { sourceRepetition: -1 },
    { sourceRepetition: 0.5 },
    { sourceRepetition: null },
    { sourceRepetition: "Infinity" },
  ]) {
    expect(
      safeParseDiagnosticBundle(
        JSON.stringify({
          ...bundle(),
          contentCompilations: [{ ...record, ...extras }],
        }),
      ).success,
    ).toBe(false);
  }
  const schema = JSON.parse(
    readFileSync(
      new URL("../../public/bundle-v3.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const compilation = schema.properties.contentCompilations.items.properties;
  expect(compilation).toHaveProperty("originalContent");
  expect(compilation).toHaveProperty("deliveryBackend");
  expect(compilation).toHaveProperty("totalDurationMs");
  expect(compilation).toHaveProperty("sourceRepetition");
});

it("forensic transaction output retains GIF conversion provenance and timing", () => {
  const transaction = {
    id: "tx-gif",
    startedAt: record.createdAt,
    completedAt: record.createdAt,
    durationMs: 0,
    sessionSource: "fake" as const,
    source: "operation" as const,
    driverId: "coolledux",
    profileId: "fixture",
    operation: "ShowAnimation",
    safety: {
      risk: "persistent" as const,
      persistence: "persistent" as const,
      validation: "verified" as const,
    },
    endpoint: null,
    packets: [],
    decodedResponse: null,
    hostAccepted: true,
    protocolAcknowledged: null,
    deviceStateVerified: false,
    responseTimedOut: false,
    error: null,
    findings: [],
    observationIds: [],
    diagnosticRunId: null,
  };
  const report = generateForensicAppendix({
    base: "",
    transactions: [transaction],
    compilations: [{ ...record, transactionId: transaction.id }],
    decoder: null,
  });
  expect(report).toContain(
    "Original content: GIF; delivery: local GIF decode → raster animation",
  );
  expect(report).toContain("100/200/300/400 ms");
});
