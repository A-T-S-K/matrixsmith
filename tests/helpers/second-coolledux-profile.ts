import type { DeviceFingerprint, DeviceProfile } from "../../src/core/device";
import data from "../../src/profiles/data/authored-ux-banner.json";
import { parseProfileDocument } from "../../src/profiles/document";
import {
  acceptLocalProfile,
  withLocalProfiles,
} from "../../src/profiles/registration";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import type { MatrixDriver } from "../../src/drivers/types";
import type { ClaimEvidence } from "../../src/investigation/claims";
import { knownIledHatFingerprint } from "./fixtures";

/** A software-only profile contribution; no inherited iLedHat verification. */
const accepted = acceptLocalProfile(parseProfileDocument(JSON.stringify(data)));
export const secondProfile: DeviceProfile = accepted.profile;

export const secondProfileEvidence: readonly ClaimEvidence[] =
  coolLedUxDriver.claimEvidence?.(secondProfile) ?? [];

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
export const secondProfileDriver: MatrixDriver = withLocalProfiles(
  coolLedUxDriver,
  [accepted],
);
