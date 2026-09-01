import type { ClaimEvidence, ClaimId, ClaimState, ClaimStatus } from "./claims";
import { claimConflicts, claimDefinition, resolveClaims } from "./claims";
import type { GuidedTestAvailability, GuidedTestCategory } from "./tests";
import type { CompletedGuidedTest, InvestigationGoal } from "./investigation";
import { completedTestResolution, SYMPTOM_FOCUS_CLAIMS } from "./investigation";
import { leavesAutomaticRotation } from "./orchestration";
import { evaluateStaticViability, STRATEGY_PREFERENCE } from "./static-viability";
import type { RasterStrategy } from "../core/raster-strategy";

/**
 * Deterministic, inspectable next-test recommendation engine. No AI, no
 * hardcoded per-test action names: recommendations derive from the goal,
 * the current atomic claim states, each available test's declared target
 * claims, and safety. The output carries everything a UI needs to render
 * generically.
 */

export interface Recommendation {
  readonly id: string;
  readonly kind: "guided-test";
  readonly testId: string;
  readonly title: string;
  readonly description: string;
  readonly why: string;
  readonly estimatedObservationTime: string;
  readonly risk: string;
  readonly consequence: string;
  readonly category: GuidedTestCategory;
  /** The unresolved claims this test discriminates, for inspection. */
  readonly targets: readonly ClaimId[];
  readonly score: number;
}

export interface RecommendationInput {
  readonly goal: InvestigationGoal | null;
  readonly evidence: readonly ClaimEvidence[];
  readonly availabilities: readonly GuidedTestAvailability[];
  readonly completedTests: readonly CompletedGuidedTest[];
  /**
   * Experiments the user deliberately reopened. A completed experiment is
   * never recommended on its own; reopening is always an explicit act.
   */
  readonly reopenedTestIds?: readonly string[];
  /**
   * Tests belonging to the current core milestone. The plan decides the
   * ORDER of core work; scoring still decides which test within a milestone
   * is the best discriminator. Without this the engine could jump from the
   * first milestone straight to the fifth because that test happened to
   * score higher, which is exactly what made progress feel arbitrary.
   */
  readonly currentCoreTestIds?: readonly string[];
  /** Tests belonging to any core milestone, so core outranks optional work. */
  readonly coreTestIds?: readonly string[];
}

/**
 * Whether a completed run takes its experiment out of automatic rotation.
 *
 * "Settled" means the experiment answered its question — positively or
 * negatively — and re-running it unprompted would only reproduce the same
 * answer. That is what stopped guided mode looping on the same static-image
 * test forever.
 *
 * A `retryable-incomplete` run also leaves automatic rotation, but for the
 * opposite reason: the engine must not quietly hand the same experiment back
 * as though it were new work. Repeating it is legitimate and is offered as an
 * explicit "measure again" — see `retryableIncompleteTestIds`.
 */
export function isConcludedTest(test: CompletedGuidedTest): boolean {
  const resolution = completedTestResolution(test);
  return leavesAutomaticRotation(resolution) || resolution === "retryable-incomplete";
}

/**
 * Experiments whose measurement did not gather enough to answer, and which
 * the user may therefore repeat unchanged. The plan stays on the milestone
 * these belong to: an incomplete measurement is not progress, but it is also
 * not a dead end.
 */
export function retryableIncompleteTestIds(completedTests: readonly CompletedGuidedTest[]): readonly string[] {
  const latest = new Map<string, CompletedGuidedTest>();
  for (const test of completedTests) latest.set(test.testId, test);
  return [...latest.values()]
    .filter((test) => completedTestResolution(test) === "retryable-incomplete")
    .map((test) => test.testId);
}

/** How much resolving a claim in this status is worth. */
const STATUS_VALUE: Readonly<Record<ClaimStatus, number>> = {
  unresolved: 30,
  unknown: 20,
  "source-supported": 12,
  rejected: 8,
  verified: 0,
};

const CATEGORY_WEIGHT: Readonly<Record<GuidedTestCategory, number>> = {
  core: 40,
  recommended: 30,
  advanced: 10,
  optional: 2,
};

/**
 * Claims whose resolution directly advances normal everyday usability.
 * A test that unblocks one of these gets promoted even if it is
 * classified "advanced".
 */
const USABILITY_CLAIMS: readonly ClaimId[] = ["static.strategy", "stored-program.upload", "brightness.control", "transport.bluetooth", "protocol.coolledux"];

/**
 * Claims that exist only to prove one specific static strategy. Tests
 * targeting a strategy LATER in the native-first preference order than the
 * currently pursued strategy are fallbacks: heavily deprioritized until the
 * pursued strategy is conclusively non-viable.
 */
const STRATEGY_SPECIFIC_CLAIMS: Readonly<Partial<Record<ClaimId, RasterStrategy>>> = Object.freeze({
  "graffiti.playback-stability": "graffiti",
  "graffiti.black-semantics": "graffiti",
  "animation.static-single-frame": "animation-single-frame",
  "animation.static-identical-pair": "animation-identical-frames",
});

/** The pursued strategy's first open viability requirement is the next-highest-value discriminator. */
const FIRST_OPEN_REQUIREMENT_BOOST = 60;
/** The current milestone dominates: the plan is what makes progress legible. */
const CURRENT_CORE_STEP_BOOST = 200;
const CORE_PLAN_BOOST = 80;
const FALLBACK_STRATEGY_PENALTY = 50;
const REPEATED_TEST_PENALTY = 25;

export function rankRecommendations(input: RecommendationInput): readonly Recommendation[] {
  const claims = resolveClaims(input.evidence);
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const reopened = new Set(input.reopenedTestIds ?? []);
  // Concluded experiments leave the automatic rotation entirely. Anything
  // that should run again does so because the user asked for it.
  const concludedTestIds = new Set(
    input.completedTests.filter((test) => isConcludedTest(test) && !reopened.has(test.testId)).map((test) => test.testId),
  );
  const attemptedTestIds = new Set(input.completedTests.map((test) => test.testId));
  const currentCore = new Set(input.currentCoreTestIds ?? []);
  const coreTests = new Set(input.coreTestIds ?? []);
  const assessment = evaluateStaticViability(input.evidence);
  const pursuedIndex = assessment.pursued ? STRATEGY_PREFERENCE.indexOf(assessment.pursued) : STRATEGY_PREFERENCE.length;
  // Historical/imported contradictions of a trusted basis make revalidation
  // valuable even though the claim still resolves as decided.
  const conflictedClaims = new Set(claimConflicts(input.evidence).map((conflict) => conflict.claimId));
  const focusList = input.goal?.symptomId ? SYMPTOM_FOCUS_CLAIMS[input.goal.symptomId] : [];
  const focusClaims = new Set(focusList);
  const primaryFocus = focusList[0] ?? null;
  const usabilityBlockers = new Set(USABILITY_CLAIMS.filter((claimId) => {
    const status = byId.get(claimId)?.status;
    return status === "unresolved" || status === "unknown" || status === "rejected";
  }));

  const scored: Recommendation[] = [];
  for (const availability of input.availabilities) {
    if (!availability.available) continue;
    if (concludedTestIds.has(availability.test.id)) continue;
    const targets = availability.test.targetClaims.filter((claimId) => {
      const status = byId.get(claimId)?.status ?? "unknown";
      return status !== "verified" || conflictedClaims.has(claimId);
    });
    if (targets.length === 0) continue;
    const informationValue = targets.reduce((total, claimId) => total + STATUS_VALUE[byId.get(claimId)?.status ?? "unknown"] + (conflictedClaims.has(claimId) ? 20 : 0), 0);
    const unblocksUsability = targets.some((claimId) => usabilityBlockers.has(claimId) || claimDefinitionUnblocks(claimId, usabilityBlockers));
    // The symptom's FIRST focus claim is its most direct discriminator and
    // outweighs secondary focus claims.
    const focusBoost = (targets.some((claimId) => focusClaims.has(claimId)) ? 60 : 0)
      + (primaryFocus !== null && targets.includes(primaryFocus) ? 30 : 0);
    // An advanced test that is the discriminator for a usability blocker is
    // temporarily treated as recommended.
    const effectiveCategory: GuidedTestCategory = unblocksUsability && availability.test.category === "advanced" ? "recommended" : availability.test.category;
    // Native-static-first ordering: the pursued strategy's first open
    // viability requirement is the best next discriminator, and tests that
    // only prove a LATER (fallback) strategy wait until the pursued one is
    // conclusively non-viable.
    const firstOpenBoost = assessment.nextOpenRequirement !== null && targets.includes(assessment.nextOpenRequirement) ? FIRST_OPEN_REQUIREMENT_BOOST : 0;
    const isFallbackStrategyTest = targets.some((claimId) => {
      const strategy = STRATEGY_SPECIFIC_CLAIMS[claimId];
      return strategy !== undefined && STRATEGY_PREFERENCE.indexOf(strategy) > pursuedIndex;
    });
    const score = informationValue + CATEGORY_WEIGHT[effectiveCategory] + focusBoost + (unblocksUsability ? 25 : 0)
      + (availability.test.risk === "read-only" ? 5 : 0)
      + firstOpenBoost
      + (currentCore.has(availability.test.id) ? CURRENT_CORE_STEP_BOOST : 0)
      + (coreTests.has(availability.test.id) ? CORE_PLAN_BOOST : 0)
      - (isFallbackStrategyTest ? FALLBACK_STRATEGY_PENALTY : 0)
      - (attemptedTestIds.has(availability.test.id) ? REPEATED_TEST_PENALTY : 0);
    scored.push({
      id: `recommend:${availability.test.id}`,
      kind: "guided-test",
      testId: availability.test.id,
      title: availability.test.title,
      description: availability.test.about.question,
      why: buildWhy(availability, targets, byId, focusClaims, firstOpenBoost > 0 ? assessment.pursued : null, conflictedClaims),
      estimatedObservationTime: availability.test.about.estimatedObservationTime,
      risk: availability.test.risk,
      consequence: availability.test.consequence,
      category: effectiveCategory,
      targets,
      score,
    });
  }
  return scored.sort((a, b) => b.score - a.score || a.testId.localeCompare(b.testId));
}

/** A claim unblocks usability when a blocked usability claim depends on it or it declares a contribution to one. */
function claimDefinitionUnblocks(claimId: ClaimId, blockers: ReadonlySet<ClaimId>): boolean {
  const definition = claimDefinition(claimId);
  if (definition.contributesTo?.some((target) => blockers.has(target))) return true;
  for (const blocker of blockers) {
    if (claimDefinition(blocker).prerequisites.includes(claimId)) return true;
  }
  return false;
}

function buildWhy(availability: GuidedTestAvailability, targets: readonly ClaimId[], byId: ReadonlyMap<ClaimId, ClaimState>, focusClaims: ReadonlySet<ClaimId>, pursuedStrategy: RasterStrategy | null, conflictedClaims: ReadonlySet<ClaimId>): string {
  const parts: string[] = [availability.test.about.whyRelevant];
  if (pursuedStrategy) parts.push(`This is the next open requirement of the ${pursuedStrategy === "graffiti" ? "native static-image" : pursuedStrategy} path currently being characterized.`);
  const conflicted = targets.filter((claimId) => conflictedClaims.has(claimId));
  if (conflicted.length > 0) parts.push(`Revalidates evidence contradicted by a historical session: ${conflicted.map((claimId) => claimDefinition(claimId).label).join(", ")}.`);
  const unresolved = targets.filter((claimId) => byId.get(claimId)?.status === "unresolved");
  if (unresolved.length > 0) parts.push(`Resolves currently-contradicted evidence for: ${unresolved.map((claimId) => claimDefinition(claimId).label).join(", ")}.`);
  const focused = targets.filter((claimId) => focusClaims.has(claimId));
  if (focused.length > 0) parts.push("Directly addresses the reported symptom.");
  return parts.join(" ");
}

export function recommendNextTest(input: RecommendationInput): Recommendation | null {
  return rankRecommendations(input)[0] ?? null;
}

/**
 * Recommendation cycle detection.
 *
 * Excluding concluded experiments makes a plain A→A cycle structurally
 * impossible, but that is a property of the current scoring rules rather than
 * a guarantee. This guard is the backstop: it watches the actual sequence of
 * recommendations and refuses to let the user discover an algorithmic loop by
 * spending twenty minutes re-running the same hardware pattern.
 */
/**
 * How the user arrived at an experiment.
 *
 * Cycle detection is about the ENGINE looping, not about a person choosing to
 * measure something again. A retry the user asked for is the product working
 * as designed; flagging it as an algorithmic loop would punish exactly the
 * behaviour the timing workflow depends on.
 */
export type RecommendationOrigin =
  /** The engine proposed it and the user took the proposal. */
  | "automatic-recommendation"
  /** The user asked to repeat this measurement. */
  | "explicit-retry"
  /** The user deliberately reopened a settled experiment. */
  | "explicit-reopen"
  /**
   * The user picked this test themselves — from the catalogue, or by choosing
   * to continue past a complete core plan. Recording it as automatic would
   * tell a reader the workflow made them run it, which is the opposite of
   * what happened and points at the opposite fix.
   */
  | "manual-selection";

export const RECOMMENDATION_ORIGIN_LABELS: Readonly<Record<RecommendationOrigin, string>> = Object.freeze({
  "automatic-recommendation": "automatic recommendation",
  "explicit-retry": "explicit retry",
  "explicit-reopen": "explicit reopen of a completed experiment",
  "manual-selection": "user selected optional characterization",
});

export interface RecommendationTrailEntry {
  readonly testId: string;
  readonly at: string;
  /**
   * How much evidence existed when this was recommended. A repeat with an
   * unchanged count means nothing was learned in between, which is the
   * signature of a loop rather than of progress.
   */
  readonly evidenceCount: number;
  /** Defaults to automatic for entries written before origins were tracked. */
  readonly origin?: RecommendationOrigin;
}

export interface CycleVerdict {
  readonly cycling: boolean;
  readonly testIds: readonly string[];
  readonly detail: string | null;
}

const CYCLE_WINDOW = 6;

export function detectRecommendationCycle(trail: readonly RecommendationTrailEntry[]): CycleVerdict {
  // Only automatic recommendations can constitute an algorithmic loop. A
  // user-initiated retry or reopen is recorded in the trail — reports need it
  // — but it is a decision, not a symptom, and never trips this guard.
  const automatic = trail.filter((entry) => (entry.origin ?? "automatic-recommendation") === "automatic-recommendation");
  const window = automatic.slice(-CYCLE_WINDOW);
  if (window.length < 3) return { cycling: false, testIds: [], detail: null };
  const seen = new Map<string, RecommendationTrailEntry[]>();
  for (const entry of window) {
    seen.set(entry.testId, [...(seen.get(entry.testId) ?? []), entry]);
  }
  for (const [testId, entries] of seen) {
    if (entries.length < 2) continue;
    const first = entries[0]!;
    const last = entries[entries.length - 1]!;
    // Same experiment recommended again with no new evidence in between.
    if (last.evidenceCount <= first.evidenceCount) {
      return {
        cycling: true,
        testIds: [...new Set(window.map((entry) => entry.testId))],
        detail: `"${testId}" was recommended ${entries.length} times without any new evidence being recorded in between.`,
      };
    }
  }
  return { cycling: false, testIds: [], detail: null };
}
