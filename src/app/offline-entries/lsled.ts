import { DriverRegistry } from "../../drivers/registry-core";
import { lsledLegacyDriver } from "../../drivers/lsled";
import {
  LSLED_CODEC_ID,
  LSLED_SOURCE_BASIS,
  lsledLegacyReference,
} from "../../profiles/lsled-legacy-reference";
import { compileOfflineFrame } from "../../application/offline-compilation";
import { Framebuffer } from "../../render/framebuffer";
import { freezeDefinition } from "../../profiles/freeze";
export const offlineReference = freezeDefinition({
  implementation: LSLED_CODEC_ID,
  profile: lsledLegacyReference,
  sourceBasis: LSLED_SOURCE_BASIS,
});
export const offlineRegistry = new DriverRegistry([lsledLegacyDriver]);
export type OfflineExample = "blank" | "asymmetric" | "checkerboard";
export function compileOfflineExample(example: string) {
  if (!["blank", "asymmetric", "checkerboard"].includes(example))
    throw new Error("Unknown authored example.");
  const frame = new Framebuffer(44, 11);
  if (example === "asymmetric")
    for (const [x, y] of [
      [0, 0],
      [7, 1],
      [8, 2],
      [16, 3],
      [24, 4],
      [32, 5],
      [40, 6],
      [43, 10],
      [0, 10],
    ])
      frame.setPixel(x!, y!, 255, 255, 255);
  if (example === "checkerboard")
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 44; x++)
        if ((x + y) % 2 === 0) frame.setPixel(x, y, 255, 255, 255);
  return compileOfflineFrame(offlineRegistry, offlineReference, {
    type: "ShowFrame",
    frame,
  });
}

export const lsledEntry = freezeDefinition({
  id: "lsled",
  label: "LSLED legacy 44×11",
  geometry: { width: 44, height: 11 },
  reference: offlineReference,
  examples: [
    { id: "blank", label: "Blank" },
    { id: "asymmetric", label: "Asymmetric markers" },
    { id: "checkerboard", label: "Checkerboard" },
  ],
  pixelPolicy:
    "Exact black/white input; no threshold, resize or crop. Eight-column groups use the most significant bit first. The last group has four unused low bits per row, set to zero. Unused banks and header padding are zero.",
  previewDescription: "One bank · fixed mode · no flashing or marquee.",
  deliveryDescription:
    "64-byte header + 66-byte bitmap = 130-byte program. 14 zero padding bytes. 9 packets × 16 bytes = 144 planned bytes. No actual TX evidence.",
  limitations: [
    "Timestamp: six zero bytes, a deterministic offline policy. Its device meaning is uncertain. Timing, persistence, Read/Notify responses and acknowledgements remain unknown. A transfer would model program replacement; no live operation is offered.",
    "OEM LSLED notes describe FEE1 Read/Write/Notify; open-firmware legacy is write-only. F055 next-gen is separate and unsupported here. Names and shared UUIDs cannot identify firmware, chipset or compatible hardware.",
    "The original app differs in month encoding, aligned-length padding and bitmap preprocessing. This proof covers the documented fixed layout and group ordering, not whole-app equivalence. Firmware README hardware observations are author reports, not evidence about your device.",
    "Inspected firmware revision: b2137f083bc24e212fe6281b53b26c1d511cd9b0. App encoder/converters/tests revision: 69377e7e97458e541d8bebd58793ad20833dfeb9. Independently authored bit-string vectors; no upstream fonts or assets.",
  ],
  sourceIds: offlineReference.sourceBasis.map(
    (source) => source.split("@")[0]!,
  ),
  compile: compileOfflineExample,
});
