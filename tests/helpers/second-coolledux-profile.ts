import type { DeviceFingerprint, DeviceProfile } from "../../src/core/device";
import { COOLLEDUX_DEFAULT_QUIRKS } from "../../src/core/quirks";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import type { MatrixDriver } from "../../src/drivers/types";
import {
  evaluateKnownProfile,
  ILEDHAT_SIGNATURE,
} from "../../src/profiles/known-profiles";
import type { ClaimEvidence } from "../../src/investigation/claims";
import { knownIledHatFingerprint } from "./fixtures";

/** A software-only profile contribution; no inherited iLedHat verification. */
export const secondProfile: DeviceProfile = {
  id: "test-coolledux-48x8",
  name: "Synthetic UX Banner",
  driverId: "coolledux",
  width: 48,
  height: 8,
  validation: "experimental",
  evidence: [
    {
      id: "authored-ux-banner",
      summary: "Authored 48×8 fixture; geometry is not a physical observation.",
      confidence: "inferred",
      source: "tests/helpers/second-coolledux-profile.ts",
    },
  ],
  metadata: { synthetic: true },
  quirks: COOLLEDUX_DEFAULT_QUIRKS,
};

export const secondProfileEvidence: readonly ClaimEvidence[] = [
  {
    claimId: "device-info.query",
    status: "source-supported",
    scope: "source-reference",
    provenance: "source-derived",
    summary:
      "Only the existing family query codec is reused; this profile is unverified.",
  },
  {
    claimId: "raster.tiling",
    status: "rejected",
    scope: "source-reference",
    provenance: "inferred",
    summary:
      "Synthetic contradiction: the iLedHat four-tile assumption cannot describe a 48-column profile.",
  },
];

const signature = {
  ...ILEDHAT_SIGNATURE,
  profileId: secondProfile.id,
  name: "synthetic ux banner",
  width: 48,
  height: 8,
  rejectedDrivers: {},
};

export function secondFingerprint(): DeviceFingerprint {
  return {
    ...knownIledHatFingerprint(),
    name: secondProfile.name,
    browserDeviceId: "synthetic-ux-banner",
    manuallyConfirmedGeometry: { width: 48, height: 8 },
    evidenceRefs: ["authored-ux-banner"],
    notes: ["Authored test data. No hardware support implied."],
  };
}

/** Local registry contribution; leaves production signatures and registry alone. */
export const secondProfileDriver: MatrixDriver = {
  ...coolLedUxDriver,
  profiles: () => [...coolLedUxDriver.profiles(), secondProfile],
  match: (fingerprint) => {
    const verdict = evaluateKnownProfile(signature, fingerprint);
    if (verdict.matched)
      return {
        driverId: "coolledux",
        score: 100,
        confidence: "exact",
        reasons: verdict.reasons,
        contradictions: [],
      };
    const original = coolLedUxDriver.match(fingerprint);
    return {
      ...original,
      contradictions: [...original.contradictions, ...verdict.contradictions],
    };
  },
  resolveProfile: (fingerprint) =>
    evaluateKnownProfile(signature, fingerprint).matched
      ? secondProfile
      : coolLedUxDriver.resolveProfile(fingerprint),
  claimEvidence: (profile) =>
    profile.id === secondProfile.id
      ? secondProfileEvidence
      : (coolLedUxDriver.claimEvidence?.(profile) ?? []),
};
