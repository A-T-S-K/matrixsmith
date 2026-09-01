import { describe, expect, it } from "vitest";
import { displayPosition, evaluateCorePlan, type CorePlan } from "../../src/investigation/core-plan";
import { ILEDHAT_CORE_PLAN } from "../../src/drivers/coolledux/core-plan";
import type { ClaimEvidence } from "../../src/investigation/claims";

/**
 * Stable milestone numbering.
 *
 * The product promise is bounded progress: "Test 5 of 6" has to mean the same
 * thing at the end of an investigation as it did at the start. Deducting a
 * skipped milestone from the denominator turned "Test 6 of 6" into "Test 5 of
 * 5" mid-session, which reads as the plan shrinking under the user rather
 * than as a branch closing.
 */

const PLAN: CorePlan = {
  id: "numbering-test", profileId: "test", title: "Six slots",
  steps: [1, 2, 3, 4, 5, 6].map((ordinal) => ({
    id: `step-${ordinal}`, ordinal, title: `Step ${ordinal}`, purpose: "test",
    testIds: [`test-${ordinal}`], satisfiedBy: [],
    ...(ordinal === 5 ? { skipWhen: () => "the branch that needed it was closed" } : {}),
  })),
};

const completed = (ids: readonly string[]) => ids.map((testId) => ({
  testId, title: testId, startedAt: "", completedAt: "", status: "passed" as const,
  observations: [], established: [], rejected: [], unknowns: [], summary: "", transactionIds: [],
}));

const NO_EVIDENCE: readonly ClaimEvidence[] = [];

describe("the denominator never moves", () => {
  it("counts every slot in the plan, skipped ones included", () => {
    const progress = evaluateCorePlan(PLAN, NO_EVIDENCE, []);
    expect(progress.total).toBe(6);
    expect(progress.skipped).toBe(1);
    expect(progress.steps).toHaveLength(6);
  });

  it("keeps the skipped milestone at its own ordinal", () => {
    const progress = evaluateCorePlan(PLAN, NO_EVIDENCE, []);
    const skipped = progress.steps.find((entry) => entry.state === "skipped")!;
    expect(skipped.step.ordinal).toBe(5);
    expect(skipped.skipReason).toBe("the branch that needed it was closed");
    expect(displayPosition(progress, "step-5")).toBe(5);
    // The slot AFTER a skipped one keeps its own number too — this is the
    // "Test 6 of 6 must not become Test 5 of 5" case.
    expect(displayPosition(progress, "step-6")).toBe(6);
  });

  it("reports completion as completed + skipped", () => {
    const progress = evaluateCorePlan(PLAN, NO_EVIDENCE, completed(["test-1", "test-2", "test-3", "test-4", "test-6"]));
    expect(progress.completed).toBe(5);
    expect(progress.skipped).toBe(1);
    expect(progress.resolved).toBe(6);
    expect(progress.total).toBe(6);
    expect(progress.complete).toBe(true);
  });

  it("is not complete while an unskipped slot is outstanding", () => {
    const progress = evaluateCorePlan(PLAN, NO_EVIDENCE, completed(["test-1", "test-2", "test-3", "test-4"]));
    expect(progress.resolved).toBe(5);
    expect(progress.complete).toBe(false);
    expect(progress.current?.step.ordinal).toBe(6);
  });

  it("holds the total steady as a branch closes mid-investigation", () => {
    const neverSkips: CorePlan = { ...PLAN, steps: PLAN.steps.map((step) => ({ ...step, skipWhen: undefined })) };
    const before = evaluateCorePlan(neverSkips, NO_EVIDENCE, []);
    const after = evaluateCorePlan(PLAN, NO_EVIDENCE, []);
    expect(before.total).toBe(after.total);
    expect(displayPosition(before, "step-6")).toBe(displayPosition(after, "step-6"));
  });
});

describe("the shipped iLedHat plan", () => {
  it("has six stable slots numbered 1 to 6", () => {
    expect(ILEDHAT_CORE_PLAN.steps.map((step) => step.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    const progress = evaluateCorePlan(ILEDHAT_CORE_PLAN, NO_EVIDENCE, []);
    expect(progress.total).toBe(6);
  });

  it("keeps the support decision at position 6 once the fallback is skipped", () => {
    // The native path is proven, so the fallback slot is unnecessary.
    const evidence: ClaimEvidence[] = [
      { claimId: "stored-program.upload", status: "verified", scope: "current-session", provenance: "observed", summary: "uploads" },
      { claimId: "raster.tiling", status: "verified", scope: "current-session", provenance: "observed", summary: "tiles aligned" },
      { claimId: "raster.orientation", status: "verified", scope: "current-session", provenance: "observed", summary: "upright" },
      { claimId: "graffiti.initial-render", status: "verified", scope: "current-session", provenance: "observed", summary: "renders" },
      { claimId: "graffiti.playback-stability", status: "verified", scope: "current-session", provenance: "observed", summary: "holds still", metrics: { visibleStaticHoldMs: 20000 } },
      { claimId: "graffiti.black-semantics", status: "verified", scope: "current-session", provenance: "observed", summary: "true black" },
      { claimId: "pixel.channel-map", status: "verified", scope: "current-session", provenance: "observed", summary: "RGB444" },
      { claimId: "pixel.encoder-correctness", status: "verified", scope: "current-session", provenance: "observed", summary: "encoder matches" },
    ];
    const progress = evaluateCorePlan(ILEDHAT_CORE_PLAN, evidence, []);
    const fallback = progress.steps.find((entry) => entry.step.id === "fallback-viability")!;
    expect(fallback.state).toBe("skipped");
    expect(fallback.step.ordinal).toBe(5);
    expect(progress.total).toBe(6);
    expect(displayPosition(progress, "final-verification")).toBe(6);
  });
});
