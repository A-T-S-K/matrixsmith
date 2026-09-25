import type { DeviceProfile } from "../../core/device";
import type { ClaimEvidence } from "../../investigation/claims";
import { ILEDHAT_PROFILE_ID } from "../../profiles/iledhat-31ae-32x16";

/**
 * Baseline atomic-claim evidence the CoolLEDUX driver ships for its known
 * profiles. Scope discipline matters here: facts observed on the physical
 * iLedHat in earlier characterization sessions are "built-in-profile";
 * behavior demonstrated only on upstream reference hardware or derived from
 * the pinned source is "source-reference". Current-session evidence is added
 * live by guided tests, never here.
 */
export function coolLedUxBaselineClaimEvidence(
  profile: DeviceProfile,
): readonly ClaimEvidence[] {
  if (profile.id !== ILEDHAT_PROFILE_ID) return SOURCE_REFERENCE_EVIDENCE;
  return [...ILEDHAT_PROFILE_EVIDENCE, ...SOURCE_REFERENCE_EVIDENCE];
}

/**
 * What the physical iLedHat has actually been observed to do.
 *
 * These ship with the profile at "built-in-profile" scope, which is an
 * operational trust scope: a fresh session inherits them without re-running
 * anything. That is the point — the panel has been characterized, and making
 * the next user re-derive facts we already measured is not caution, it is
 * amnesia. Anything NOT measured on this exact unit stays out of this list.
 *
 * Provenance: 2026-08-31 nRF/protocol session and the 2026-09-01 physical
 * MatrixSmith guided session on the exact 32×16 iLedHat.
 */
const ILEDHAT_PROFILE_EVIDENCE: readonly ClaimEvidence[] = Object.freeze<
  ClaimEvidence[]
>([
  {
    claimId: "transport.bluetooth",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "FFF0/FFF1 READ/NOTIFY/WRITE WITHOUT RESPONSE transport connects and accepts writes on the physical iLedHat.",
  },
  {
    claimId: "protocol.coolledux",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "The structured CoolLEDUX 0x1F device-info query returns a valid 48-byte response; classic CoolLEDX 0x08 brightness semantics were rejected.",
  },
  {
    claimId: "device-info.query",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Power and brightness fields in the 0x1F prefix read back as structured values.",
  },
  {
    claimId: "brightness.control",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Brightness opcode 0x04 visibly changed the panel and the change was confirmed by device-info readback.",
  },
  {
    claimId: "stored-program.upload",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Tiled Graffiti and Animation stored programs were accepted and rendered by the physical iLedHat.",
  },
  {
    claimId: "stored-program.receipts",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Announce-style and chunk-style receipt notifications were observed during physically successful uploads; their exact semantics remain unmapped and they are not treated as acknowledgements.",
  },
  {
    claimId: "raster.tiling",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Four 8-column tiles reconstructed a recognizable full 32×16 diagnostic raster with no seams in the 2026-09-01 run.",
  },
  {
    claimId: "raster.orientation",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Corner positions and placement were correct — not rotated or mirrored — in the 2026-09-01 run.",
  },
  {
    claimId: "graffiti.initial-render",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "The tiled Graffiti program initially rendered the full intended raster.",
  },
  // Rejected, not unresolved. Both justified configurations were measured and
  // both move; there is no third justified configuration to try, so this is a
  // conclusive negative answer rather than an open question.
  {
    claimId: "graffiti.playback-stability",
    status: "rejected",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Both justified Graffiti playback configurations move on this panel. stayTime=3 held visibly still for approximately 3.6 s and stayTime=0 for approximately 1.0 s, each well below the 15 s required to call a raster stable, and each then began moving. Graffiti is not a usable static-image route here. Only these two configurations were tested; the stayTime byte's own semantics remain unknown.",
    metrics: { stayTime3HoldMs: 3600, stayTime0HoldMs: 1000 },
    details: { stayTime3: "moves", stayTime0: "moves" },
  },
  {
    claimId: "graffiti.black-semantics",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Literal raw 0x0000 is genuinely off/black on the Graffiti path of this exact iLedHat; raw 0x0004 renders as a visibly dim blue. The upstream 0x0000-is-white sentinel does NOT apply to this panel, so its 0x0004 workaround must not be substituted here.",
    details: { zeroBehavior: "true-black", workaroundAppearance: "dim-blue" },
  },
  {
    claimId: "graffiti.color-mapping",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Logical red, green and blue reach the intended physical colors on the Graffiti path; the same encoder feeds both content paths. Perceived white neutrality is tracked separately as color calibration.",
  },
  {
    claimId: "animation.frames",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Two distinct frames of the tiled diagnostic animation alternated on the physical panel.",
  },
  {
    claimId: "animation.timing",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "The two-frame diagnostic animation held each frame for approximately the declared duration.",
  },
  {
    claimId: "animation.tile-sync",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "All four 8-column tiles changed frames together with no lagging strip.",
  },
  {
    claimId: "animation.autonomous-loop",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "The animation kept looping on its own after upload with no further Bluetooth traffic. This does not establish power-cycle persistence.",
  },
  {
    claimId: "animation.black-semantics",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Animation-path literal 0x0000 background is genuinely off/black on this iLedHat.",
    details: { zeroBehavior: "true-black" },
  },
  // The measured holds are what make these count: the viability evaluator
  // refuses a stability verification that is not backed by a hold past the
  // 15 s threshold, whatever an interpreter claimed.
  {
    claimId: "animation.static-single-frame",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "A one-frame Animation program rendered the full tiled raster and held completely still for approximately 16.8 s measured from full-raster-visible, with the background genuinely off, tiles aligned, and no flicker or reset.",
    metrics: { visibleStaticHoldMs: 16800 },
  },
  {
    claimId: "animation.static-identical-pair",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "A two-identical-frame Animation program held completely still for approximately 16.2 s from full-raster-visible, with the background genuinely off, tiles aligned, and no flicker or reset. Verified as a fallback; the one-frame variant is the preferred route.",
    metrics: { visibleStaticHoldMs: 16200 },
  },
  {
    claimId: "pixel.channel-map",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Physically confirmed by single-channel patch observation: byte0 low nibble drives red, byte1 high nibble green, byte1 low nibble blue.",
    details: {
      observedMap: "0x0F00→red, 0x00F0→green, 0x000F→blue",
      matchesRgb444: true,
    },
  },
  {
    claimId: "pixel.encoder-correctness",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "The observed raw mapping matches the RGB444 ordering MatrixSmith's encoder emits, so logical colors reach the intended physical channels without correction.",
  },
  {
    claimId: "pixel.fourth-channel",
    status: "rejected",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "High-nibble-only probes 0x1000 through 0xF000 were all observed off. The byte0 high nibble drives no fourth physical emitter on this panel.",
  },
  {
    claimId: "pixel.white-channel",
    status: "rejected",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "No fourth channel exists on this panel, so there is no dedicated white emitter. Content must never assume an RGBW encoding here.",
  },
  // Deliberately still open. White looks tinted, which is a calibration
  // question, not a channel-mapping one — and inventing a different encoding
  // to chase it would contradict the physically confirmed map above.
  {
    claimId: "pixel.color-calibration",
    status: "unresolved",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      "Logical R/G/B reach the correct physical colors and no single channel was judged obviously brighter or dimmer, but RGB-max white appears tinted rather than neutral. Calibration is optional and does not block image or text use.",
  },
  // static.strategy carries no direct evidence: it is DERIVED from the
  // atomic strategy requirements (see investigation/static-viability.ts).
  // With the evidence above it derives to animation-single-frame.
  //
  // image.rendering and text.rendering also carry no evidence, deliberately.
  // Their GATE depends on stored-program.upload and static.strategy, both of
  // which are now trusted — but "allowed through a verified substrate" is not
  // the same statement as "physically smoke-tested", and the profile does not
  // claim the latter until a normal-path image has actually been looked at.
  {
    claimId: "recovery.manual-reset",
    status: "verified",
    scope: "built-in-profile",
    provenance: "observed",
    summary:
      'A single observation: a long power-button action displayed "reset" and restored the default scrolling content. Exact timing and reset class are unknown; no automatic restoration exists.',
  },
]);

const SOURCE_REFERENCE_EVIDENCE: readonly ClaimEvidence[] = Object.freeze([
  {
    claimId: "power.control",
    status: "source-supported",
    scope: "source-reference",
    provenance: "source-derived",
    summary:
      "Power opcode 0x05 is confirmed as a genuine blank/unblank on upstream reference hardware (coolledux-ble@4f5656d); untested on this iLedHat.",
  },
  // Retained as provenance for the inherited workaround, and outranked on the
  // iLedHat by the built-in-profile observation above. It still applies to
  // CoolLEDUX profiles that have not been physically characterized.
  {
    claimId: "graffiti.black-semantics",
    status: "source-supported",
    scope: "source-reference",
    provenance: "source-derived",
    summary:
      "Upstream reference hardware renders a literal Graffiti 0x0000 pixel as bright white, motivating the 0x0004 off workaround (coolledux-ble@4f5656d). Physically contradicted on the iLedHat, where 0x0000 is genuinely black.",
  },
  {
    claimId: "gif.playback",
    status: "source-supported",
    scope: "source-reference",
    provenance: "source-derived",
    summary:
      "The native GIF decoder (cmd 0x0C) is hardware-confirmed upstream only within the untiled ≤8-column zone (coolledux-ble@4f5656d).",
  },
]);
