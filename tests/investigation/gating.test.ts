import { describe, expect, it } from "vitest";
import { allContentGates, contentPathGate } from "../../src/investigation/gating";
import type { ClaimEvidence } from "../../src/investigation/claims";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const baseline = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);

describe("path-specific content gating", () => {
  it("unlocks animation content from verified animation claims while images stay gated", () => {
    expect(contentPathGate("animation", baseline).allowed).toBe(true);
    const image = contentPathGate("image", baseline);
    expect(image.allowed).toBe(false);
    expect(image.missingClaims).toContain("static.strategy");
    expect(contentPathGate("text", baseline).allowed).toBe(false);
  });

  it("keeps GIF gated on source-only support", () => {
    const gif = contentPathGate("gif", baseline);
    expect(gif.allowed).toBe(false);
    expect(gif.missingClaims).toContain("gif.playback");
  });

  it("unlocks images once a static strategy is verified this session", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "static.strategy", status: "verified", scope: "current-session", provenance: "observed", summary: "animation-single-frame validated" },
    ];
    expect(contentPathGate("image", evidence).allowed).toBe(true);
    expect(contentPathGate("text", evidence).allowed).toBe(true);
    // Unrelated paths do not silently unlock.
    expect(contentPathGate("gif", evidence).allowed).toBe(false);
  });

  it("does not let an inconclusive Graffiti result unlock unrelated content", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "graffiti.playback-stability", status: "unresolved", scope: "current-session", provenance: "observed", summary: "inconclusive" },
    ];
    expect(contentPathGate("image", evidence).allowed).toBe(false);
    expect(contentPathGate("animation", evidence).allowed).toBe(true); // already verified independently
  });

  it("refuses previous-local-session and imported evidence as gate satisfiers", () => {
    const evidence: ClaimEvidence[] = [
      { claimId: "stored-program.upload", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old session" },
      { claimId: "static.strategy", status: "verified", scope: "imported-external", provenance: "observed", summary: "imported" },
      { claimId: "animation.frames", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
      { claimId: "animation.timing", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
      { claimId: "animation.tile-sync", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
    ];
    for (const gate of allContentGates(evidence)) expect(gate.allowed).toBe(false);
  });

  it("a current-session rejection overrides built-in verification for gating", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "animation.frames", status: "rejected", scope: "current-session", provenance: "observed", summary: "frames failed today" },
    ];
    expect(contentPathGate("animation", evidence).allowed).toBe(false);
  });
});
