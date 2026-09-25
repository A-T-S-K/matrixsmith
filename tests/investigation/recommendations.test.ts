import { describe, expect, it } from "vitest";
import {
  rankRecommendations,
  recommendNextTest,
} from "../../src/investigation/recommendations";
import {
  evaluateTestAvailability,
  type GuidedTestAvailability,
} from "../../src/investigation/tests";
import { ILEDHAT_GUIDED_TESTS } from "../../src/drivers/coolledux/guided-tests";
import type { ClaimEvidence } from "../../src/investigation/claims";
import type {
  CompletedGuidedTest,
  InvestigationGoal,
} from "../../src/investigation/investigation";
import { uncharacterizedCoolLedUxEvidence } from "../helpers/evidence";

/**
 * These are all statements about how characterization is ORDERED, so they
 * start from a device whose static substrate is still open. The shipped
 * iLedHat profile is now productionized and cannot stand in for one.
 */
const baseline = uncharacterizedCoolLedUxEvidence();

function availabilities(
  evidence: readonly ClaimEvidence[],
  completed: readonly string[] = [],
): readonly GuidedTestAvailability[] {
  return ILEDHAT_GUIDED_TESTS.map((test) =>
    evaluateTestAvailability(test, evidence, completed),
  );
}

function completedTest(
  testId: string,
  status: CompletedGuidedTest["status"] = "passed",
): CompletedGuidedTest {
  return {
    testId,
    title: testId,
    startedAt: "2026-08-31T10:00:00.000Z",
    completedAt: "2026-08-31T10:01:00.000Z",
    status,
    observations: [],
    established: [],
    rejected: [],
    unknowns: [],
    summary: "",
    transactionIds: [],
  };
}

const developGoal: InvestigationGoal = {
  kind: "develop",
  description: "characterize",
};

describe("recommendation engine", () => {
  it("recommends a generically renderable action with why/time/risk", () => {
    const top = recommendNextTest({
      goal: developGoal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    expect(top).not.toBeNull();
    expect(top!.kind).toBe("guided-test");
    expect(top!.title.length).toBeGreaterThan(0);
    expect(top!.why.length).toBeGreaterThan(0);
    expect(top!.estimatedObservationTime.length).toBeGreaterThan(0);
    expect(top!.risk).toBe("persistent");
    expect(top!.consequence).toContain("replaces");
  });

  it("prioritizes discriminators for unresolved usability blockers over optional characterization", () => {
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    const ids = ranked.map((recommendation) => recommendation.testId);
    // static.strategy is unresolved: the animation-static and timing tests
    // must outrank optional color work.
    const staticIndex = ids.indexOf("coolledux-animation-static");
    expect(staticIndex).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("coolledux-color-white")).toBe(-1); // unavailable: channel map not verified
    const optionalIds = ranked
      .filter((recommendation) => recommendation.category === "optional")
      .map((r) => r.testId);
    for (const optionalId of optionalIds)
      expect(ids.indexOf(optionalId)).toBeGreaterThan(staticIndex);
  });

  it("does not recommend a passed test again", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "off",
      },
    ];
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, ["coolledux-graffiti-black"]),
      completedTests: [completedTest("coolledux-graffiti-black")],
    });
    expect(ranked.map((recommendation) => recommendation.testId)).not.toContain(
      "coolledux-graffiti-black",
    );
  });

  it("does not re-recommend a partial result: the same experiment would give the same non-answer", () => {
    // This is the loop the real session hit. A partial timing result leaves
    // its target claim unresolved, which used to make the identical
    // experiment look like the best next move — forever.
    const evidence: ClaimEvidence[] = [...baseline];
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, ["coolledux-graffiti-timing"]),
      completedTests: [completedTest("coolledux-graffiti-timing", "partial")],
    });
    expect(ranked.map((recommendation) => recommendation.testId)).not.toContain(
      "coolledux-graffiti-timing",
    );
  });

  it("still recommends a test that was abandoned before anything was observed", () => {
    const evidence: ClaimEvidence[] = [...baseline];
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, ["coolledux-graffiti-timing"]),
      completedTests: [completedTest("coolledux-graffiti-timing", "abandoned")],
    });
    expect(ranked.map((recommendation) => recommendation.testId)).toContain(
      "coolledux-graffiti-timing",
    );
  });

  it("recommends a concluded experiment again only when it was explicitly reopened", () => {
    const evidence: ClaimEvidence[] = [...baseline];
    const completedTests = [
      completedTest("coolledux-graffiti-timing", "partial"),
    ];
    const availability = availabilities(evidence, [
      "coolledux-graffiti-timing",
    ]);
    expect(
      rankRecommendations({
        goal: developGoal,
        evidence,
        availabilities: availability,
        completedTests,
      }).map((r) => r.testId),
    ).not.toContain("coolledux-graffiti-timing");
    expect(
      rankRecommendations({
        goal: developGoal,
        evidence,
        availabilities: availability,
        completedTests,
        reopenedTestIds: ["coolledux-graffiti-timing"],
      }).map((r) => r.testId),
    ).toContain("coolledux-graffiti-timing");
  });

  it("promotes the advanced stayTime discriminator when it unblocks static usability", () => {
    // After the timing test observed movement, stability is rejected and the
    // stayTime comparison becomes available.
    const evidence: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.playback-stability",
        status: "rejected",
        scope: "current-session",
        provenance: "observed",
        summary: "moved",
      },
    ];
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, ["coolledux-graffiti-timing"]),
      completedTests: [completedTest("coolledux-graffiti-timing", "partial")],
    });
    const staytime = ranked.find(
      (recommendation) =>
        recommendation.testId === "coolledux-graffiti-staytime",
    );
    expect(staytime).toBeDefined();
    expect(staytime!.category).toBe("recommended");
  });

  it("biases toward the symptom's focus claims when troubleshooting", () => {
    const goal: InvestigationGoal = {
      kind: "troubleshoot",
      symptomId: "content-moves-unexpectedly",
      description: "Content moves unexpectedly",
    };
    const ranked = rankRecommendations({
      goal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    const timing = ranked.find(
      (recommendation) => recommendation.testId === "coolledux-graffiti-timing",
    );
    const channels = ranked.find(
      (recommendation) => recommendation.testId === "coolledux-pixel-channels",
    );
    expect(timing).toBeDefined();
    expect(channels).toBeDefined();
    expect(timing!.score).toBeGreaterThan(channels!.score);
    expect(timing!.why).toContain("symptom");
  });

  it("biases toward color discriminators for a colors-look-wrong symptom", () => {
    const goal: InvestigationGoal = {
      kind: "troubleshoot",
      symptomId: "colors-look-wrong",
      description: "Colors look wrong",
    };
    const top = recommendNextTest({
      goal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    expect(top!.testId).toBe("coolledux-pixel-channels");
  });

  it("never surfaces unavailable tests", () => {
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    expect(ranked.map((r) => r.testId)).not.toContain("coolledux-color-white");
    expect(ranked.map((r) => r.testId)).not.toContain(
      "coolledux-graffiti-staytime",
    );
    expect(ranked.map((r) => r.testId)).not.toContain(
      "coolledux-animation-static-pair",
    );
  });
});

/**
 * §Native-static-first characterization order for the current iLedHat
 * evidence (see docs/architecture.md). These lock the expected walk:
 * baseline timing → stayTime=0 → black/channels → animation fallback only
 * once Graffiti is conclusively non-viable.
 */
describe("native-static-first ordering", () => {
  const session = (
    claimId: string,
    status = "verified",
    extra: object = {},
  ): ClaimEvidence =>
    ({
      claimId,
      status,
      scope: "current-session",
      provenance: "observed",
      summary: "session",
      ...extra,
    }) as ClaimEvidence;

  it("recommends the native Graffiti baseline timing test first, not the Animation fallback", () => {
    const top = recommendNextTest({
      goal: developGoal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    expect(top!.testId).toBe("coolledux-graffiti-timing");
  });

  it("recommends the stayTime=0 discriminator after baseline movement", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      session("graffiti.playback-stability", "unresolved"),
    ];
    const top = recommendNextTest({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, ["coolledux-graffiti-timing"]),
      completedTests: [completedTest("coolledux-graffiti-timing", "partial")],
    });
    expect(top!.testId).toBe("coolledux-graffiti-staytime");
  });

  it("advances to native channel characterization when both timing variants move", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      session("graffiti.playback-stability", "rejected"),
    ];
    const completed = [
      "coolledux-graffiti-timing",
      "coolledux-graffiti-staytime",
    ];
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, completed),
      completedTests: [
        completedTest("coolledux-graffiti-timing", "partial"),
        completedTest("coolledux-graffiti-staytime", "partial"),
      ],
    });
    // With Graffiti conclusively unstable, the pursued strategy becomes the
    // Animation fallback; its first open requirement is the channel map —
    // needed for correct rendering regardless of path — so the pixel test
    // outranks sending the fallback raster itself.
    expect(ranked[0]!.testId).toBe("coolledux-pixel-channels");
  });

  it("walks black semantics before channels when stayTime=0 holds still", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      session("graffiti.playback-stability", "verified", {
        metrics: { visibleStaticHoldMs: 16000 },
      }),
    ];
    const completed = [
      "coolledux-graffiti-timing",
      "coolledux-graffiti-staytime",
    ];
    const top = recommendNextTest({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, completed),
      completedTests: [
        completedTest("coolledux-graffiti-timing", "partial"),
        completedTest("coolledux-graffiti-staytime"),
      ],
    });
    expect(top!.testId).toBe("coolledux-graffiti-black");
  });

  it("does not recommend the Animation fallback while Graffiti viability is still open", () => {
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence: baseline,
      availabilities: availabilities(baseline),
      completedTests: [],
    });
    const timing = ranked.find(
      (recommendation) => recommendation.testId === "coolledux-graffiti-timing",
    )!;
    const fallback = ranked.find(
      (recommendation) =>
        recommendation.testId === "coolledux-animation-static",
    )!;
    expect(timing.score).toBeGreaterThan(fallback.score);
    // The fallback also ranks below the native black and channel tests.
    const black = ranked.find(
      (recommendation) => recommendation.testId === "coolledux-graffiti-black",
    )!;
    expect(black.score).toBeGreaterThan(fallback.score);
  });

  it("recommends the Animation fallback raster once Graffiti is non-viable and channels are characterized", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      session("graffiti.playback-stability", "rejected"),
      session("pixel.channel-map"),
      session("pixel.encoder-correctness"),
      session("pixel.fourth-channel", "rejected"),
      session("pixel.white-channel", "rejected"),
    ];
    const completed = [
      "coolledux-graffiti-timing",
      "coolledux-graffiti-staytime",
      "coolledux-pixel-channels",
    ];
    const top = recommendNextTest({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence, completed),
      completedTests: completed.map((testId) => completedTest(testId)),
    });
    expect(top!.testId).toBe("coolledux-animation-static");
  });
});

describe("historical conflict revalidation", () => {
  it("recommends revalidating a trusted claim contradicted by a previous local session", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "off today",
      },
      {
        claimId: "graffiti.black-semantics",
        status: "rejected",
        scope: "previous-local-session",
        provenance: "observed",
        summary: "white in an old session",
      },
    ];
    const ranked = rankRecommendations({
      goal: developGoal,
      evidence,
      availabilities: availabilities(evidence),
      completedTests: [],
    });
    const black = ranked.find(
      (recommendation) => recommendation.testId === "coolledux-graffiti-black",
    );
    expect(black).toBeDefined();
    expect(black!.why).toContain("historical session");
  });
});
