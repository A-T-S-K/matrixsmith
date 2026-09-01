import type { SessionValidationResult, ValidationAreaId } from "../diagnostics/validation";
import type { ClaimEvidence, ClaimId } from "./claims";

/**
 * Bridges the original content-validation workflows into atomic claim
 * evidence. The mapping deliberately fixes the historical overclaims:
 * the animation "keeps looping" question maps to autonomous playback, NOT
 * power-cycle persistence, and a static-frame pass verifies the specific
 * render/tiling claims rather than one broad "static frame" area.
 */
const AREA_CLAIMS: Readonly<Record<ValidationAreaId, readonly ClaimId[]>> = Object.freeze({
  "static-frame": ["graffiti.initial-render", "raster.tiling"],
  "pixel-orientation": ["raster.orientation"],
  "color-encoding": ["graffiti.color-mapping"],
  "stored-programs": ["stored-program.upload"],
  "text-rendering": ["text.rendering"],
  animation: ["animation.frames", "animation.timing", "animation.tile-sync"],
  gif: ["gif.playback"],
  // The legacy "persistence" area was only ever validated by observing
  // autonomous looping; it never demonstrated surviving a power cycle.
  persistence: ["animation.autonomous-loop"],
});

export function claimEvidenceFromValidation(validation: SessionValidationResult): readonly ClaimEvidence[] {
  const evidence: ClaimEvidence[] = [];
  for (const area of validation.validatedAreas) {
    for (const claimId of AREA_CLAIMS[area] ?? []) {
      evidence.push({
        claimId, status: "verified", scope: "current-session", provenance: "observed",
        summary: `Validated by the ${validation.workflowId} workflow (${area}).`,
        recordedAt: validation.recordedAt, testId: validation.workflowId, transactionIds: validation.transactionIds,
      });
    }
  }
  for (const area of validation.rejectedAreas) {
    for (const claimId of AREA_CLAIMS[area] ?? []) {
      evidence.push({
        claimId, status: "rejected", scope: "current-session", provenance: "observed",
        summary: `Rejected by the ${validation.workflowId} workflow (${area}).`,
        recordedAt: validation.recordedAt, testId: validation.workflowId, transactionIds: validation.transactionIds,
      });
    }
  }
  return evidence;
}
