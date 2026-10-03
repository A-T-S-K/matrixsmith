import { DriverRegistry } from "../drivers/registry";
import { lsledLegacyDriver } from "../drivers/lsled";
import {
  LSLED_CODEC_ID,
  LSLED_SOURCE_BASIS,
  lsledLegacyReference,
} from "../profiles/lsled-legacy-reference";
import { compileOfflineFrame } from "../application/offline-compilation";
import { Framebuffer } from "../render/framebuffer";
import { freezeDefinition } from "../profiles/freeze";
export const offlineReference = freezeDefinition({
  implementation: LSLED_CODEC_ID,
  profile: lsledLegacyReference,
  sourceBasis: LSLED_SOURCE_BASIS,
});
export const offlineRegistry = new DriverRegistry([lsledLegacyDriver]);
export type OfflineExample = "blank" | "asymmetric" | "checkerboard";
export function compileOfflineExample(example: OfflineExample) {
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
