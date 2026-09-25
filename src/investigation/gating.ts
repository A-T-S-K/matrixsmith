import type { ClaimEvidence, ClaimId } from "./claims";
import { claimDefinition, operationalTrust } from "./claims";

/**
 * Path-specific content safety gating. Each content path unlocks only when
 * ITS actual dependencies hold OPERATIONAL TRUST — a verified basis from the
 * current physical session or the shipped built-in profile (see
 * operationalTrust in claims.ts). Historical local sessions and imported
 * evidence inform investigation but never authorize an operation, and an
 * inconclusive Graffiti validation cannot unlock animation or vice versa.
 */

export type ContentPathId = "text" | "image" | "animation" | "gif";

const PATH_REQUIREMENTS: Readonly<
  Record<
    ContentPathId,
    { readonly claims: readonly ClaimId[]; readonly label: string }
  >
> = Object.freeze({
  text: {
    claims: ["stored-program.upload", "static.strategy"],
    label: "Text needs a validated static-image strategy",
  },
  image: {
    claims: ["stored-program.upload", "static.strategy"],
    label: "Images need a validated static-image strategy",
  },
  animation: {
    claims: [
      "stored-program.upload",
      "animation.frames",
      "animation.timing",
      "animation.tile-sync",
    ],
    label: "Animations need verified animation playback",
  },
  gif: {
    claims: ["stored-program.upload", "gif.playback"],
    label: "GIF needs verified GIF playback on this device",
  },
});

export interface ContentGate {
  readonly path: ContentPathId;
  readonly allowed: boolean;
  readonly reason: string;
  readonly missingClaims: readonly ClaimId[];
}

export function contentPathGate(
  path: ContentPathId,
  evidence: readonly ClaimEvidence[],
): ContentGate {
  const requirement = PATH_REQUIREMENTS[path];
  const missing = requirement.claims.filter(
    (claimId) => !operationalTrust(claimId, evidence).trusted,
  );
  if (missing.length === 0)
    return {
      path,
      allowed: true,
      reason: "Required capabilities hold a trusted physical verification.",
      missingClaims: [],
    };
  const labels = missing
    .map((claimId) => claimDefinition(claimId).label)
    .join(", ");
  return {
    path,
    allowed: false,
    reason: `${requirement.label}. No trusted verification on this device for: ${labels}.`,
    missingClaims: missing,
  };
}

export function allContentGates(
  evidence: readonly ClaimEvidence[],
): readonly ContentGate[] {
  return (Object.keys(PATH_REQUIREMENTS) as ContentPathId[]).map((path) =>
    contentPathGate(path, evidence),
  );
}
