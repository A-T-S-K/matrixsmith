import type { ClaimEvidence, ClaimId } from "./claims";
import { operationalTrust } from "./claims";
import type { CompletedGuidedTest } from "./investigation";

/**
 * A bounded, numbered core plan.
 *
 * Guided mode used to present itself as an open-ended chain: every screen
 * offered "the next test" and nothing ever said how many remained or when the
 * work would be done. A user with a missed timing observation could not tell
 * a retry from progress, and had no way to know whether they were three tests
 * from an answer or thirty.
 *
 * A core plan fixes a small set of milestones — a driver contributes them for
 * a profile — so the product can say "Test 3 of 6" and mean it. Milestones
 * are SLOTS, not a script: a slot can be satisfied by evidence, or skipped
 * when the branch taken makes it unnecessary, and the denominator stays
 * stable either way. Everything past the core plan is explicitly optional.
 */

export type CorePlanStepState = "complete" | "current" | "pending" | "skipped";

export interface CorePlanStep {
  readonly id: string;
  /** Stable 1-based position. Never renumbered by branching. */
  readonly ordinal: number;
  readonly title: string;
  /** What the user learns from this milestone, in their language. */
  readonly purpose: string;
  /** Guided tests that can satisfy this milestone. */
  readonly testIds: readonly string[];
  /** Claims whose trusted resolution satisfies this milestone. */
  readonly satisfiedBy: readonly ClaimId[];
  /**
   * Whether this milestone is unnecessary given the evidence so far — e.g. a
   * fallback slot once the native path is already proven. A skipped slot
   * keeps its number so progress never appears to move backwards.
   */
  skipWhen?(evidence: readonly ClaimEvidence[]): string | null;
}

export interface CorePlan {
  readonly id: string;
  readonly profileId: string;
  readonly title: string;
  readonly steps: readonly CorePlanStep[];
}

export interface CorePlanStepStatus {
  readonly step: CorePlanStep;
  readonly state: CorePlanStepState;
  /** Why a skipped step was not needed. */
  readonly skipReason: string | null;
}

export interface CorePlanProgress {
  readonly plan: CorePlan;
  readonly steps: readonly CorePlanStepStatus[];
  /**
   * Every numbered slot in the plan. STABLE for the whole investigation: it
   * is the denominator of "Test 5 of 6" and must not move because a branch
   * made a milestone unnecessary. Watching the total shrink under you is
   * exactly what made bounded progress feel unbounded.
   */
  readonly total: number;
  readonly completed: number;
  readonly skipped: number;
  /** Slots that need no further work: completed + skipped. */
  readonly resolved: number;
  readonly current: CorePlanStepStatus | null;
  readonly complete: boolean;
}

/**
 * A milestone is complete when its claims hold a trusted resolution — either
 * verified or conclusively rejected. A rejected requirement is a real answer:
 * "this path does not work" advances the investigation exactly as much as
 * "it does", and treating it as unfinished is what produced the endless loop.
 */
function stepSatisfied(
  step: CorePlanStep,
  evidence: readonly ClaimEvidence[],
  completedTestIds: ReadonlySet<string>,
): boolean {
  if (step.satisfiedBy.length === 0)
    return step.testIds.some((id) => completedTestIds.has(id));
  return step.satisfiedBy.every((claimId) => {
    const trust = operationalTrust(claimId, evidence);
    return trust.trusted || trust.trustedStatus === "rejected";
  });
}

export function evaluateCorePlan(
  plan: CorePlan,
  evidence: readonly ClaimEvidence[],
  completedTests: readonly CompletedGuidedTest[],
): CorePlanProgress {
  const completedTestIds = new Set(completedTests.map((test) => test.testId));
  const statuses: CorePlanStepStatus[] = [];
  let currentAssigned = false;
  for (const step of plan.steps) {
    const skipReason = step.skipWhen?.(evidence) ?? null;
    if (skipReason !== null) {
      statuses.push({ step, state: "skipped", skipReason });
      continue;
    }
    if (stepSatisfied(step, evidence, completedTestIds)) {
      statuses.push({ step, state: "complete", skipReason: null });
      continue;
    }
    if (!currentAssigned) {
      statuses.push({ step, state: "current", skipReason: null });
      currentAssigned = true;
      continue;
    }
    statuses.push({ step, state: "pending", skipReason: null });
  }
  const skipped = statuses.filter((entry) => entry.state === "skipped").length;
  const completed = statuses.filter(
    (entry) => entry.state === "complete",
  ).length;
  // The denominator is every slot in the plan, always. A skipped milestone
  // keeps its ordinal and is shown as skipped; it does not leave the count.
  // Completion is "every slot resolved", where a skipped slot is resolved —
  // so "5 complete · 1 skipped" reads as 6 of 6, not as 5 of 5.
  const total = statuses.length;
  const resolved = completed + skipped;
  return {
    plan,
    steps: statuses,
    total,
    completed,
    skipped,
    resolved,
    current: statuses.find((entry) => entry.state === "current") ?? null,
    complete: resolved >= total,
  };
}

/**
 * The milestone a guided test is serving right now.
 *
 * A test can appear in more than one milestone — the baseline timing run
 * answers both "does it render" and "does it hold still" — so the milestone
 * that matters is the first one still outstanding. Labelling by the first
 * milestone that merely mentions the test would tell a user they are on
 * "Test 1 of 6" while the plan has already moved past it.
 */
export function stepForTest(
  plan: CorePlan | null,
  testId: string,
  progress?: CorePlanProgress | null,
): CorePlanStep | null {
  const candidates =
    plan?.steps.filter((step) => step.testIds.includes(testId)) ?? [];
  if (candidates.length === 0) return null;
  if (progress) {
    const outstanding = candidates.find((step) => {
      const state = progress.steps.find(
        (entry) => entry.step.id === step.id,
      )?.state;
      return state === "current" || state === "pending";
    });
    if (outstanding) return outstanding;
  }
  return candidates[0] ?? null;
}

/**
 * The milestone's display position, for "Test X of Y".
 *
 * This is the slot's own stable ordinal — never a running count over the
 * non-skipped steps. Renumbering on a branch decision made Test 6 become
 * Test 5 mid-investigation, which is precisely what stable numbering exists
 * to prevent.
 */
export function displayPosition(
  progress: CorePlanProgress,
  stepId: string,
): number | null {
  return (
    progress.steps.find((entry) => entry.step.id === stepId)?.step.ordinal ??
    null
  );
}
