import { describe, expect, it } from "vitest";
import {
  evaluateStaticViability,
  MINIMUM_STATIC_HOLD_MS,
  VISIBLE_STATIC_HOLD_METRIC,
} from "../../src/investigation/static-viability";
import type {
  ClaimEvidence,
  ClaimId,
  ClaimStatus,
} from "../../src/investigation/claims";

function session(
  claimId: ClaimId,
  status: ClaimStatus = "verified",
  extra: Partial<ClaimEvidence> = {},
): ClaimEvidence {
  return {
    claimId,
    status,
    scope: "current-session",
    provenance: "observed",
    summary: `${claimId} ${status}`,
    ...extra,
  };
}

const GRAFFITI_BASE: ClaimEvidence[] = [
  session("stored-program.upload"),
  session("raster.tiling"),
  session("raster.orientation"),
  session("graffiti.initial-render"),
];

const CHANNELS_OK: ClaimEvidence[] = [
  session("pixel.channel-map"),
  session("pixel.encoder-correctness"),
];

function graffiti(evidence: readonly ClaimEvidence[]) {
  return evaluateStaticViability(evidence).strategies.find(
    (entry) => entry.strategy === "graffiti",
  )!;
}

describe("static viability aggregator", () => {
  it("CASE A: verified render/tiling/orientation with unresolved playback is NOT viable", () => {
    const result = graffiti([
      ...GRAFFITI_BASE,
      session("graffiti.playback-stability", "unresolved"),
    ]);
    expect(result.verdict).toBe("open");
    expect(evaluateStaticViability([...GRAFFITI_BASE]).selected).toBeNull();
  });

  it("CASE B: playback verified for only 2 seconds is NOT viable", () => {
    const evidence = [
      ...GRAFFITI_BASE,
      ...CHANNELS_OK,
      session("graffiti.black-semantics"),
      session("graffiti.playback-stability", "verified", {
        metrics: { [VISIBLE_STATIC_HOLD_METRIC]: 2000 },
      }),
    ];
    const result = graffiti(evidence);
    expect(result.verdict).toBe("open");
    expect(
      result.requirements.find(
        (requirement) => requirement.claimId === "graffiti.playback-stability",
      )?.state,
    ).toBe("open");
    expect(evaluateStaticViability(evidence).selected).toBeNull();
  });

  it("CASE C: stable ≥15s but unknown black semantics is NOT yet fully viable", () => {
    const evidence = [
      ...GRAFFITI_BASE,
      ...CHANNELS_OK,
      session("graffiti.playback-stability", "verified", {
        metrics: { [VISIBLE_STATIC_HOLD_METRIC]: MINIMUM_STATIC_HOLD_MS },
      }),
    ];
    const result = graffiti(evidence);
    expect(result.verdict).toBe("open");
    expect(
      result.requirements.find(
        (requirement) => requirement.claimId === "graffiti.black-semantics",
      )?.state,
    ).toBe("open");
  });

  it("CASE D: full graffiti requirement set is viable and selected", () => {
    const evidence = [
      ...GRAFFITI_BASE,
      ...CHANNELS_OK,
      session("graffiti.black-semantics"),
      session("graffiti.playback-stability", "verified", {
        metrics: { [VISIBLE_STATIC_HOLD_METRIC]: 16000 },
      }),
    ];
    const assessment = evaluateStaticViability(evidence);
    expect(graffiti(evidence).verdict).toBe("viable");
    expect(assessment.selected).toBe("graffiti");
    expect(assessment.overall).toBe("viable");
  });

  it("CASE E: graffiti rejected with a proven animation single-frame path selects the fallback", () => {
    const evidence: ClaimEvidence[] = [
      session("stored-program.upload"),
      session("graffiti.playback-stability", "rejected"),
      session("animation.frames"),
      session("animation.tile-sync"),
      session("animation.black-semantics"),
      session("animation.static-single-frame"),
      ...CHANNELS_OK,
    ];
    const assessment = evaluateStaticViability(evidence);
    expect(graffiti(evidence).verdict).toBe("not-viable");
    expect(assessment.selected).toBe("animation-single-frame");
    expect(assessment.pursued).toBe("animation-single-frame");
  });

  it("CASE F: a rejected single-frame does not mask a verified identical pair", () => {
    const evidence: ClaimEvidence[] = [
      session("stored-program.upload"),
      session("graffiti.playback-stability", "rejected"),
      session("animation.frames"),
      session("animation.tile-sync"),
      session("animation.black-semantics"),
      session("animation.static-single-frame", "rejected"),
      session("animation.static-identical-pair"),
      ...CHANNELS_OK,
    ];
    const assessment = evaluateStaticViability(evidence);
    const single = assessment.strategies.find(
      (entry) => entry.strategy === "animation-single-frame",
    )!;
    const pair = assessment.strategies.find(
      (entry) => entry.strategy === "animation-identical-frames",
    )!;
    expect(single.verdict).toBe("not-viable");
    expect(pair.verdict).toBe("viable");
    expect(assessment.selected).toBe("animation-identical-frames");
  });

  it("walks the graffiti requirement order via nextOpenRequirement", () => {
    // With the initial render verified, the next open requirement is
    // playback stability — the exact first physical discriminator.
    const assessment = evaluateStaticViability(GRAFFITI_BASE);
    expect(assessment.pursued).toBe("graffiti");
    expect(assessment.nextOpenRequirement).toBe("graffiti.playback-stability");
  });

  it("only trusted scopes feed viability", () => {
    const historical = GRAFFITI_BASE.map((entry) => ({
      ...entry,
      scope: "previous-local-session" as const,
    }));
    const assessment = evaluateStaticViability([
      ...historical,
      {
        claimId: "graffiti.playback-stability",
        status: "verified",
        scope: "previous-local-session",
        provenance: "observed",
        summary: "old",
        metrics: { [VISIBLE_STATIC_HOLD_METRIC]: 20000 },
      },
    ]);
    expect(assessment.selected).toBeNull();
  });
});
