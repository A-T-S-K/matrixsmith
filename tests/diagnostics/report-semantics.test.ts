import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_OPTIONS, generateMarkdownReport, type ReportData } from "../../src/diagnostics/report";
import { computeSupportMatrix, suggestNextTests, type SupportInput } from "../../src/diagnostics/support";
import { evaluateValidationAnswers, STATIC_FRAME_VALIDATION, type SessionValidationResult } from "../../src/diagnostics/validation";
import { coolLedUxCapabilities } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    createdAt: "2026-08-31T12:00:00.000Z",
    matrixsmithVersion: "0.1.0",
    fingerprint: knownIledHatFingerprint(),
    profile: iledHat31aeProfile,
    selectedDriver: "coolledux",
    driverMatches: [
      { driverId: "coolledux", score: 100, confidence: "exact", reasons: ["Structured 0x1F device info"], contradictions: [] },
      { driverId: "coolledx", score: 55, confidence: "candidate", reasons: ["accessible GATT includes FFF0", "FFF0 exposes FFF1"], contradictions: [] },
    ],
    capabilities: coolLedUxCapabilities(iledHat31aeProfile),
    transactions: [],
    diagnosticRuns: [],
    observations: [],
    trace: [],
    protocolResolution: { summary: "Valid structured 0x1F response", source: "live-probe" },
    validations: [],
    contentCompilations: [],
    importedEvidence: [],
    liveConnected: true,
    source: "live",
    ...overrides,
  };
}

function passedStaticValidation(): SessionValidationResult {
  const answers = STATIC_FRAME_VALIDATION.questions.map((q) => ({ questionId: q.id, answer: "yes" as const }));
  const outcome = evaluateValidationAnswers(STATIC_FRAME_VALIDATION, answers);
  return {
    id: "validation:test", workflowId: STATIC_FRAME_VALIDATION.id, recordedAt: "2026-08-31T13:00:00.000Z",
    profileId: iledHat31aeProfile.id, status: outcome.status, validatedAreas: outcome.validatedAreas,
    rejectedAreas: outcome.rejectedAreas, answers, transactionIds: [], findings: outcome.findings,
  };
}

describe("report evidence semantics", () => {
  it("reports rejected profile hypotheses from stored profile evidence, not only session contradictions", () => {
    const markdown = generateMarkdownReport(baseData());
    const rejected = markdown.split("## Rejected hypotheses")[1]!.split("## Suggested next tests")[0]!;
    expect(rejected).toContain("Classic CoolLEDX brightness hypothesis rejected");
    expect(rejected).toContain("battery state-of-charge was rejected");
    expect(rejected).not.toContain("None recorded");
  });

  it("keeps rejected evidence out of verified facts", () => {
    const markdown = generateMarkdownReport(baseData());
    const verified = markdown.split("## Verified facts")[1]!.split("## Inferred facts")[0]!;
    expect(verified).not.toContain("Classic CoolLEDX brightness hypothesis rejected");
  });

  it("keeps the CoolLEDX static transport match distinct from its rejected protocol evidence", () => {
    const markdown = generateMarkdownReport(baseData());
    const coolledx = markdown.split("### coolledx")[1]!.split("## Device state")[0]!;
    expect(coolledx).toContain("Static transport match: score 55");
    expect(coolledx).toContain("Protocol hypothesis rejected for this profile (static transport shape remains compatible)");
    expect(coolledx).toContain("REJECTED — Classic CoolLEDX brightness hypothesis rejected");
  });

  it("never reports untested areas as Unsupported", () => {
    const markdown = generateMarkdownReport(baseData());
    const support = markdown.split("## Support status")[1]!.split("## Device fingerprint")[0]!;
    expect(support).toContain("| Static framebuffer | Not tested |");
    expect(support).toContain("| Pixel orientation | Not tested |");
    expect(support).toContain("| Color encoding | Not tested |");
    expect(support).toContain("| Stored programs | Not tested |");
    expect(support).not.toContain("Unsupported");
  });

  it("separates live-session advertisement absence from captured profile geometry", () => {
    const fingerprint = { ...knownIledHatFingerprint(), rawAdvertisementHex: undefined, manufacturerDataHex: undefined };
    delete (fingerprint as Record<string, unknown>).rawAdvertisementHex;
    delete (fingerprint as Record<string, unknown>).manufacturerDataHex;
    const markdown = generateMarkdownReport(baseData({ fingerprint }));
    expect(markdown).toContain("Live-session advertisement: not available");
    expect(markdown).toContain("Captured/profile advertisement geometry: 32×16 (from captured advertisement evidence)");
    expect(markdown).toContain("Physical/profile geometry: 32×16");
  });

  it("advances suggested tests once brightness and protocol are verified", () => {
    const markdown = generateMarkdownReport(baseData());
    const suggested = markdown.split("## Suggested next tests")[1]!.split("## Reproduction environment")[0]!;
    expect(suggested).toContain("Validate static framebuffer");
    expect(suggested).not.toContain("Refresh device info.");
  });

  it("advances suggested tests to animation after static-frame validation passes", () => {
    const markdown = generateMarkdownReport(baseData({ validations: [passedStaticValidation()] }));
    const suggested = markdown.split("## Suggested next tests")[1]!.split("## Reproduction environment")[0]!;
    expect(suggested).toContain("Validate animation");
    expect(suggested).not.toContain("Validate static framebuffer with the guided");
  });

  it("marks orientation, color, static frame, and stored programs verified after a passing validation", () => {
    const markdown = generateMarkdownReport(baseData({ validations: [passedStaticValidation()] }));
    const support = markdown.split("## Support status")[1]!.split("## Device fingerprint")[0]!;
    expect(support).toContain("| Static framebuffer | Verified |");
    expect(support).toContain("| Pixel orientation | Verified |");
    expect(support).toContain("| Color encoding | Verified |");
    expect(support).toContain("| Stored programs | Verified |");
    expect(markdown).toContain("## Hardware validation results");
    expect(markdown).toContain("session-level physical validation");
  });

  it("records a failed validation as Rejected and keeps suggesting evidence capture", () => {
    const answers = STATIC_FRAME_VALIDATION.questions.map((q) => ({ questionId: q.id, answer: q.id === "corners" ? "no" as const : "yes" as const }));
    const outcome = evaluateValidationAnswers(STATIC_FRAME_VALIDATION, answers);
    expect(outcome.status).toBe("failed");
    const validation: SessionValidationResult = { id: "validation:test", workflowId: STATIC_FRAME_VALIDATION.id, recordedAt: "2026-08-31T13:00:00.000Z", profileId: iledHat31aeProfile.id, status: outcome.status, validatedAreas: outcome.validatedAreas, rejectedAreas: outcome.rejectedAreas, answers, transactionIds: [], findings: outcome.findings };
    const markdown = generateMarkdownReport(baseData({ validations: [validation] }));
    expect(markdown).toContain("| Pixel orientation | Rejected |");
    const rejectedSection = markdown.split("## Rejected hypotheses")[1]!.split("## Suggested next tests")[0]!;
    expect(rejectedSection).toContain("pixel-orientation");
  });

  it("omits user text content from compiler evidence unless enabled", () => {
    const record = {
      id: "compilation:test", createdAt: "2026-08-31T13:00:00.000Z", operation: "ShowText", contentType: "text" as const,
      profileId: iledHat31aeProfile.id, width: 32, height: 16, tileWidth: 8, tileCount: 4, programBytes: 1024,
      crc32: 0xdeadbeef, compressedBytes: 1152, compression: "lzss-safe" as const, chunkCount: 9, pacingMs: 60,
      textContent: "SECRET MESSAGE", textRendering: "local bitmap renderer",
    };
    const withText = generateMarkdownReport(baseData({ contentCompilations: [record] }), { ...DEFAULT_REPORT_OPTIONS, includeTextContent: true });
    const withoutText = generateMarkdownReport(baseData({ contentCompilations: [record] }));
    expect(withText).toContain("SECRET MESSAGE");
    expect(withoutText).not.toContain("SECRET MESSAGE");
    expect(withoutText).toContain("0xDEADBEEF");
    expect(withoutText).toContain("Chunks: 9 data packet(s) + 1 announce");
  });
});

describe("support matrix", () => {
  const base: SupportInput = {
    connected: true, live: true, resolvedDriverId: "coolledux",
    capabilities: coolLedUxCapabilities(iledHat31aeProfile), validations: [],
  };

  it("uses Unknown, not Unsupported, when no driver is resolved", () => {
    const matrix = computeSupportMatrix({ ...base, resolvedDriverId: null, capabilities: [] });
    expect(matrix.every((row) => row.state !== "Unsupported")).toBe(true);
    expect(matrix.find((row) => row.id === "static-frame")?.state).toBe("Unknown");
  });

  it("recommends connecting when nothing is connected", () => {
    expect(suggestNextTests({ ...base, connected: false, resolvedDriverId: null })[0]).toContain("Connect a display");
  });

  it("recommends identification before content validation", () => {
    expect(suggestNextTests({ ...base, resolvedDriverId: null })[0]).toContain("identification");
  });

  it("reports no required tests once everything is validated", () => {
    const answers = STATIC_FRAME_VALIDATION.questions.map((q) => ({ questionId: q.id, answer: "yes" as const }));
    const staticOutcome = evaluateValidationAnswers(STATIC_FRAME_VALIDATION, answers);
    const validations: SessionValidationResult[] = [
      { id: "v1", workflowId: STATIC_FRAME_VALIDATION.id, recordedAt: "t", profileId: null, status: "passed", validatedAreas: staticOutcome.validatedAreas, rejectedAreas: [], answers, transactionIds: [], findings: [] },
      { id: "v2", workflowId: "coolledux-validate-animation", recordedAt: "t", profileId: null, status: "passed", validatedAreas: ["animation", "persistence"], rejectedAreas: [], answers: [], transactionIds: [], findings: [] },
      { id: "v3", workflowId: "coolledux-validate-gif", recordedAt: "t", profileId: null, status: "passed", validatedAreas: ["gif"], rejectedAreas: [], answers: [], transactionIds: [], findings: [] },
    ];
    const suggestions = suggestNextTests({ ...base, validations });
    expect(suggestions[0]).toContain("No required diagnostic tests");
  });
});
