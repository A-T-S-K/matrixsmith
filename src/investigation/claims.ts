import {
  allStrategyRequirementClaims,
  evaluateStaticViability,
} from "./static-viability";
import {
  CLAIM_DEFINITIONS,
  claimDefinition,
  resolveAtomicClaim,
  resolveTrust,
  type ClaimDefinition,
  type ClaimEvidence,
  type ClaimState,
  type ClaimStatus,
  type ClaimId,
  type OperationalTrust,
} from "./claim-foundation";
export * from "./claim-foundation";

/**
 * Deterministically resolve every claim's effective status from its evidence.
 * Higher-authority scope wins; within a scope a rejection or unresolved
 * result outranks verification, so a later "yes" can never paper over an
 * observed contradiction from the same scope. Missing evidence is honest
 * "unknown".
 */
export function resolveClaims(
  evidence: readonly ClaimEvidence[],
): readonly ClaimState[] {
  return CLAIM_DEFINITIONS.map((definition) =>
    claimState(definition.id, evidence),
  );
}

/**
 * static.strategy is DERIVED: no direct evidence ever decides it (so a
 * poisoned or over-eager "static.strategy verified" entry has no authority).
 * Its status comes from the strategy viability evaluator over the same
 * evidence pool — the single source of truth shared with gating, session
 * strategy selection, and reports.
 */
function deriveStaticStrategyState(
  definition: ClaimDefinition,
  allEvidence: readonly ClaimEvidence[],
): ClaimState {
  const assessment = evaluateStaticViability(allEvidence);
  const requirementClaims = allStrategyRequirementClaims();
  const anyRequirementEvidence = allEvidence.some((entry) =>
    requirementClaims.has(entry.claimId),
  );
  const status: ClaimStatus =
    assessment.overall === "viable"
      ? "verified"
      : assessment.overall === "not-viable"
        ? "rejected"
        : anyRequirementEvidence
          ? "unresolved"
          : "unknown";
  const derivedSummary = assessment.selected
    ? `Derived: the ${assessment.selected} strategy satisfies every requirement.`
    : assessment.overall === "not-viable"
      ? "Derived: every candidate strategy has a conclusively rejected requirement."
      : assessment.pursued
        ? `Derived: no strategy is fully usable yet; characterization is pursuing ${assessment.pursued}${assessment.nextOpenRequirement ? ` (next open requirement: ${assessment.nextOpenRequirement})` : ""}.`
        : "Derived: no candidate strategy has been characterized.";
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    status,
    decidedBy: null,
    evidence: allEvidence.filter((entry) => entry.claimId === definition.id),
    blockedByPrerequisite: null,
    derivedSummary,
  };
}

export function claimState(
  id: ClaimId,
  evidence: readonly ClaimEvidence[],
): ClaimState {
  return id === "static.strategy"
    ? deriveStaticStrategyState(claimDefinition(id), evidence)
    : resolveAtomicClaim(claimDefinition(id), evidence);
}

export function isClaimSatisfied(
  id: ClaimId,
  evidence: readonly ClaimEvidence[],
  accept: readonly ClaimStatus[] = ["verified"],
): boolean {
  return accept.includes(claimState(id, evidence).status);
}

/** Every claim's operational trust, for gating, reports, and conflict surfacing. */
export function resolveOperationalTrust(
  evidence: readonly ClaimEvidence[],
): readonly OperationalTrust[] {
  return CLAIM_DEFINITIONS.map((definition) =>
    operationalTrust(definition.id, evidence),
  );
}

/** Claims whose trusted basis is contradicted by historical/imported evidence; candidates for revalidation. */
export function claimConflicts(
  evidence: readonly ClaimEvidence[],
): readonly OperationalTrust[] {
  return resolveOperationalTrust(evidence).filter(
    (trust) => trust.historicalConflict,
  );
}
export function operationalTrust(
  id: ClaimId,
  evidence: readonly ClaimEvidence[],
): OperationalTrust {
  return resolveTrust(id, evidence, claimState);
}
