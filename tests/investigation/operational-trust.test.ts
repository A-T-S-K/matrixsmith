import { describe, expect, it } from "vitest";
import { claimConflicts, claimState, operationalTrust, type ClaimEvidence } from "../../src/investigation/claims";
import { contentPathGate } from "../../src/investigation/gating";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const baseline = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);

describe("operational trust vs investigative state", () => {
  it("keeps the built-in operational basis when a previous local session contradicts it", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "animation.frames", status: "rejected", scope: "previous-local-session", provenance: "observed", summary: "rejected in an old session" },
    ];
    // Investigative state surfaces the historical contradiction…
    expect(claimState("animation.frames", evidence).status).toBe("rejected");
    // …but the operational basis stays the shipped built-in verification.
    const trust = operationalTrust("animation.frames", evidence);
    expect(trust.trusted).toBe(true);
    expect(trust.basis?.scope).toBe("built-in-profile");
    expect(trust.historicalConflict).toBe(true);
    expect(trust.conflictingEvidence[0]?.scope).toBe("previous-local-session");
    // The animation gate is not erased by historical evidence.
    expect(contentPathGate("animation", evidence).allowed).toBe(true);
  });

  it("never grants trust from historical or imported verification", () => {
    const evidence: ClaimEvidence[] = [
      { claimId: "stored-program.upload", status: "verified", scope: "previous-local-session", provenance: "observed", summary: "old" },
      { claimId: "gif.playback", status: "verified", scope: "imported-external", provenance: "observed", summary: "imported" },
    ];
    expect(operationalTrust("stored-program.upload", evidence).trusted).toBe(false);
    expect(operationalTrust("gif.playback", evidence).trusted).toBe(false);
  });

  it("lets a current-session rejection revoke a built-in basis", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "animation.frames", status: "rejected", scope: "current-session", provenance: "observed", summary: "failed on this device today" },
    ];
    const trust = operationalTrust("animation.frames", evidence);
    expect(trust.trusted).toBe(false);
    expect(trust.trustedStatus).toBe("rejected");
    expect(contentPathGate("animation", evidence).allowed).toBe(false);
  });

  it("respects the trust boundary for prerequisite blocking", () => {
    // A poisoned historical rejection of a prerequisite must not revoke a
    // trusted dependent claim.
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "stored-program.upload", status: "rejected", scope: "imported-external", provenance: "observed", summary: "poisoned prerequisite" },
    ];
    expect(operationalTrust("animation.frames", evidence).trusted).toBe(true);
  });

  it("lists conflicted claims for revalidation recommendations and reports", () => {
    const evidence: ClaimEvidence[] = [...baseline,
      { claimId: "animation.frames", status: "rejected", scope: "previous-local-session", provenance: "observed", summary: "old rejection" },
    ];
    const conflicts = claimConflicts(evidence);
    expect(conflicts.map((conflict) => conflict.claimId)).toContain("animation.frames");
  });
});
