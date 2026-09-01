import type { RasterStrategy } from "../core/raster-strategy";
import { claimDefinition, operationalTrust, type ClaimEvidence, type ClaimId, type ClaimStatus } from "./claims";

/**
 * Derived static-image strategy viability. A static strategy is a BROAD
 * capability: it is never asserted directly by one passing test, it is
 * derived from the atomic requirements below. The same evaluator powers
 * normal-operation gating, the recommendation engine's pursued-strategy
 * ordering, and the report's strategy assessment — there is exactly one
 * source of truth.
 *
 * Requirement order matters: it is the characterization order the
 * recommendation engine walks (the first open requirement of the pursued
 * strategy is the next-highest-value discriminator).
 */

/** Minimum MEASURED visibly-static hold (from full-raster-visible, T1) to accept playback stability. */
export const MINIMUM_STATIC_HOLD_MS = 15_000;

/** Metric key carried on playback/stability evidence. */
export const VISIBLE_STATIC_HOLD_METRIC = "visibleStaticHoldMs";

const GRAFFITI_REQUIREMENTS: readonly ClaimId[] = Object.freeze([
  "stored-program.upload",
  "raster.tiling",
  "raster.orientation",
  "graffiti.initial-render",
  "graffiti.playback-stability",
  "graffiti.black-semantics",
  "pixel.channel-map",
  "pixel.encoder-correctness",
]);

const ANIMATION_COMMON: readonly ClaimId[] = Object.freeze([
  "stored-program.upload",
  "animation.frames",
  "animation.tile-sync",
  "animation.black-semantics",
  "pixel.channel-map",
  "pixel.encoder-correctness",
]);

const STRATEGY_REQUIREMENTS: Readonly<Record<RasterStrategy, readonly ClaimId[]>> = Object.freeze({
  graffiti: GRAFFITI_REQUIREMENTS,
  "animation-single-frame": Object.freeze<ClaimId[]>([...ANIMATION_COMMON, "animation.static-single-frame"]),
  "animation-identical-frames": Object.freeze<ClaimId[]>([...ANIMATION_COMMON, "animation.static-identical-pair"]),
});

/** Claims whose verification must be backed by a measured hold of at least the minimum. */
const HOLD_METRIC_CLAIMS: readonly ClaimId[] = Object.freeze([
  "graffiti.playback-stability", "animation.static-single-frame", "animation.static-identical-pair",
]);

/** Native-first preference: characterize/select the device's own static path before fallbacks. */
export const STRATEGY_PREFERENCE: readonly RasterStrategy[] = Object.freeze([
  "graffiti", "animation-single-frame", "animation-identical-frames",
]);

export type RequirementState = "met" | "failed" | "open";

export interface ViabilityRequirement {
  readonly claimId: ClaimId;
  readonly label: string;
  readonly state: RequirementState;
  readonly trustedStatus: ClaimStatus;
  readonly detail: string;
}

export type StrategyVerdict = "viable" | "not-viable" | "open";

export interface StrategyViability {
  readonly strategy: RasterStrategy;
  readonly verdict: StrategyVerdict;
  readonly requirements: readonly ViabilityRequirement[];
  readonly summary: string;
}

export interface StaticViabilityAssessment {
  readonly strategies: readonly StrategyViability[];
  /** The strategy Normal Use should route through, or null when none is usable. */
  readonly selected: RasterStrategy | null;
  /** The strategy characterization should pursue next: the first not conclusively non-viable one in native-first order. */
  readonly pursued: RasterStrategy | null;
  /** The first open requirement of the pursued strategy — the next-highest-value discriminator. */
  readonly nextOpenRequirement: ClaimId | null;
  readonly overall: StrategyVerdict;
}

function requirementState(claimId: ClaimId, evidence: readonly ClaimEvidence[]): ViabilityRequirement {
  const trust = operationalTrust(claimId, evidence);
  const definition = claimDefinition(claimId);
  if (trust.trustedStatus === "rejected") {
    return { claimId, label: definition.label, state: "failed", trustedStatus: trust.trustedStatus, detail: trust.basis?.summary ?? "Rejected by trusted evidence." };
  }
  if (trust.trusted) {
    if (HOLD_METRIC_CLAIMS.includes(claimId)) {
      const hold = trust.basis?.metrics?.[VISIBLE_STATIC_HOLD_METRIC];
      // Belt and braces: even if an interpreter over-claimed, verification
      // without a sufficient measured hold does not count as met.
      if (typeof hold === "number" && hold < MINIMUM_STATIC_HOLD_MS) {
        return { claimId, label: definition.label, state: "open", trustedStatus: trust.trustedStatus, detail: `Measured visibly-static hold ${Math.round(hold / 100) / 10}s is below the required ${MINIMUM_STATIC_HOLD_MS / 1000}s.` };
      }
    }
    return { claimId, label: definition.label, state: "met", trustedStatus: trust.trustedStatus, detail: trust.basis?.summary ?? "Verified by trusted evidence." };
  }
  return { claimId, label: definition.label, state: "open", trustedStatus: trust.trustedStatus, detail: trust.basis?.summary ?? "No trusted verification yet." };
}

function evaluateStrategy(strategy: RasterStrategy, evidence: readonly ClaimEvidence[]): StrategyViability {
  const requirements = STRATEGY_REQUIREMENTS[strategy].map((claimId) => requirementState(claimId, evidence));
  const failed = requirements.filter((requirement) => requirement.state === "failed");
  const open = requirements.filter((requirement) => requirement.state === "open");
  const verdict: StrategyVerdict = failed.length > 0 ? "not-viable" : open.length === 0 ? "viable" : "open";
  const summary = verdict === "viable"
    ? "Every requirement holds a trusted verification; this strategy is usable."
    : verdict === "not-viable"
      ? `Conclusively not viable: ${failed.map((requirement) => requirement.label).join(", ")} rejected.`
      : `Not yet decided: ${open.map((requirement) => requirement.label).join(", ")} still open.`;
  return { strategy, verdict, requirements, summary };
}

/** Every claim that feeds some strategy's viability. */
export function allStrategyRequirementClaims(): ReadonlySet<ClaimId> {
  return new Set(STRATEGY_PREFERENCE.flatMap((strategy) => STRATEGY_REQUIREMENTS[strategy]));
}

export function evaluateStaticViability(evidence: readonly ClaimEvidence[]): StaticViabilityAssessment {
  const strategies = STRATEGY_PREFERENCE.map((strategy) => evaluateStrategy(strategy, evidence));
  const byStrategy = new Map(strategies.map((entry) => [entry.strategy, entry]));
  const selected = STRATEGY_PREFERENCE.find((strategy) => byStrategy.get(strategy)?.verdict === "viable") ?? null;
  const pursued = STRATEGY_PREFERENCE.find((strategy) => byStrategy.get(strategy)?.verdict !== "not-viable") ?? null;
  const pursuedEntry = pursued ? byStrategy.get(pursued) ?? null : null;
  const nextOpenRequirement = pursuedEntry?.requirements.find((requirement) => requirement.state === "open")?.claimId ?? null;
  const overall: StrategyVerdict = selected ? "viable" : strategies.every((entry) => entry.verdict === "not-viable") ? "not-viable" : "open";
  return { strategies, selected, pursued, nextOpenRequirement, overall };
}
