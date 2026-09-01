import type { CorePlan } from "../../investigation/core-plan";
import type { DeviceProfile } from "../../core/device";
import { operationalTrust, type ClaimEvidence, type ClaimId } from "../../investigation/claims";
import { evaluateStaticViability } from "../../investigation/static-viability";
import { ILEDHAT_PROFILE_ID } from "../../profiles/iledhat-31ae-32x16";

/**
 * The bounded core plan for iLedHat characterization.
 *
 * Six milestones are enough to reach a usable support decision — that a still
 * image works via a named strategy, or that it does not and why. Everything
 * else (white calibration, GIF, persistence, power-cycle recovery) is
 * follow-up: valuable, but not something a user should have to finish before
 * MatrixSmith will tell them whether their display can show a picture.
 *
 * Two slots are conditional. The playback discriminator only matters if the
 * native path actually misbehaved, and the fallback slot only matters if the
 * native path cannot be made to work. Skipping either keeps its number, so
 * the user never sees the total move while they are working.
 */

function trustedOrRejected(claimId: ClaimId, evidence: readonly ClaimEvidence[]): boolean {
  const trust = operationalTrust(claimId, evidence);
  return trust.trusted || trust.trustedStatus === "rejected";
}

export const ILEDHAT_CORE_PLAN: CorePlan = {
  id: "iledhat-core",
  profileId: ILEDHAT_PROFILE_ID,
  title: "Core characterization",
  steps: [
    {
      id: "native-static-baseline",
      ordinal: 1,
      title: "Still image baseline",
      purpose: "Does a still image appear on the display at all, and correctly?",
      testIds: ["coolledux-graffiti-timing"],
      // Deliberately only the render question. Whether the image HOLDS is the
      // next milestone's job: if the baseline answered "it rendered, then it
      // moved", this milestone is genuinely done and the investigation has
      // moved on. Making stability a condition here left the milestone
      // permanently current with its only test already concluded.
      satisfiedBy: ["graffiti.initial-render"],
    },
    {
      id: "playback-discriminator",
      ordinal: 2,
      title: "Does it stay still?",
      purpose: "Does the image hold steady, and if not, does the one justified alternative setting fix it?",
      testIds: ["coolledux-graffiti-staytime", "coolledux-graffiti-timing"],
      satisfiedBy: ["graffiti.playback-stability"],
    },
    {
      id: "native-black",
      ordinal: 3,
      title: "Black / off behavior",
      purpose: "Are dark pixels genuinely off, or does this panel need the inherited workaround?",
      testIds: ["coolledux-graffiti-black"],
      satisfiedBy: ["graffiti.black-semantics"],
      // Black semantics belong to the native path. Once that path is ruled
      // out, they no longer gate a support decision.
      skipWhen(evidence) {
        const assessment = evaluateStaticViability(evidence);
        const graffiti = assessment.strategies.find((entry) => entry.strategy === "graffiti");
        if (graffiti?.verdict === "not-viable" && !trustedOrRejected("graffiti.black-semantics", evidence)) {
          return "The native still-image path was ruled out, so its black behavior no longer affects support.";
        }
        return null;
      },
    },
    {
      id: "pixel-mapping",
      ordinal: 4,
      title: "Color channel mapping",
      purpose: "Which parts of a pixel drive which physical colors — required before any image or text is trustworthy.",
      testIds: ["coolledux-pixel-channels"],
      satisfiedBy: ["pixel.channel-map", "pixel.encoder-correctness"],
    },
    {
      id: "fallback-viability",
      ordinal: 5,
      title: "Fallback still image",
      purpose: "If the native path cannot hold a still image, can the animation path?",
      testIds: ["coolledux-animation-static"],
      satisfiedBy: ["animation.static-single-frame"],
      // Counted for the whole journey so the total does not move while the
      // user is working, and dropped only once the native path is proven —
      // at which point a fallback is demonstrably unnecessary.
      skipWhen(evidence) {
        const assessment = evaluateStaticViability(evidence);
        const graffiti = assessment.strategies.find((entry) => entry.strategy === "graffiti");
        return graffiti?.verdict === "viable" ? "The native still-image path works, so no fallback was needed." : null;
      },
    },
    {
      id: "final-verification",
      ordinal: 6,
      title: "Support decision",
      purpose: "Confirm what this display can actually be used for.",
      testIds: [],
      // Satisfied by the derived strategy question being settled either way,
      // which is the decision the whole plan exists to reach.
      satisfiedBy: ["static.strategy"],
    },
  ],
};

export function coolLedUxCorePlan(profile: DeviceProfile): CorePlan | null {
  return profile.id === ILEDHAT_PROFILE_ID ? ILEDHAT_CORE_PLAN : null;
}
