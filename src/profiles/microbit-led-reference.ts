import type { DeviceProfile } from "../core/device";
import { freezeDefinition } from "./freeze";
export const MICROBIT_DAL_REVISION = "318c6abbb3d952d3f49a595a726486230e82fb5b";
export const MICROBIT_CODEC_ID = "microbit-dal-led-matrix-reviewed-v1";
export const MICROBIT_SOURCE_BASIS = Object.freeze([
  `microbit-dal-led-cpp@${MICROBIT_DAL_REVISION}`,
  `microbit-dal-led-header@${MICROBIT_DAL_REVISION}`,
  "microbit-led@DAL-v2.1.1-documentation",
  "microbit-makecode-led@inspected-2026-10-03",
]);
/** Compiler reference only; not a physical board generation or accepted profile. */
export const microbitLedReference: DeviceProfile = freezeDefinition({
  id: "reference:microbit-dal-led-5x5-v1",
  name: "micro:bit DAL LED Matrix State offline reference",
  driverId: "microbit-led-reference",
  width: 5,
  height: 5,
  validation: "unverified",
  evidence: [
    {
      id: "microbit-led-source",
      summary: "Pinned DAL LED matrix path; physical applicability unverified.",
      confidence: "inferred",
      source: MICROBIT_SOURCE_BASIS[0],
    },
  ],
  metadata: {
    sourceOnly: true,
    offlineReference: true,
    codec: MICROBIT_CODEC_ID,
  },
});
