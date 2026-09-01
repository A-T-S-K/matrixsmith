import { describe, expect, it } from "vitest";
import { rankRecommendations, recommendNextTest } from "../../src/investigation/recommendations";
import { evaluateTestAvailability, type GuidedTestAvailability } from "../../src/investigation/tests";
import { COOLLEDUX_GUIDED_TESTS } from "../../src/drivers/coolledux/guided-tests";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import type { ClaimEvidence } from "../../src/investigation/claims";
import type { CompletedGuidedTest, InvestigationGoal } from "../../src/investigation/investigation";

const baseline = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);

function availabilities(evidence: readonly ClaimEvidence[], completed: readonly string[] = []): readonly GuidedTestAvailability[] {
  return COOLLEDUX_GUIDED_TESTS.map((test) => evaluateTestAvailability(test, evidence, completed));
}

function completedTest(testId: string, status: CompletedGuidedTest["status"] = "passed"): CompletedGuidedTest {
  return { testId, title: testId, startedAt: "2026-08-31T10:00:00.000Z", completedAt: "2026-08-31T10:01:00.000Z", status, observations: [], established: [], rejected: [], unknowns: [], summary: "", transactionIds: [] };
}

const developGoal: InvestigationGoal = { kind: "develop", description: "characterize" };

describe("recommendation engine", () => {
  it("recommends a generically renderable action with why/time/risk", () => {
    const top = recommendNextTest({ goal: developGoal, evidence: baseline, availabilities: availabilities(baseline), completedTests: [] });
    expect(top).not.toBeNull();
    expect(top!.kind).toBe("guided-test");
    expect(top!.title.length).toBeGreaterThan(0);
    expect(top!.why.length).toBeGreaterThan(0);
    expect(top!.estimatedObservationTime.length).toBeGreaterThan(0);
    expect(top!.risk).toBe("persistent");
    expect(top!.consequence).toContain("replaces");
  });

  it("prioritizes discriminators for unresolved usability blockers over optional characterization", () => {
    const ranked = rankRecommendations({ goal: developGoal, evidence: baseline, availabilities: availabilities(baseline), completedTests: [] });
    const ids = ranked.map((recommendation) => recommendation.testId);
    // static.strategy is unresolved: the animation-static and timing tests
    // must outrank optional color work.
    const staticIndex = ids.indexOf("coolledux-animation-static");
    expect(staticIndex).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("coolledux-color-white")).toBe(-1); // unavailable: channel map not verified
    const optionalIds = ranked.filter((recommendation) => recommendation.category === "optional").map((r) => r.testId);
    for (const optionalId of optionalIds) expect(ids.indexOf(optionalId)).toBeGreaterThan(staticIndex);
  });

  it("does not recommend a passed test again", () => {
    const evidence: ClaimEvidence[] = [...baseline, { claimId: "graffiti.black-semantics", status: "verified", scope: "current-session", provenance: "observed", summary: "off" }];
    const ranked = rankRecommendations({ goal: developGoal, evidence, availabilities: availabilities(evidence, ["coolledux-graffiti-black"]), completedTests: [completedTest("coolledux-graffiti-black")] });
    expect(ranked.map((recommendation) => recommendation.testId)).not.toContain("coolledux-graffiti-black");
  });

  it("keeps recommending a test whose targets stay unresolved after a partial result", () => {
    const evidence: ClaimEvidence[] = [...baseline];
    const ranked = rankRecommendations({ goal: developGoal, evidence, availabilities: availabilities(evidence, ["coolledux-graffiti-timing"]), completedTests: [completedTest("coolledux-graffiti-timing", "partial")] });
    expect(ranked.map((recommendation) => recommendation.testId)).toContain("coolledux-graffiti-timing");
  });

  it("promotes the advanced stayTime discriminator when it unblocks static usability", () => {
    // After the timing test observed movement, stability is rejected and the
    // stayTime comparison becomes available.
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "graffiti.playback-stability", status: "rejected", scope: "current-session", provenance: "observed", summary: "moved" },
    ];
    const ranked = rankRecommendations({ goal: developGoal, evidence, availabilities: availabilities(evidence, ["coolledux-graffiti-timing"]), completedTests: [completedTest("coolledux-graffiti-timing", "partial")] });
    const staytime = ranked.find((recommendation) => recommendation.testId === "coolledux-graffiti-staytime");
    expect(staytime).toBeDefined();
    expect(staytime!.category).toBe("recommended");
  });

  it("biases toward the symptom's focus claims when troubleshooting", () => {
    const goal: InvestigationGoal = { kind: "troubleshoot", symptomId: "content-moves-unexpectedly", description: "Content moves unexpectedly" };
    const ranked = rankRecommendations({ goal, evidence: baseline, availabilities: availabilities(baseline), completedTests: [] });
    const timing = ranked.find((recommendation) => recommendation.testId === "coolledux-graffiti-timing");
    const channels = ranked.find((recommendation) => recommendation.testId === "coolledux-pixel-channels");
    expect(timing).toBeDefined();
    expect(channels).toBeDefined();
    expect(timing!.score).toBeGreaterThan(channels!.score);
    expect(timing!.why).toContain("symptom");
  });

  it("biases toward color discriminators for a colors-look-wrong symptom", () => {
    const goal: InvestigationGoal = { kind: "troubleshoot", symptomId: "colors-look-wrong", description: "Colors look wrong" };
    const top = recommendNextTest({ goal, evidence: baseline, availabilities: availabilities(baseline), completedTests: [] });
    expect(top!.testId).toBe("coolledux-pixel-channels");
  });

  it("never surfaces unavailable tests", () => {
    const ranked = rankRecommendations({ goal: developGoal, evidence: baseline, availabilities: availabilities(baseline), completedTests: [] });
    expect(ranked.map((r) => r.testId)).not.toContain("coolledux-color-white");
    expect(ranked.map((r) => r.testId)).not.toContain("coolledux-graffiti-staytime");
    expect(ranked.map((r) => r.testId)).not.toContain("coolledux-animation-static-pair");
  });
});
