import type { DeviceProfile } from "../core/device";
import { freezeDefinition } from "./freeze";
export const LSLED_CODEC_ID = "lsled-legacy-monochrome-reviewed-v1";
export const LSLED_SOURCE_BASIS = Object.freeze([
  "file-fossasia-badgemagic-firmware-BadgeBLE-md@b2137f083bc24e212fe6281b53b26c1d511cd9b0",
  "src-fossasia-badgemagic-firmware@b2137f083bc24e212fe6281b53b26c1d511cd9b0",
  "src-fossasia-badgemagic-app@69377e7e97458e541d8bebd58793ad20833dfeb9",
]);
/** Reference geometry is a compiler input, never a matched physical profile. */
export const lsledLegacyReference: DeviceProfile = freezeDefinition({
  id: "reference:lsled-legacy-44x11-v1",
  name: "LSLED legacy 44×11 offline reference",
  driverId: "lsled-legacy",
  width: 44,
  height: 11,
  validation: "unverified",
  evidence: [
    {
      id: "lsled-layout-source",
      summary: "Documented legacy layout; physical applicability unverified.",
      confidence: "inferred",
      source: LSLED_SOURCE_BASIS[0],
    },
  ],
  metadata: { sourceOnly: true, offlineReference: true, codec: LSLED_CODEC_ID },
});
