import type { DeviceFingerprint } from "../../../core/device";
import { identifyKnownProfile } from "../../../profiles/known-profiles";
import type { DriverMatch } from "../../types";

/**
 * Apply a recognized profile's own protocol assignment to a driver match.
 *
 * Both CoolLED drivers score the same shared FFF0/FFF1 transport, which is
 * exactly the ambiguity the 0x1F probe exists to break. For a display whose
 * profile already records which family it actually speaks — measured, not
 * guessed — that ambiguity is already resolved and the probe is redundant.
 *
 * The assignment is profile-specific and generic in the code: no driver
 * contains a name check. A profile that has ruled a driver out says so in its
 * own signature, and the rejection carries the physical reason into the UI
 * rather than reading as an arbitrary downgrade.
 */
export function applyKnownProfileDisposition(match: DriverMatch, fingerprint: DeviceFingerprint): DriverMatch {
  const known = identifyKnownProfile(fingerprint);
  // A contradicted signature ("iLedHat" with the wrong geometry, say) grants
  // nothing to anyone: the display falls back to the conservative shared-
  // transport treatment, with the disagreement recorded so it is visible.
  if (!known) return match;
  if (!known.matched) {
    return { ...match, contradictions: [...match.contradictions, ...known.contradictions] };
  }
  if (known.signature.driverId === match.driverId) {
    return {
      ...match,
      score: 100,
      confidence: "exact",
      reasons: [...match.reasons, `matches the characterized ${known.signature.profileId} profile (${known.reasons.join("; ")})`],
    };
  }
  const rejection = known.signature.rejectedDrivers[match.driverId];
  if (rejection) {
    return { ...match, score: 0, confidence: "none", reasons: [], contradictions: [...match.contradictions, rejection] };
  }
  return match;
}
