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
export function coolLedUxBaselineClaimEvidence(profile: DeviceProfile): readonly ClaimEvidence[] {
  if (profile.id !== ILEDHAT_PROFILE_ID) return SOURCE_REFERENCE_EVIDENCE;
  return [...ILEDHAT_PROFILE_EVIDENCE, ...SOURCE_REFERENCE_EVIDENCE];
}

const ILEDHAT_PROFILE_EVIDENCE: readonly ClaimEvidence[] = Object.freeze([
  { claimId: "transport.bluetooth", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "FFF0/FFF1 READ/NOTIFY/WRITE WITHOUT RESPONSE transport connects and accepts writes on the physical iLedHat." },
  { claimId: "protocol.coolledux", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "The structured CoolLEDUX 0x1F device-info query returns a valid 48-byte response; classic CoolLEDX 0x08 brightness semantics were rejected." },
  { claimId: "device-info.query", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Power and brightness fields in the 0x1F prefix read back as structured values." },
  { claimId: "brightness.control", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Brightness opcode 0x04 visibly changed the panel and the change was confirmed by device-info readback." },
  { claimId: "stored-program.upload", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Tiled Graffiti and Animation stored programs were accepted and rendered by the physical iLedHat." },
  { claimId: "stored-program.receipts", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Announce-style and chunk-style receipt notifications were observed during physically successful uploads; their exact semantics remain unmapped and they are not treated as acknowledgements." },
  { claimId: "raster.tiling", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Four 8-column tiles reconstructed a recognizable full 32×16 diagnostic raster." },
  { claimId: "raster.orientation", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Corner positions and placement were substantially correct in the tiled Graffiti diagnostic." },
  { claimId: "graffiti.initial-render", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "The tiled Graffiti program initially rendered the full intended raster." },
  { claimId: "graffiti.playback-stability", status: "unresolved", scope: "built-in-profile", provenance: "observed", summary: "After initially appearing correctly (mode=0, speed=0, stayTime=3), the Graffiti raster began moving in a deterministic cycle: progressive movement, a large blank interval, wrap/re-entry, reconstruction. Upstream reference hardware reports mode=0 as Static; the cause on this iLedHat is unknown." },
  { claimId: "graffiti.color-mapping", status: "unresolved", scope: "built-in-profile", provenance: "observed", summary: "Active-color issues looked materially the same on the Graffiti and Animation paths; not classified as Graffiti-specific." },
  { claimId: "animation.frames", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Two distinct frames of the tiled diagnostic animation alternated on the physical panel." },
  { claimId: "animation.timing", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "The two-frame diagnostic animation held each frame for approximately the declared duration." },
  { claimId: "animation.tile-sync", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "All four 8-column tiles changed frames together with no lagging strip." },
  { claimId: "animation.autonomous-loop", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "The animation kept looping on its own after upload with no further Bluetooth traffic. This does not establish power-cycle persistence." },
  { claimId: "animation.black-semantics", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "Animation-path literal 0x0000 background is genuinely off/black on this iLedHat." },
  { claimId: "pixel.channel-map", status: "unresolved", scope: "built-in-profile", provenance: "observed", summary: "RGB-max \"white\" does not appear convincingly neutral on this panel; the actual channel behavior of the 16-bit pixel word is not yet characterized on this device." },
  { claimId: "pixel.color-calibration", status: "unresolved", scope: "built-in-profile", provenance: "observed", summary: "Rendered white looks tinted rather than neutral; calibration work is premature until the channel map is characterized." },
  { claimId: "static.strategy", status: "unresolved", scope: "built-in-profile", provenance: "observed", summary: "No static-raster strategy is validated: Graffiti moved after its initial render and the Animation single-frame alternative is untested." },
  { claimId: "recovery.manual-reset", status: "verified", scope: "built-in-profile", provenance: "observed", summary: "A single observation: a long power-button action displayed \"reset\" and restored the default scrolling content. Exact timing and reset class are unknown; no automatic restoration exists." },
]);

const SOURCE_REFERENCE_EVIDENCE: readonly ClaimEvidence[] = Object.freeze([
  { claimId: "power.control", status: "source-supported", scope: "source-reference", provenance: "source-derived", summary: "Power opcode 0x05 is confirmed as a genuine blank/unblank on upstream reference hardware (coolledux-ble@4f5656d); untested on this iLedHat." },
  { claimId: "graffiti.black-semantics", status: "source-supported", scope: "source-reference", provenance: "source-derived", summary: "Upstream reference hardware renders a literal Graffiti 0x0000 pixel as bright white, motivating the 0x0004 off workaround (coolledux-ble@4f5656d). Not yet observed on this iLedHat." },
  { claimId: "gif.playback", status: "source-supported", scope: "source-reference", provenance: "source-derived", summary: "The native GIF decoder (cmd 0x0C) is hardware-confirmed upstream only within the untiled ≤8-column zone (coolledux-ble@4f5656d)." },
]);
