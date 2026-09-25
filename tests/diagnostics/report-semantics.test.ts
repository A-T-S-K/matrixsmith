import { describe, expect, it } from "vitest";
import { assessDevice } from "../../src/domain/device/assessment";
import {
  generateMarkdownReport,
  type ReportData,
} from "../../src/diagnostics/report";
import {
  coolLedUxCapabilities,
  coolLedUxDriver,
} from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";

function data(): ReportData {
  const fingerprint = knownIledHatFingerprint();
  const capabilities = coolLedUxCapabilities(iledHat31aeProfile);
  return {
    createdAt: "2026-09-02T00:00:00.000Z",
    matrixsmithVersion: "0.1.0",
    fingerprint,
    profile: iledHat31aeProfile,
    selectedDriver: "coolledux",
    driverMatches: [
      {
        driverId: "coolledux",
        score: 100,
        confidence: "exact",
        reasons: ["Known profile"],
        contradictions: [],
      },
    ],
    capabilities,
    assessment: assessDevice({
      target: {
        kind: "profile-resolved",
        fingerprint,
        driverId: "coolledux",
        profile: iledHat31aeProfile,
      },
      evidence: coolLedUxDriver.claimEvidence?.(iledHat31aeProfile) ?? [],
      capabilities,
      operations: coolLedUxDriver.operations,
      live: true,
    }),
    transactions: [],
    diagnosticRuns: [],
    observations: [],
    trace: [],
    protocolResolution: null,
    contentCompilations: [],
    importedEvidence: [],
    liveConnected: true,
    source: "live",
  };
}

describe("canonical report semantics", () => {
  it("uses the same availability, confidence, and recommendation as the application assessment", () => {
    const input = data();
    const markdown = generateMarkdownReport(input);
    expect(markdown).toContain(
      "| Capability | Availability | Confidence | Reason |",
    );
    expect(markdown).toContain(
      "| Static frame (verified one-frame Animation route) | available | verified |",
    );
    expect(markdown).toContain(
      "- Display it: Available with trusted device evidence.",
    );
  });

  it("keeps rejected hypotheses separate from verified facts", () => {
    const markdown = generateMarkdownReport(data());
    const verified = markdown
      .split("## Verified facts")[1]!
      .split("## Inferred facts")[0]!;
    const rejected = markdown
      .split("## Rejected hypotheses")[1]!
      .split("## Suggested next step")[0]!;
    expect(rejected).toContain(
      "Classic CoolLEDX brightness hypothesis rejected",
    );
    expect(verified).not.toContain(
      "Classic CoolLEDX brightness hypothesis rejected",
    );
  });

  it("never includes opaque browser identifiers by default", () => {
    expect(generateMarkdownReport(data())).not.toContain("fixture-device");
  });
});
