import type { ClaimId, ClaimState, EvidenceScope } from "./claims";

/**
 * Path-specific content safety gating. Each content path unlocks only when
 * ITS actual dependencies are verified — an inconclusive Graffiti validation
 * cannot unlock animation, and a successful animation never silently proves
 * Graffiti. Verification must come from trusted physical scopes: the current
 * session or shipped built-in profile evidence. Previous local sessions and
 * imported evidence inform investigation but never bypass gating.
 */

export type ContentPathId = "text" | "image" | "animation" | "gif";

const TRUSTED_SCOPES: readonly EvidenceScope[] = ["current-session", "built-in-profile"];

const PATH_REQUIREMENTS: Readonly<Record<ContentPathId, { readonly claims: readonly ClaimId[]; readonly label: string }>> = Object.freeze({
  text: { claims: ["stored-program.upload", "static.strategy"], label: "Text needs a validated static-image strategy" },
  image: { claims: ["stored-program.upload", "static.strategy"], label: "Images need a validated static-image strategy" },
  animation: { claims: ["stored-program.upload", "animation.frames", "animation.timing", "animation.tile-sync"], label: "Animations need verified animation playback" },
  gif: { claims: ["stored-program.upload", "gif.playback"], label: "GIF needs verified GIF playback on this device" },
});

export interface ContentGate {
  readonly path: ContentPathId;
  readonly allowed: boolean;
  readonly reason: string;
  readonly missingClaims: readonly ClaimId[];
}

function claimTrusted(state: ClaimState | undefined): boolean {
  return state?.status === "verified" && state.decidedBy !== null && TRUSTED_SCOPES.includes(state.decidedBy.scope);
}

export function contentPathGate(path: ContentPathId, claims: readonly ClaimState[]): ContentGate {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const requirement = PATH_REQUIREMENTS[path];
  const missing = requirement.claims.filter((claimId) => !claimTrusted(byId.get(claimId)));
  if (missing.length === 0) return { path, allowed: true, reason: "Required capabilities are physically verified.", missingClaims: [] };
  const labels = missing.map((claimId) => byId.get(claimId)?.label ?? claimId).join(", ");
  return {
    path, allowed: false,
    reason: `${requirement.label}. Not yet verified on this device: ${labels}.`,
    missingClaims: missing,
  };
}

export function allContentGates(claims: readonly ClaimState[]): readonly ContentGate[] {
  return (Object.keys(PATH_REQUIREMENTS) as ContentPathId[]).map((path) => contentPathGate(path, claims));
}
