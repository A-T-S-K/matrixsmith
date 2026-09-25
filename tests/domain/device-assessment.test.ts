import { describe, expect, it } from "vitest";
import { assessDevice } from "../../src/domain/device/assessment";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";

describe("canonical device assessment", () => {
  it("makes known verified content directly available", () => {
    const fingerprint = knownIledHatFingerprint();
    const evidence = coolLedUxDriver.claimEvidence?.(iledHat31aeProfile) ?? [];
    const assessment = assessDevice({
      target: {
        kind: "profile-resolved",
        fingerprint,
        driverId: coolLedUxDriver.id,
        profile: iledHat31aeProfile,
      },
      evidence,
      capabilities: coolLedUxDriver.capabilities(iledHat31aeProfile),
      operations: coolLedUxDriver.operations,
      live: true,
    });
    expect(assessment.readiness).toBe("ready");
    expect(assessment.summary).toMatch(/ready for normal use/i);
    expect(assessment.capabilities.text.availability).toBe("available");
    expect(assessment.capabilities.text.safety).toMatchObject({
      hazard: "routine",
      persistence: "device-stored",
      assurance: "verified",
    });
    expect(
      assessment.actions.find(({ id }) => id === "capability:text")?.label,
    ).toBe("Display it");
  });

  it("leads an unresolved display with an executable read-only identification action", () => {
    const fingerprint = knownIledHatFingerprint();
    const assessment = assessDevice({
      target: { kind: "unresolved", fingerprint, candidates: [] },
      evidence: [],
      capabilities: [],
      live: true,
    });
    expect(assessment.readiness).toBe("needs-identification");
    expect(assessment.actions).toEqual([
      expect.objectContaining({
        id: "identify-family",
        availability: "available",
        safety: {
          hazard: "routine",
          persistence: "none",
          assurance: "verified",
        },
      }),
    ]);
  });

  it("keeps imported evidence informative but non-authorizing", () => {
    const fingerprint = knownIledHatFingerprint();
    const imported = (
      coolLedUxDriver.claimEvidence?.(iledHat31aeProfile) ?? []
    ).map((entry) => ({ ...entry, scope: "imported-external" as const }));
    const assessment = assessDevice({
      target: {
        kind: "profile-resolved",
        fingerprint,
        driverId: coolLedUxDriver.id,
        profile: iledHat31aeProfile,
      },
      evidence: imported,
      capabilities: coolLedUxDriver.capabilities(iledHat31aeProfile),
      operations: coolLedUxDriver.operations,
      live: false,
    });
    expect(assessment.readiness).toBe("offline");
    expect(assessment.capabilities.text.availability).toBe("blocked");
    expect(assessment.capabilities.text.missingClaims.length).toBeGreaterThan(
      0,
    );
  });
});
