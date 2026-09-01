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
 * Two slots are conditional. Native black semantics only matter if the native
 * path can actually hold a still image, and the fallback slot only matters if
 * it cannot. Skipping either keeps its number, so the user never sees the
 * total move while they are working.
 *
 * The order establishes a viable static substrate BEFORE characterizing its
 * pixels. A real session ran the full colour/channel test after both native
 * playback configurations had already failed — careful work on a substrate
 * that might not exist at all.
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
      id: "fallback-viability",
      ordinal: 4,
      title: "Fallback still image",
      purpose: "If the native path cannot hold a still image, can the animation path?",
      testIds: ["coolledux-animation-static"],
      satisfiedBy: ["animation.static-single-frame"],
      // Ahead of channel mapping on purpose. The real session walked a long
      // colour/channel test after BOTH native configurations had already
      // failed, which asked the user to characterize pixels for a substrate
      // that might not exist. Establish that something can hold a still image
      // first; characterizing its colours is only useful once it can.
      //
      // A fallback is only work while the native path is conclusively ruled
      // out. Counted for the whole journey so the total never moves, and
      // stood down both when the native path is proven and while it is still
      // undecided — sending the user to characterize a fallback for a path
      // that may yet work is the same mistake in the other direction.
      skipWhen(evidence) {
        const assessment = evaluateStaticViability(evidence);
        const graffiti = assessment.strategies.find((entry) => entry.strategy === "graffiti");
        if (graffiti?.verdict === "viable") return "The native still-image path works, so no fallback was needed.";
        if (graffiti?.verdict === "not-viable") return null;
        return "The native still-image path has not been ruled out, so no fallback is needed yet.";
      },
    },
    {
      id: "pixel-mapping",
      ordinal: 5,
      title: "Color channel mapping",
      purpose: "Which parts of a pixel drive which physical colors — required before any image or text is trustworthy.",
      testIds: ["coolledux-pixel-channels"],
      satisfiedBy: ["pixel.channel-map", "pixel.encoder-correctness"],
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
