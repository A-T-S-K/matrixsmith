import { describe, expect, it } from "vitest";
import {
  CLAIM_DEFINITIONS, claimState, isClaimSatisfied, resolveClaims,
  type ClaimEvidence,
} from "../../src/investigation/claims";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const sessionVerified = (claimId: ClaimEvidence["claimId"], summary = "observed live"): ClaimEvidence =>
  ({ claimId, status: "verified", scope: "current-session", provenance: "observed", summary });

describe("atomic claims", () => {
  it("defaults every claim to unknown with no evidence", () => {
    for (const state of resolveClaims([])) {
      expect(state.status).toBe("unknown");
      expect(state.decidedBy).toBeNull();
    }
  });

  it("has a definition for every referenced prerequisite", () => {
    const ids = new Set(CLAIM_DEFINITIONS.map((definition) => definition.id));
    for (const definition of CLAIM_DEFINITIONS) {
      for (const prerequisite of definition.prerequisites) expect(ids.has(prerequisite)).toBe(true);
    }
  });

  it("lets current-session evidence outrank source and profile scopes", () => {
    const evidence: ClaimEvidence[] = [
      { claimId: "graffiti.black-semantics", status: "source-supported", scope: "source-reference", provenance: "source-derived", summary: "upstream white sentinel" },
      { claimId: "graffiti.black-semantics", status: "verified", scope: "current-session", provenance: "observed", summary: "0x0000 rendered off on this panel" },
    ];
    const state = claimState("graffiti.black-semantics", evidence);
    expect(state.status).toBe("verified");
    expect(state.decidedBy?.scope).toBe("current-session");
  });

  it("prefers a rejection over a verification within the same scope", () => {
    const evidence: ClaimEvidence[] = [
      sessionVerified("graffiti.playback-stability"),
      { claimId: "graffiti.playback-stability", status: "rejected", scope: "current-session", provenance: "observed", summary: "raster moved after 3.2 seconds" },
    ];
    expect(claimState("graffiti.playback-stability", evidence).status).toBe("rejected");
  });

  it("does not let a partial observation verify a broad capability", () => {
    // Verifying the initial render says nothing about stability, black, or colors.
    const evidence = [sessionVerified("graffiti.initial-render")];
    expect(claimState("graffiti.initial-render", evidence).status).toBe("verified");
    expect(claimState("graffiti.playback-stability", evidence).status).toBe("unknown");
    expect(claimState("graffiti.black-semantics", evidence).status).toBe("unknown");
    // static.strategy is derived: with one requirement verified and the rest
    // open, it is honestly unresolved, never verified.
    expect(claimState("static.strategy", evidence).status).toBe("unresolved");
  });

  it("keeps autonomous looping distinct from power-cycle persistence", () => {
    const evidence = [sessionVerified("animation.autonomous-loop")];
    expect(claimState("animation.autonomous-loop", evidence).status).toBe("verified");
    expect(claimState("power-cycle.persistence", evidence).status).toBe("unknown");
  });

  it("keeps stored-program upload separate from the content semantics inside it", () => {
    const evidence = [sessionVerified("stored-program.upload")];
    expect(claimState("stored-program.upload", evidence).status).toBe("verified");
    expect(claimState("graffiti.initial-render", evidence).status).toBe("unknown");
    expect(claimState("animation.frames", evidence).status).toBe("unknown");
  });

  it("blocks a verified presentation when a prerequisite is rejected", () => {
    const evidence: ClaimEvidence[] = [
      { claimId: "raster.tiling", status: "rejected", scope: "current-session", provenance: "observed", summary: "tiles misaligned" },
      sessionVerified("raster.orientation"),
    ];
    const state = claimState("raster.orientation", evidence);
    expect(state.blockedByPrerequisite).toBe("raster.tiling");
    expect(state.status).toBe("unresolved");
  });

  it("never lets direct evidence decide the derived static strategy", () => {
    // A direct "static.strategy verified" entry (e.g. from a poisoned or
    // over-eager source) has no authority: the claim derives from its
    // atomic requirements, which are unknown here.
    const evidence: ClaimEvidence[] = [
      { claimId: "static.strategy", status: "verified", scope: "current-session", provenance: "observed", summary: "casually asserted" },
    ];
    expect(isClaimSatisfied("static.strategy", evidence)).toBe(false);
    const state = claimState("static.strategy", evidence);
    expect(state.status).toBe("unknown");
    expect(state.decidedBy).toBeNull();
    expect(state.derivedSummary).toBeTruthy();
  });
});

describe("coolLedUxBaselineClaimEvidence", () => {
  const evidence = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);

  it("reflects the current physical iLedHat evidence honestly", () => {
    expect(claimState("brightness.control", evidence).status).toBe("verified");
    expect(claimState("animation.frames", evidence).status).toBe("verified");
    expect(claimState("animation.black-semantics", evidence).status).toBe("verified");
    expect(claimState("graffiti.initial-render", evidence).status).toBe("verified");
    expect(claimState("graffiti.playback-stability", evidence).status).toBe("unresolved");
    expect(claimState("graffiti.black-semantics", evidence).status).toBe("source-supported");
    expect(claimState("pixel.white-channel", evidence).status).toBe("unknown");
    expect(claimState("power-cycle.persistence", evidence).status).toBe("unknown");
    expect(claimState("static.strategy", evidence).status).toBe("unresolved");
    expect(claimState("animation.static-single-frame", evidence).status).toBe("unknown");
  });

  it("never marks physically untested claims as current-session", () => {
    for (const entry of evidence) expect(entry.scope).not.toBe("current-session");
  });

  it("only ships source-reference evidence for unknown profiles", () => {
    const generic = coolLedUxBaselineClaimEvidence({ ...iledHat31aeProfile, id: "some-other-profile" });
    for (const entry of generic) expect(entry.scope).toBe("source-reference");
  });
});
