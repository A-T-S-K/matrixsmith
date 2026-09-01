import type { ClaimEvidence, ClaimId, ClaimState, ClaimStatus } from "./claims";
import { claimDefinition, resolveClaims } from "./claims";
import type { GuidedTestAvailability, GuidedTestCategory } from "./tests";
import type { CompletedGuidedTest, InvestigationGoal } from "./investigation";
import { SYMPTOM_FOCUS_CLAIMS } from "./investigation";

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

export function rankRecommendations(input: RecommendationInput): readonly Recommendation[] {
  const claims = resolveClaims(input.evidence);
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const passedTestIds = new Set(input.completedTests.filter((test) => test.status === "passed").map((test) => test.testId));
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
    if (passedTestIds.has(availability.test.id)) continue;
    const targets = availability.test.targetClaims.filter((claimId) => {
      const status = byId.get(claimId)?.status ?? "unknown";
      return status !== "verified";
    });
    if (targets.length === 0) continue;
    const informationValue = targets.reduce((total, claimId) => total + STATUS_VALUE[byId.get(claimId)?.status ?? "unknown"], 0);
    const unblocksUsability = targets.some((claimId) => usabilityBlockers.has(claimId) || claimDefinitionUnblocks(claimId, usabilityBlockers));
    // The symptom's FIRST focus claim is its most direct discriminator and
    // outweighs secondary focus claims.
    const focusBoost = (targets.some((claimId) => focusClaims.has(claimId)) ? 60 : 0)
      + (primaryFocus !== null && targets.includes(primaryFocus) ? 30 : 0);
    // An advanced test that is the discriminator for a usability blocker is
    // temporarily treated as recommended.
    const effectiveCategory: GuidedTestCategory = unblocksUsability && availability.test.category === "advanced" ? "recommended" : availability.test.category;
    const score = informationValue + CATEGORY_WEIGHT[effectiveCategory] + focusBoost + (unblocksUsability ? 25 : 0)
      + (availability.test.risk === "read-only" ? 5 : 0);
    scored.push({
      id: `recommend:${availability.test.id}`,
      kind: "guided-test",
      testId: availability.test.id,
      title: availability.test.title,
      description: availability.test.about.question,
      why: buildWhy(availability, targets, byId, focusClaims),
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

function buildWhy(availability: GuidedTestAvailability, targets: readonly ClaimId[], byId: ReadonlyMap<ClaimId, ClaimState>, focusClaims: ReadonlySet<ClaimId>): string {
  const parts: string[] = [availability.test.about.whyRelevant];
  const unresolved = targets.filter((claimId) => byId.get(claimId)?.status === "unresolved");
  if (unresolved.length > 0) parts.push(`Resolves currently-contradicted evidence for: ${unresolved.map((claimId) => claimDefinition(claimId).label).join(", ")}.`);
  const focused = targets.filter((claimId) => focusClaims.has(claimId));
  if (focused.length > 0) parts.push("Directly addresses the reported symptom.");
  return parts.join(" ");
}

export function recommendNextTest(input: RecommendationInput): Recommendation | null {
  return rankRecommendations(input)[0] ?? null;
}
