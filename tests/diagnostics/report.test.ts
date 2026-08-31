import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { DEFAULT_REPORT_OPTIONS, generateMarkdownReport, reportDataFromBundle, type ReportData } from "../../src/diagnostics/report";
import { coolLedUxCapabilities } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoCc from "../fixtures/iledhat/coolledux-device-info-cc.json";

const EXPECTED_HEADINGS = [
  "# MatrixSmith Device Report", "## Goal / question", "## Executive summary", "## Support status",
  "## Device fingerprint", "## GATT", "## Advertisement / manufacturer evidence", "## Driver resolution",
  "## Device state", "## Capabilities", "## Diagnostic runs", "## Protocol transactions", "## Observations",
  "## Verified facts", "## Inferred facts", "## Unknowns", "## Rejected hypotheses", "## Suggested next tests",
  "## Reproduction environment", "## Protocol transcript", "## Analysis request",
];

function sampleData(): ReportData {
  return {
    createdAt: "2026-08-31T12:00:00.000Z",
    matrixsmithVersion: "0.1.0",
    fingerprint: knownIledHatFingerprint(),
    profile: iledHat31aeProfile,
    selectedDriver: "coolledux",
    driverMatches: [
      { driverId: "coolledux", score: 80, confidence: "strong", reasons: ["Structured 0x1F device info"], contradictions: [] },
      { driverId: "coolledx", score: 0, confidence: "none", reasons: [], contradictions: ["Classic brightness hypothesis returned 08 FE and no visible effect"] },
    ],
    capabilities: coolLedUxCapabilities(iledHat31aeProfile),
    transactions: [{
      id: "transaction:fixed", startedAt: "2026-08-31T12:00:01.000Z", completedAt: "2026-08-31T12:00:01.200Z", durationMs: 200,
      sessionSource: "live", source: "probe", driverId: "coolledux", profileId: iledHat31aeProfile.id, operation: "GetDeviceInfo",
      safety: { risk: "read-only", persistence: "none", validation: "verified" }, endpoint: null,
      packets: [
        { timestamp: "2026-08-31T12:00:01.000Z", direction: "TX", hex: infoCc.txHex },
        { timestamp: "2026-08-31T12:00:01.150Z", direction: "RX", hex: infoCc.rxHex },
      ],
      decodedResponse: null, hostAccepted: true, protocolAcknowledged: true, deviceStateVerified: true,
      responseTimedOut: false, error: null, findings: ["Structured 0x1F response"], observationIds: [], diagnosticRunId: null,
    }],
    diagnosticRuns: [],
    observations: [{ id: "observation:1", recordedAt: "2026-08-31T12:00:02.000Z", summary: "Panel visibly dimmed.", confidence: "observed" }],
    trace: [{ timestamp: "2026-08-31T12:00:00.500Z", type: "app.started", metadata: { browserDeviceId: "fixture-device", webBluetoothSupported: true } }],
    protocolResolution: { summary: "Valid structured 0x1F response", source: "live-probe" },
    validations: [], contentCompilations: [], importedEvidence: [], liveConnected: true,
    source: "live",
  };
}

describe("markdown report generator", () => {
  it("is deterministic for identical inputs", () => {
    expect(generateMarkdownReport(sampleData())).toBe(generateMarkdownReport(sampleData()));
  });

  it("emits every stable heading", () => {
    const markdown = generateMarkdownReport(sampleData());
    for (const heading of EXPECTED_HEADINGS) expect(markdown).toContain(`${heading}\n`);
    expect(markdown).not.toContain("## Raw event trace");
  });

  it("preserves exact packet hex literally", () => {
    const markdown = generateMarkdownReport(sampleData());
    expect(markdown).toContain(infoCc.txHex);
    expect(markdown).toContain(infoCc.rxHex);
  });

  it("excludes browser/device identifiers by default and includes them only on request", () => {
    const redacted = generateMarkdownReport(sampleData());
    expect(redacted).not.toContain("fixture-device");
    expect(redacted).toContain("excluded by default");
    const full = generateMarkdownReport(sampleData(), { ...DEFAULT_REPORT_OPTIONS, includeIdentifiers: true, includeRawTrace: true });
    expect(full).toContain("fixture-device");
    expect(full).toContain("## Raw event trace");
  });

  it("classifies verified, inferred, unknown, and rejected findings into their own sections", () => {
    const markdown = generateMarkdownReport(sampleData());
    const verified = markdown.split("## Verified facts")[1]!.split("## Inferred facts")[0]!;
    const rejected = markdown.split("## Rejected hypotheses")[1]!.split("## Suggested next tests")[0]!;
    const unknowns = markdown.split("## Unknowns")[1]!.split("## Rejected hypotheses")[0]!;
    expect(verified).toContain("0x1F returned structured device info");
    expect(rejected).toContain("Classic brightness hypothesis returned 08 FE and no visible effect");
    expect(unknowns).toContain("Persistence: unknown");
  });

  it("suggests next tests that advance the support state", () => {
    const resolved = generateMarkdownReport(sampleData());
    expect(resolved).toContain("Validate static framebuffer");
    expect(resolved).not.toContain("Refresh device info.");
    const ambiguous = generateMarkdownReport({ ...sampleData(), selectedDriver: null, protocolResolution: null });
    expect(ambiguous).toContain("Run safe protocol identification");
  });

  it("generates a complete report from an imported bundle", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new MatrixController(transport, new TraceRecorder());
    await controller.connect();
    await controller.probe();
    await controller.runDiagnostic("coolledux-refresh-info");
    const bundle = parseDiagnosticBundle(controller.exportBundle());
    const markdown = generateMarkdownReport(reportDataFromBundle(bundle));
    expect(markdown).toContain("imported diagnostic bundle");
    expect(markdown).toContain(infoCc.rxHex.match(/../g)!.join(" "));
    expect(markdown).toContain("## Diagnostic runs");
    expect(markdown).not.toContain("fixture-device");
  });
});
