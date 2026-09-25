import { describe, expect, it } from "vitest";
import { resolveSessionBehavior } from "../../src/investigation/session-behavior";
import type { ClaimEvidence } from "../../src/investigation/claims";
import { offColorForBehavior } from "../../src/drivers/coolledux/pixels";
import { coolLedUxBaselineClaimEvidence } from "../../src/drivers/coolledux/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

const baseline = coolLedUxBaselineClaimEvidence(iledHat31aeProfile);

describe("session-resolved behavior", () => {
  it("keeps the conservative default with no session evidence", () => {
    const behavior = resolveSessionBehavior(baseline);
    expect(behavior.graffitiBlack).toBeNull();
    expect([
      ...offColorForBehavior("graffiti", behavior.graffitiBlack),
    ]).toEqual([0x00, 0x04]);
  });

  it("activates true-black only from trusted current-session evidence with structured details", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "off",
        details: { zeroBehavior: "true-black" },
      },
    ];
    const behavior = resolveSessionBehavior(evidence);
    expect(behavior.graffitiBlack?.state).toBe("true-black");
    expect([
      ...offColorForBehavior("graffiti", behavior.graffitiBlack),
    ]).toEqual([0x00, 0x00]);
  });

  it("keeps the workaround when the white sentinel is directly observed", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "white",
        details: { zeroBehavior: "white-sentinel" },
      },
    ];
    const behavior = resolveSessionBehavior(evidence);
    expect(behavior.graffitiBlack?.state).toBe("white-sentinel");
    expect([
      ...offColorForBehavior("graffiti", behavior.graffitiBlack),
    ]).toEqual([0x00, 0x04]);
  });

  it("never activates from historical or unstructured evidence", () => {
    const historical: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "previous-local-session",
        provenance: "observed",
        summary: "old",
        details: { zeroBehavior: "true-black" },
      },
    ];
    expect(resolveSessionBehavior(historical).graffitiBlack).toBeNull();
    const unstructured: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "graffiti.black-semantics",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "off but no details",
      },
    ];
    expect(resolveSessionBehavior(unstructured).graffitiBlack).toBeNull();
  });

  it("records an observed channel permutation without auto-applying it", () => {
    const evidence: ClaimEvidence[] = [
      ...baseline,
      {
        claimId: "pixel.channel-map",
        status: "verified",
        scope: "current-session",
        provenance: "observed",
        summary: "permuted",
        details: {
          observedMap: "0x0F00→green, 0x00F0→red, 0x000F→blue",
          matchesRgb444: false,
        },
      },
    ];
    const behavior = resolveSessionBehavior(evidence);
    expect(behavior.observedChannelMap?.matchesRgb444).toBe(false);
    expect(behavior.observedChannelMap?.map).toContain("green");
  });

  it("never touches the animation off color", () => {
    expect([
      ...offColorForBehavior("animation", {
        state: "white-sentinel",
        basis: "observed",
        workaroundWord: 0x0004,
      }),
    ]).toEqual([0x00, 0x00]);
  });
});
