import type { DeviceProfile } from "../core/device";
import { freezeDefinition } from "./freeze";
export const MERKURY_REVISION = "97a1be8b4edefc7eccdd2f3943997b4416d44771";
export const MERKURY_CODEC_ID = "merkury-mi-lnl62-rgb-blocks-reviewed-v1";
export const MERKURY_SOURCE_BASIS = Object.freeze([
  `merkury-draw-file@${MERKURY_REVISION}`,
  `merkury-draw-picture@${MERKURY_REVISION}`,
  `merkury-show-image@${MERKURY_REVISION}`,
  `merkury-readme@${MERKURY_REVISION}`,
]);
/** Application-owned compiler identity; never a resolved physical device profile. */
export const merkuryReferenceProfile: DeviceProfile = freezeDefinition({
  id: "reference:merkury-mi-lnl62-rgb-16x16-v1",
  name: "Merkury MI-LNL62-999W RGB offline reference",
  driverId: "merkury-rgb-reference",
  width: 16,
  height: 16,
  validation: "unverified",
  evidence: [
    {
      id: "merkury-rgb-source",
      summary:
        "Pinned reverse-engineered RGB block encoder; physical applicability unverified.",
      confidence: "inferred",
      source: MERKURY_SOURCE_BASIS[0],
    },
  ],
  metadata: {
    sourceOnly: true,
    offlineReference: true,
    codec: MERKURY_CODEC_ID,
  },
});
