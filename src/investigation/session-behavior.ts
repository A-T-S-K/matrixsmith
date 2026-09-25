import type { BlackSemantics } from "../core/quirks";
import { operationalTrust, type ClaimEvidence } from "./claims";

/**
 * Session-resolved device behavior. Built-in ProfileQuirks are immutable;
 * when guided physical evidence establishes behavior on the CURRENT device
 * session (e.g. "Graffiti 0x0000 is true black"), it is represented here as
 * an explicit resolved-behavior structure that content compilation consults
 * beside the profile — never by mutating the profile and never by
 * scattering claim checks through compiler code. Only sufficiently
 * established evidence activates: a trusted current-session verification
 * with structured details. Speculative, historical, or imported evidence
 * never changes runtime behavior.
 */
export interface SessionResolvedBehavior {
  /** Graffiti literal-0x0000 semantics established this session, or null to keep the profile default. */
  readonly graffitiBlack: BlackSemantics | null;
  /**
   * The characterized raw channel map, informational only: a discovered
   * permutation is recorded for driver/profile correction in code and
   * re-verification — it is never auto-applied to the encoder at runtime.
   */
  readonly observedChannelMap: {
    readonly map: string;
    readonly matchesRgb444: boolean;
  } | null;
}

export const EMPTY_SESSION_BEHAVIOR: SessionResolvedBehavior = Object.freeze({
  graffitiBlack: null,
  observedChannelMap: null,
});

export function resolveSessionBehavior(
  evidence: readonly ClaimEvidence[],
): SessionResolvedBehavior {
  let graffitiBlack: BlackSemantics | null = null;
  const black = operationalTrust("graffiti.black-semantics", evidence);
  if (black.trusted && black.basis?.scope === "current-session") {
    const zeroBehavior = black.basis.details?.zeroBehavior;
    if (zeroBehavior === "true-black")
      graffitiBlack = { state: "true-black", basis: "observed" };
    else if (zeroBehavior === "white-sentinel")
      graffitiBlack = {
        state: "white-sentinel",
        basis: "observed",
        workaroundWord: 0x0004,
      };
  }
  let observedChannelMap: SessionResolvedBehavior["observedChannelMap"] = null;
  const channel = operationalTrust("pixel.channel-map", evidence);
  if (
    channel.trusted &&
    channel.basis?.scope === "current-session" &&
    typeof channel.basis.details?.observedMap === "string"
  ) {
    observedChannelMap = {
      map: channel.basis.details.observedMap,
      matchesRgb444: channel.basis.details.matchesRgb444 === true,
    };
  }
  if (!graffitiBlack && !observedChannelMap) return EMPTY_SESSION_BEHAVIOR;
  return { graffitiBlack, observedChannelMap };
}
