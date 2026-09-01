import { describe, expect, it } from "vitest";
import { allContentGates, contentPathGate } from "../../src/investigation/gating";
import { resolveClaims, type ClaimEvidence } from "../../src/investigation/claims";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const baseline = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);

describe("path-specific content gating", () => {
  it("unlocks animation content from verified animation claims while images stay gated", () => {
    const claims = resolveClaims(baseline);
    expect(contentPathGate("animation", claims).allowed).toBe(true);
    const image = contentPathGate("image", claims);
    expect(image.allowed).toBe(false);
    expect(image.missingClaims).toContain("static.strategy");
    expect(contentPathGate("text", claims).allowed).toBe(false);
  });

  it("keeps GIF gated on source-only support", () => {
    const claims = resolveClaims(baseline);
    const gif = contentPathGate("gif", claims);
    expect(gif.allowed).toBe(false);
    expect(gif.missingClaims).toContain("gif.playback");
  });

  it("unlocks images once a static strategy is verified this session", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "static.strategy", status: "verified", scope: "current-session", provenance: "observed", summary: "animation-single-frame validated" },
    ];
    const claims = resolveClaims(evidence);
    expect(contentPathGate("image", claims).allowed).toBe(true);
    expect(contentPathGate("text", claims).allowed).toBe(true);
    // Unrelated paths do not silently unlock.
    expect(contentPathGate("gif", claims).allowed).toBe(false);
  });

  it("does not let an inconclusive Graffiti result unlock unrelated content", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "graffiti.playback-stability", status: "unresolved", scope: "current-session", provenance: "observed", summary: "inconclusive" },
    ];
    const claims = resolveClaims(evidence);
    expect(contentPathGate("image", claims).allowed).toBe(false);
    expect(contentPathGate("animation", claims).allowed).toBe(true); // already verified independently
  });

  it("refuses previous-local-session and imported evidence as gate satisfiers", () => {
    const evidence: ClaimEvidence[] = [
      { claimId: "stored-program.upload", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old session" },
      { claimId: "static.strategy", status: "verified", scope: "imported-external", provenance: "observed", summary: "imported" },
      { claimId: "animation.frames", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
      { claimId: "animation.timing", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
      { claimId: "animation.tile-sync", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
    ];
    const claims = resolveClaims(evidence);
    for (const gate of allContentGates(claims)) expect(gate.allowed).toBe(false);
  });

  it("a current-session rejection overrides built-in verification for gating", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "animation.frames", status: "rejected", scope: "current-session", provenance: "observed", summary: "frames failed today" },
    ];
    const claims = resolveClaims(evidence);
    expect(contentPathGate("animation", claims).allowed).toBe(false);
  });
});
