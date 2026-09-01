import { describe, expect, it } from "vitest";
import {
  createInvestigation, hasCompletedTest, investigationClaims, latestTestResult,
  recordCompletedTest, resumeInvestigation, stopInvestigation,
  SYMPTOM_FOCUS_CLAIMS, SYMPTOM_LABELS,
  type CompletedGuidedTest,
} from "../../src/investigation/investigation";
import { claimState } from "../../src/investigation/claims";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

function makeTest(overrides: Partial<CompletedGuidedTest> = {}): CompletedGuidedTest {
  return {
    testId: "coolledux-graffiti-black", title: "Test static-image black behavior",
    startedAt: "2026-08-31T10:00:00.000Z", completedAt: "2026-08-31T10:01:00.000Z",
    status: "passed", observations: [{ kind: "choice", fieldId: "zero-appearance", optionId: "off-black" }],
    established: ["Graffiti 0x0000 renders off/black on this iLedHat."], rejected: [], unknowns: [],
    summary: "0x0000 columns were off.", transactionIds: ["transaction:1"],
    ...overrides,
  };
}

describe("Investigation", () => {
  it("creates an active investigation with a goal", () => {
    const investigation = createInvestigation({ profileId: iledHat31aeProfile.id, deviceName: "iLedHat", goal: { kind: "develop", description: "Characterize static rendering" } });
    expect(investigation.status).toBe("active");
    expect(investigation.completedTests).toHaveLength(0);
    expect(investigation.goal.kind).toBe("develop");
  });

  it("records completed tests with their claim evidence", () => {
    let investigation = createInvestigation({ profileId: iledHat31aeProfile.id, deviceName: "iLedHat", goal: { kind: "develop", description: "" } });
    investigation = recordCompletedTest(investigation, makeTest(), [
      { claimId: "graffiti.black-semantics", status: "verified", scope: "current-session", provenance: "observed", summary: "0x0000 off", testId: "coolledux-graffiti-black" },
    ]);
    expect(hasCompletedTest(investigation, "coolledux-graffiti-black")).toBe(true);
    expect(latestTestResult(investigation, "coolledux-graffiti-black")?.status).toBe("passed");
    const claims = investigationClaims(investigation);
    expect(claims.find((claim) => claim.id === "graffiti.black-semantics")?.status).toBe("verified");
  });

  it("combines session evidence with baseline evidence, current session winning", () => {
    let investigation = createInvestigation({ profileId: iledHat31aeProfile.id, deviceName: "iLedHat", goal: { kind: "develop", description: "" } });
    investigation = recordCompletedTest(investigation, makeTest({ status: "failed" }), [
      { claimId: "graffiti.black-semantics", status: "rejected", scope: "current-session", provenance: "observed", summary: "0x0000 rendered bright white here too", testId: "coolledux-graffiti-black" },
    ]);
    const base = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);
    const claims = investigationClaims(investigation, base);
    expect(claims.find((claim) => claim.id === "graffiti.black-semantics")?.status).toBe("rejected");
    // Baseline facts untouched by the session remain visible.
    expect(claims.find((claim) => claim.id === "brightness.control")?.status).toBe("verified");
  });

  it("keeps failed tests as useful evidence rather than discarding them", () => {
    let investigation = createInvestigation({ profileId: iledHat31aeProfile.id, deviceName: "iLedHat", goal: { kind: "develop", description: "" } });
    const failed = makeTest({
      testId: "coolledux-graffiti-timing", status: "partial",
      established: ["Upload worked.", "Full raster appeared.", "Tiles aligned."],
      rejected: ["Image did not remain static; movement began after 3.2 seconds."],
    });
    investigation = recordCompletedTest(investigation, failed, [
      { claimId: "graffiti.initial-render", status: "verified", scope: "current-session", provenance: "observed", summary: "raster appeared", testId: failed.testId },
      { claimId: "graffiti.playback-stability", status: "rejected", scope: "current-session", provenance: "observed", summary: "movement after 3.2 s", testId: failed.testId },
    ]);
    const claims = investigationClaims(investigation);
    expect(claims.find((claim) => claim.id === "graffiti.initial-render")?.status).toBe("verified");
    expect(claims.find((claim) => claim.id === "graffiti.playback-stability")?.status).toBe("rejected");
    expect(latestTestResult(investigation, failed.testId)?.rejected).toHaveLength(1);
  });

  it("supports stop and resume without losing evidence", () => {
    let investigation = createInvestigation({ profileId: null, deviceName: null, goal: { kind: "troubleshoot", symptomId: "content-moves-unexpectedly", description: SYMPTOM_LABELS["content-moves-unexpectedly"] } });
    investigation = recordCompletedTest(investigation, makeTest(), []);
    investigation = stopInvestigation(investigation);
    expect(investigation.status).toBe("stopped");
    investigation = resumeInvestigation(investigation);
    expect(investigation.status).toBe("active");
    expect(investigation.completedTests).toHaveLength(1);
  });

  it("maps every symptom to labels and focus claims", () => {
    for (const symptomId of Object.keys(SYMPTOM_LABELS) as (keyof typeof SYMPTOM_LABELS)[]) {
      expect(SYMPTOM_LABELS[symptomId].length).toBeGreaterThan(0);
      expect(SYMPTOM_FOCUS_CLAIMS[symptomId]).toBeDefined();
    }
  });

  it("round-trips through JSON serialization", () => {
    let investigation = createInvestigation({ profileId: iledHat31aeProfile.id, deviceName: "iLedHat", goal: { kind: "develop", description: "x" } });
    investigation = recordCompletedTest(investigation, makeTest({
      observations: [
        { kind: "boolean", fieldId: "still", value: "yes" },
        { kind: "duration", fieldId: "movement-start", milliseconds: 3200, measuredBy: "matrixsmith-timer" },
        { kind: "choice", fieldId: "appearance", optionId: "other", otherText: "purple-ish" },
        { kind: "number", fieldId: "count", value: 4 },
        { kind: "note", fieldId: "note", text: "small flicker" },
      ],
    }), []);
    const parsed = JSON.parse(JSON.stringify(investigation)) as typeof investigation;
    expect(parsed).toEqual(investigation);
    expect(claimState("brightness.control", parsed.claimEvidence).status).toBe("unknown");
  });
});
