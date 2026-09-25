import type { ClaimEvidence } from "../../src/investigation/claims";

/**
 * A CoolLEDUX panel that has been identified but never physically
 * characterized — the state the iLedHat itself was in before its 2026-09-01
 * session.
 *
 * The shipped iLedHat profile used to serve this role in tests, because it
 * shipped mostly-unknown facts. It no longer can: it now ships a verified
 * static substrate, so using it as an "uncharacterized device" would assert
 * the opposite of what those tests mean. Anything about how the product
 * behaves BEFORE characterization belongs here; anything about the
 * productionized iLedHat should use the real profile evidence.
 */
export function uncharacterizedCoolLedUxEvidence(): readonly ClaimEvidence[] {
  return Object.freeze<ClaimEvidence[]>([
    {
      claimId: "transport.bluetooth",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "FFF0/FFF1 transport connects and accepts writes.",
    },
    {
      claimId: "protocol.coolledux",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "The structured 0x1F device-info query answers.",
    },
    {
      claimId: "device-info.query",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Power and brightness read back as structured fields.",
    },
    {
      claimId: "brightness.control",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Brightness opcode visibly changed the panel.",
    },
    {
      claimId: "stored-program.upload",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Compiled stored programs are accepted and rendered.",
    },
    {
      claimId: "raster.tiling",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Tiled 8-column segments reconstruct the canvas.",
    },
    {
      claimId: "raster.orientation",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Corners land where the framebuffer places them.",
    },
    {
      claimId: "graffiti.initial-render",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "A Graffiti program initially renders the intended raster.",
    },
    {
      claimId: "animation.frames",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Animation programs decode into distinct frames.",
    },
    {
      claimId: "animation.timing",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Per-frame delays play at approximately the declared durations.",
    },
    {
      claimId: "animation.tile-sync",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "All tiles switch frames together.",
    },
    {
      claimId: "animation.black-semantics",
      status: "verified",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Animation-path literal 0x0000 is genuinely off.",
    },
    // The whole static substrate is open: playback stability untested, the
    // channel map a hypothesis, neither Animation static variant tried.
    {
      claimId: "graffiti.playback-stability",
      status: "unresolved",
      scope: "built-in-profile",
      provenance: "observed",
      summary:
        "The Graffiti raster began moving after initially rendering; the cause is unknown.",
    },
    {
      claimId: "pixel.channel-map",
      status: "unresolved",
      scope: "built-in-profile",
      provenance: "observed",
      summary:
        "RGB-max white does not look convincingly neutral; the raw channel behavior is uncharacterized.",
    },
    {
      claimId: "pixel.color-calibration",
      status: "unresolved",
      scope: "built-in-profile",
      provenance: "observed",
      summary: "Rendered white looks tinted; calibration is premature.",
    },
    {
      claimId: "graffiti.black-semantics",
      status: "source-supported",
      scope: "source-reference",
      provenance: "source-derived",
      summary:
        "Upstream renders a literal Graffiti 0x0000 as bright white, motivating the 0x0004 workaround.",
    },
    {
      claimId: "gif.playback",
      status: "source-supported",
      scope: "source-reference",
      provenance: "source-derived",
      summary: "Native GIF is source-confirmed only inside the untiled zone.",
    },
    {
      claimId: "power.control",
      status: "source-supported",
      scope: "source-reference",
      provenance: "source-derived",
      summary: "Power opcode is source-confirmed upstream; untested here.",
    },
  ]);
}
