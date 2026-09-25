import { describe, expect, it } from "vitest";
import type { DeviceProfile } from "../../src/core/device";
import type { MatrixOperation } from "../../src/core/operations";
import { assessDevice } from "../../src/domain/device/assessment";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { coolLedXDriver } from "../../src/drivers/coolledx";
import type { MatrixDriver } from "../../src/drivers/types";
import type { ClaimEvidence } from "../../src/investigation/claims";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { renderText } from "../../src/render/font";
import {
  diagnosticAnimation,
  orientationPattern,
} from "../../src/render/patterns";
import { knownIledHatFingerprint } from "../helpers/fixtures";

const fingerprint = knownIledHatFingerprint();

function sampleOperation(
  operationId: MatrixOperation["type"],
  profile: DeviceProfile,
): MatrixOperation {
  const frame = orientationPattern(profile.width, profile.height);
  switch (operationId) {
    case "GetDeviceInfo":
      return { type: "GetDeviceInfo" };
    case "SetBrightness":
      return { type: "SetBrightness", raw: 0x40 };
    case "SetScrollSpeed":
      return { type: "SetScrollSpeed", raw: 3 };
    case "SetDisplayMode":
      return { type: "SetDisplayMode", mode: "static" };
    case "SetPower":
      return { type: "SetPower", on: true };
    case "ShowFrame":
      return { type: "ShowFrame", frame };
    case "ShowAnimation":
      return {
        type: "ShowAnimation",
        sequence: diagnosticAnimation(profile.width, profile.height),
      };
    case "ShowText":
      return {
        type: "ShowText",
        text: "A",
        frame: renderText("A", profile.width, profile.height, {
          color: { r: 255, g: 255, b: 255 },
        }),
      };
    case "ShowGif":
      return {
        type: "ShowGif",
        gifBytes: Uint8Array.of(
          0x47,
          0x49,
          0x46,
          0x38,
          0x39,
          0x61,
          profile.width & 0xff,
          profile.width >>> 8,
          profile.height & 0xff,
          profile.height >>> 8,
          0,
          0,
        ),
        width: profile.width,
        height: profile.height,
      };
    case "ShowScrollingText":
    case "ShowDiagnostic":
      throw new Error(`${operationId} is not a user-facing driver operation.`);
  }
}

function provisionalProfile(driver: MatrixDriver): DeviceProfile {
  return {
    id: `provisional:${driver.id}:32x16`,
    name: `${driver.family} provisional`,
    driverId: driver.id,
    width: 32,
    height: 16,
    validation: "experimental",
    evidence: [],
    metadata: { provisional: true },
  };
}

function provisionalAssessment(
  driver: MatrixDriver,
  evidence: readonly ClaimEvidence[] = [],
  identificationScope: ClaimEvidence["scope"] = "current-session",
) {
  const profile = provisionalProfile(driver);
  return {
    profile,
    assessment: assessDevice({
      target: {
        kind: "provisional",
        fingerprint,
        driverId: driver.id,
        geometry: { width: profile.width, height: profile.height },
        geometrySource: "user-confirmed",
        identificationEvidence:
          driver.id === "coolledux"
            ? [
                {
                  claimId: "protocol.coolledux",
                  status: "verified",
                  scope: identificationScope,
                  provenance: "observed",
                  summary: "A structured family-probe response was received.",
                },
                {
                  claimId: "device-info.query",
                  status: "verified",
                  scope: identificationScope,
                  provenance: "observed",
                  summary: "The query returned structured device fields.",
                },
              ]
            : [],
      },
      evidence,
      capabilities: driver.capabilities(profile),
      operations: driver.operations,
      live: true,
    }),
  };
}

describe.each([
  ["CoolLEDUX", coolLedUxDriver],
  ["CoolLEDX", coolLedXDriver],
] as const)("%s operation contract", (_family, driver) => {
  it("describes unique semantic operations for a provisional target", () => {
    const { profile, assessment } = provisionalAssessment(driver);
    expect(assessment.actions.length).toBeGreaterThan(0);
    expect(new Set(assessment.actions.map(({ id }) => id)).size).toBe(
      assessment.actions.length,
    );

    for (const action of assessment.actions) {
      expect(action.operationId).not.toBeNull();
      expect(action.reason.length).toBeGreaterThan(0);
      expect(action.confidence).toBeDefined();
      const operation = sampleOperation(action.operationId!, profile);
      const plan = driver.plan(operation, {
        profile,
        fingerprint,
        source: "live",
      });
      expect(plan.operation.type).toBe(action.operationId);
      if (action.availability === "available")
        expect(plan.execution).toBe("live");
    }
  });
});

describe("known-profile operation contract", () => {
  it("exposes only executable enabled operations with canonical evidence", () => {
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
    const enabled = assessment.actions.filter(
      ({ availability }) => availability === "available",
    );
    expect(enabled.length).toBeGreaterThan(0);

    for (const action of enabled) {
      expect(action.missingClaims).toEqual([]);
      expect(action.evidence.length).toBeGreaterThan(0);
      const operation = sampleOperation(
        action.operationId!,
        iledHat31aeProfile,
      );
      const plan = coolLedUxDriver.plan(operation, {
        profile: iledHat31aeProfile,
        fingerprint,
        source: "live",
      });
      expect(plan.operation.type).toBe(action.operationId);
      expect(plan.execution).toBe("live");
    }
  });

  it("does not let source-only provisional evidence cross operational gates", () => {
    const sourceOnly: readonly ClaimEvidence[] = [
      {
        claimId: "protocol.coolledux",
        status: "verified",
        scope: "source-reference",
        provenance: "source-derived",
        summary: "The family defines this query.",
      },
      {
        claimId: "device-info.query",
        status: "verified",
        scope: "source-reference",
        provenance: "source-derived",
        summary: "Upstream source describes a response.",
      },
    ];
    const { assessment } = provisionalAssessment(
      coolLedUxDriver,
      sourceOnly,
      "imported-external",
    );
    expect(
      assessment.actions.find(
        ({ operationId }) => operationId === "GetDeviceInfo",
      ),
    ).toMatchObject({
      availability: "blocked",
      confidence: "experimental",
      missingClaims: ["protocol.coolledux", "device-info.query"],
    });
  });
});
