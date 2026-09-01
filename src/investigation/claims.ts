import { allStrategyRequirementClaims, evaluateStaticViability } from "./static-viability";

/**
 * Atomic hardware claims. A claim is one narrowly scoped statement about
 * this device's behavior ("Animation frames decode", "Graffiti 0x0000 is
 * black") with explicit evidence, scope, and provenance. Broad UI "support"
 * always derives from these; a single passing sub-question can never verify
 * an unrelated or broader area, and a rejected prerequisite blocks its
 * dependents from being presented as verified.
 */

export type ClaimId =
  | "transport.bluetooth"
  | "protocol.coolledux"
  | "device-info.query"
  | "brightness.control"
  | "power.control"
  | "stored-program.upload"
  | "stored-program.receipts"
  | "raster.tiling"
  | "raster.orientation"
  | "graffiti.initial-render"
  | "graffiti.playback-stability"
  | "graffiti.black-semantics"
  | "graffiti.color-mapping"
  | "animation.frames"
  | "animation.timing"
  | "animation.tile-sync"
  | "animation.autonomous-loop"
  | "animation.black-semantics"
  | "animation.static-single-frame"
  | "animation.static-identical-pair"
  | "pixel.channel-map"
  | "pixel.encoder-correctness"
  | "pixel.fourth-channel"
  | "pixel.white-channel"
  | "pixel.color-calibration"
  | "static.strategy"
  | "text.rendering"
  | "image.rendering"
  | "gif.playback"
  | "power-cycle.persistence"
  | "recovery.manual-reset";

/**
 * Claim status vocabulary:
 * - "verified": physically observed to behave as claimed.
 * - "source-supported": supported by reference/source evidence on other
 *   hardware or by a conformant offline implementation; not physically
 *   demonstrated on this device.
 * - "unresolved": physically tested, but the observation contradicted or
 *   failed to confirm the expectation; needs a better discriminator.
 * - "rejected": physically observed NOT to behave as claimed.
 * - "unknown": no evidence either way.
 */
export type ClaimStatus = "verified" | "source-supported" | "unresolved" | "rejected" | "unknown";

/**
 * Where a piece of claim evidence comes from. Session observations never
 * silently rewrite built-in profile facts; each scope stays distinguishable
 * in reports and support views.
 */
export type EvidenceScope =
  | "source-reference"
  | "built-in-profile"
  | "current-session"
  | "previous-local-session"
  | "imported-external";

export type EvidenceProvenance = "observed" | "corroborated" | "source-derived" | "inferred" | "speculative";

export interface ClaimEvidence {
  readonly claimId: ClaimId;
  readonly status: ClaimStatus;
  readonly scope: EvidenceScope;
  readonly provenance: EvidenceProvenance;
  readonly summary: string;
  readonly recordedAt?: string;
  /** Guided test or validation workflow that produced this evidence. */
  readonly testId?: string;
  readonly transactionIds?: readonly string[];
  readonly observationIds?: readonly string[];
  /** Optional 0..1 confidence for physically observed evidence. */
  readonly confidence?: number;
  /**
   * Measured quantities backing the evidence (e.g. visibleStaticHoldMs).
   * Numbers only; always from MatrixSmith-measured timers, never estimates.
   */
  readonly metrics?: Readonly<Record<string, number>>;
  /** Structured outcome facts (e.g. zeroBehavior: "true-black") for session-resolved behavior. */
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export type ClaimCategory = "core" | "content" | "optional";

export interface ClaimDefinition {
  readonly id: ClaimId;
  readonly label: string;
  readonly category: ClaimCategory;
  /** Claims that must not be rejected for this claim to be meaningful. */
  readonly prerequisites: readonly ClaimId[];
  /** Broader claims that resolving this one helps decide (e.g. playback stability informs the static strategy). */
  readonly contributesTo?: readonly ClaimId[];
  readonly description: string;
}

export const CLAIM_DEFINITIONS: readonly ClaimDefinition[] = Object.freeze([
  { id: "transport.bluetooth", label: "Bluetooth transport", category: "core", prerequisites: [], description: "FFF0/FFF1 GATT transport connects and accepts writes." },
  { id: "protocol.coolledux", label: "Protocol identified", category: "core", prerequisites: ["transport.bluetooth"], description: "The CoolLEDUX protocol family answers the structured 0x1F query." },
  { id: "device-info.query", label: "Device state", category: "core", prerequisites: ["protocol.coolledux"], description: "Device info (power, brightness) reads back as structured fields." },
  { id: "brightness.control", label: "Brightness", category: "core", prerequisites: ["protocol.coolledux"], description: "Brightness opcode 0x04 changes and reads back correctly." },
  { id: "power.control", label: "Power", category: "optional", prerequisites: ["protocol.coolledux"], description: "Power opcode changes the panel's power state." },
  { id: "stored-program.upload", label: "Stored-program upload", category: "content", prerequisites: ["protocol.coolledux"], description: "A compiled stored program is accepted and rendered by the device." },
  { id: "stored-program.receipts", label: "Upload receipts", category: "optional", prerequisites: ["stored-program.upload"], description: "The device emits announce/chunk receipt notifications during upload." },
  { id: "raster.tiling", label: "Raster tiling", category: "content", prerequisites: ["stored-program.upload"], description: "Tiled 8-column segments reconstruct the full canvas." },
  { id: "raster.orientation", label: "Orientation", category: "content", prerequisites: ["raster.tiling"], description: "Corners and axes land where the logical framebuffer places them." },
  { id: "graffiti.initial-render", label: "Static-image initial render", category: "content", prerequisites: ["stored-program.upload"], description: "A Graffiti program initially renders the intended raster." },
  { id: "graffiti.playback-stability", label: "Static-image stability", category: "content", prerequisites: ["graffiti.initial-render"], contributesTo: ["static.strategy"], description: "A Graffiti raster stays still instead of scrolling or cycling." },
  { id: "graffiti.black-semantics", label: "Static-image black", category: "content", prerequisites: ["graffiti.initial-render"], contributesTo: ["static.strategy"], description: "How the Graffiti path renders a literal 0x0000 pixel on this exact device." },
  { id: "graffiti.color-mapping", label: "Static-image colors", category: "content", prerequisites: ["graffiti.initial-render"], description: "Graffiti pixel colors map to the intended channels." },
  { id: "animation.frames", label: "Animation frames", category: "content", prerequisites: ["stored-program.upload"], description: "Animation programs decode into distinct frames." },
  { id: "animation.timing", label: "Animation timing", category: "content", prerequisites: ["animation.frames"], description: "Per-frame delays play at approximately the declared durations." },
  { id: "animation.tile-sync", label: "Animation tile sync", category: "content", prerequisites: ["animation.frames"], description: "All tiles switch frames together with no lagging strip." },
  { id: "animation.autonomous-loop", label: "Autonomous playback", category: "content", prerequisites: ["animation.frames"], description: "Animation keeps looping without further Bluetooth traffic. Distinct from power-cycle persistence." },
  { id: "animation.black-semantics", label: "Animation black", category: "content", prerequisites: ["animation.frames"], contributesTo: ["static.strategy"], description: "How the Animation path renders a literal 0x0000 pixel on this exact device." },
  { id: "animation.static-single-frame", label: "One-frame Animation raster", category: "content", prerequisites: ["animation.frames"], contributesTo: ["static.strategy"], description: "A one-frame Animation program renders a stable static raster." },
  { id: "animation.static-identical-pair", label: "Identical-pair Animation raster", category: "content", prerequisites: ["animation.frames"], contributesTo: ["static.strategy"], description: "Two identical Animation frames render a stable static raster. Distinct from the one-frame variant." },
  { id: "pixel.channel-map", label: "Raw channel mapping", category: "content", prerequisites: ["stored-program.upload"], contributesTo: ["static.strategy"], description: "Which nibbles of the 16-bit pixel word drive which physical channels — the raw wire behavior, regardless of what MatrixSmith's encoder assumes." },
  { id: "pixel.encoder-correctness", label: "Encoder correctness", category: "content", prerequisites: ["pixel.channel-map"], contributesTo: ["static.strategy"], description: "Whether MatrixSmith's logical RGB values produce the intended physical channels. A characterized-but-permuted raw map means the encoder needs correction and keeps this rejected." },
  { id: "pixel.fourth-channel", label: "Fourth channel", category: "content", prerequisites: ["pixel.channel-map"], description: "Whether the unused high nibble drives ANY fourth physical emitter, of whatever color." },
  { id: "pixel.white-channel", label: "White channel", category: "content", prerequisites: ["pixel.fourth-channel"], description: "Whether the established fourth channel appears white. Existence of a fourth channel alone never verifies this." },
  { id: "pixel.color-calibration", label: "Color calibration", category: "optional", prerequisites: ["pixel.channel-map"], description: "Whether rendered colors, including white, look visually correct." },
  { id: "static.strategy", label: "Static-image strategy", category: "content", prerequisites: ["stored-program.upload"], description: "A usable strategy exists for showing a stable static image. DERIVED from the atomic strategy requirements (see static-viability.ts); direct evidence never decides it." },
  { id: "text.rendering", label: "Text", category: "content", prerequisites: ["static.strategy"], description: "Rendered text displays correctly via the selected raster strategy." },
  { id: "image.rendering", label: "Images", category: "content", prerequisites: ["static.strategy"], description: "Imported images display correctly via the selected raster strategy." },
  { id: "gif.playback", label: "GIF", category: "optional", prerequisites: ["stored-program.upload"], description: "Native GIF programs decode and play." },
  { id: "power-cycle.persistence", label: "Power-cycle persistence", category: "optional", prerequisites: ["stored-program.upload"], description: "Stored content survives a physical power cycle. Not implied by autonomous looping." },
  { id: "recovery.manual-reset", label: "Manual recovery", category: "optional", prerequisites: [], description: "A manual hardware reset restores default content." },
]);

const DEFINITIONS_BY_ID = new Map(CLAIM_DEFINITIONS.map((definition) => [definition.id, definition]));

export function claimDefinition(id: ClaimId): ClaimDefinition {
  const definition = DEFINITIONS_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown claim ${id}.`);
  return definition;
}

export interface ClaimState {
  readonly id: ClaimId;
  readonly label: string;
  readonly category: ClaimCategory;
  readonly status: ClaimStatus;
  /** The evidence entry that determined the effective status; null for derived claims. */
  readonly decidedBy: ClaimEvidence | null;
  /** Every evidence entry for this claim, strongest scope first. */
  readonly evidence: readonly ClaimEvidence[];
  /** True when a prerequisite claim is rejected, blocking a "verified" presentation. */
  readonly blockedByPrerequisite: ClaimId | null;
  /** For derived claims (static.strategy): how the status was derived. */
  readonly derivedSummary?: string;
}

/** Scope authority for deciding the effective status; higher wins. */
const SCOPE_PRIORITY: Readonly<Record<EvidenceScope, number>> = {
  "current-session": 50,
  "previous-local-session": 40,
  "imported-external": 30,
  "built-in-profile": 20,
  "source-reference": 10,
};

/** Within one scope, physical contradictions outrank optimistic evidence. */
const STATUS_PRIORITY: Readonly<Record<ClaimStatus, number>> = {
  rejected: 50,
  unresolved: 40,
  verified: 30,
  "source-supported": 20,
  unknown: 10,
};

export function scopePriority(scope: EvidenceScope): number { return SCOPE_PRIORITY[scope]; }

/**
 * Deterministically resolve every claim's effective status from its evidence.
 * Higher-authority scope wins; within a scope a rejection or unresolved
 * result outranks verification, so a later "yes" can never paper over an
 * observed contradiction from the same scope. Missing evidence is honest
 * "unknown".
 */
export function resolveClaims(evidence: readonly ClaimEvidence[]): readonly ClaimState[] {
  return CLAIM_DEFINITIONS.map((definition) => resolveClaim(definition, evidence));
}

function resolveClaim(definition: ClaimDefinition, allEvidence: readonly ClaimEvidence[]): ClaimState {
  if (definition.id === "static.strategy") return deriveStaticStrategyState(definition, allEvidence);
  const entries = allEvidence
    .filter((entry) => entry.claimId === definition.id)
    .slice()
    .sort((a, b) => SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope] || STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status]);
  const decidedBy = entries[0] ?? null;
  const status = decidedBy?.status ?? "unknown";
  const blockedBy = definition.prerequisites.find((prerequisiteId) => {
    const prerequisite = DEFINITIONS_BY_ID.get(prerequisiteId);
    return prerequisite ? resolveClaim(prerequisite, allEvidence).status === "rejected" : false;
  }) ?? null;
  return {
    id: definition.id, label: definition.label, category: definition.category,
    status: blockedBy && status === "verified" ? "unresolved" : status,
    decidedBy, evidence: entries, blockedByPrerequisite: blockedBy,
  };
}

/**
 * static.strategy is DERIVED: no direct evidence ever decides it (so a
 * poisoned or over-eager "static.strategy verified" entry has no authority).
 * Its status comes from the strategy viability evaluator over the same
 * evidence pool — the single source of truth shared with gating, session
 * strategy selection, and reports.
 */
function deriveStaticStrategyState(definition: ClaimDefinition, allEvidence: readonly ClaimEvidence[]): ClaimState {
  const assessment = evaluateStaticViability(allEvidence);
  const requirementClaims = allStrategyRequirementClaims();
  const anyRequirementEvidence = allEvidence.some((entry) => requirementClaims.has(entry.claimId));
  const status: ClaimStatus = assessment.overall === "viable" ? "verified"
    : assessment.overall === "not-viable" ? "rejected"
      : anyRequirementEvidence ? "unresolved" : "unknown";
  const derivedSummary = assessment.selected
    ? `Derived: the ${assessment.selected} strategy satisfies every requirement.`
    : assessment.overall === "not-viable"
      ? "Derived: every candidate strategy has a conclusively rejected requirement."
      : assessment.pursued
        ? `Derived: no strategy is fully usable yet; characterization is pursuing ${assessment.pursued}${assessment.nextOpenRequirement ? ` (next open requirement: ${assessment.nextOpenRequirement})` : ""}.`
        : "Derived: no candidate strategy has been characterized.";
  return {
    id: definition.id, label: definition.label, category: definition.category,
    status, decidedBy: null,
    evidence: allEvidence.filter((entry) => entry.claimId === definition.id),
    blockedByPrerequisite: null,
    derivedSummary,
  };
}

export function claimState(id: ClaimId, evidence: readonly ClaimEvidence[]): ClaimState {
  return resolveClaim(claimDefinition(id), evidence);
}

export function isClaimSatisfied(id: ClaimId, evidence: readonly ClaimEvidence[], accept: readonly ClaimStatus[] = ["verified"]): boolean {
  return accept.includes(claimState(id, evidence).status);
}

// ---------------------------------------------------------------------------
// Operational trust — distinct from the effective/investigative claim state.
//
// The effective state (resolveClaims) answers "what does ALL the evidence
// currently say?", including historical and imported observations and their
// contradictions. Operational trust answers a narrower question: "does this
// exact prerequisite have a CURRENTLY trusted basis for performing a normal
// operation?" Only the shipped built-in profile and the current physical
// session can grant that. Historical/imported evidence informs
// recommendations, exposes conflicts, and appears in reports — but it never
// masquerades as operational authority, in either direction: it can neither
// unlock an operation nor silently erase a shipped trust basis.
// ---------------------------------------------------------------------------

/** Scopes whose evidence can authorize normal operations. */
export const TRUSTED_OPERATIONAL_SCOPES: readonly EvidenceScope[] = Object.freeze(["current-session", "built-in-profile"]);

export interface OperationalTrust {
  readonly claimId: ClaimId;
  /** True when the claim has a currently trusted verified basis. */
  readonly trusted: boolean;
  /** Resolution over trusted scopes only (current-session outranks built-in-profile; contradictions within them win). */
  readonly trustedStatus: ClaimStatus;
  /** The trusted-scope evidence entry the decision rests on, if any. */
  readonly basis: ClaimEvidence | null;
  /**
   * Historical/imported evidence disagrees with the trusted resolution
   * (e.g. a previous local session rejected what the built-in profile
   * verifies). Surfaces in reports and triggers revalidation
   * recommendations without revoking the operational basis.
   */
  readonly historicalConflict: boolean;
  /** The conflicting non-trusted evidence entries, for reports. */
  readonly conflictingEvidence: readonly ClaimEvidence[];
}

function isTrustedScope(scope: EvidenceScope): boolean {
  return TRUSTED_OPERATIONAL_SCOPES.includes(scope);
}

export function operationalTrust(id: ClaimId, evidence: readonly ClaimEvidence[]): OperationalTrust {
  // Prerequisite blocking also respects the trust boundary: filtering the
  // whole pool means a historical rejection of a prerequisite cannot revoke
  // an operational basis, and a poisoned historical verification cannot
  // satisfy one.
  const trustedPool = evidence.filter((entry) => isTrustedScope(entry.scope));
  const state = claimState(id, trustedPool);
  const trusted = state.status === "verified";
  const untrusted = evidence.filter((entry) => entry.claimId === id && !isTrustedScope(entry.scope));
  const conflicting = untrusted.filter((entry) =>
    (state.status === "verified" && (entry.status === "rejected" || entry.status === "unresolved"))
    || (state.status === "rejected" && entry.status === "verified"));
  return {
    claimId: id,
    trusted,
    trustedStatus: state.status,
    basis: state.decidedBy,
    historicalConflict: conflicting.length > 0,
    conflictingEvidence: conflicting,
  };
}

/** Every claim's operational trust, for gating, reports, and conflict surfacing. */
export function resolveOperationalTrust(evidence: readonly ClaimEvidence[]): readonly OperationalTrust[] {
  return CLAIM_DEFINITIONS.map((definition) => operationalTrust(definition.id, evidence));
}

/** Claims whose trusted basis is contradicted by historical/imported evidence; candidates for revalidation. */
export function claimConflicts(evidence: readonly ClaimEvidence[]): readonly OperationalTrust[] {
  return resolveOperationalTrust(evidence).filter((trust) => trust.historicalConflict);
}
