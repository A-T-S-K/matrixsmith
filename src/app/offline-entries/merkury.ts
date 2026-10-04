import type { OfflineEntry } from "../offline-catalog";
import { DriverRegistry } from "../../drivers/registry-core";
import { merkuryRgbDriver } from "../../drivers/merkury";
import {
  MERKURY_CODEC_ID,
  MERKURY_SOURCE_BASIS,
  merkuryReferenceProfile,
} from "../../profiles/merkury-reference";
import { compileOfflineFrame } from "../../application/offline-compilation";
import { Framebuffer } from "../../render/framebuffer";
import { freezeDefinition } from "../../profiles/freeze";
export const merkuryReference = freezeDefinition({
  implementation: MERKURY_CODEC_ID,
  profile: merkuryReferenceProfile,
  sourceBasis: MERKURY_SOURCE_BASIS,
});
export const merkuryRegistry = new DriverRegistry([merkuryRgbDriver]);
export function compileMerkuryExample(example: string) {
  if (!["blank", "full", "asymmetric", "rgb-gradient"].includes(example))
    throw new Error("Unknown authored example.");
  const frame = new Framebuffer(16, 16);
  if (example === "full") frame.fill(255, 255, 255);
  if (example === "rgb-gradient")
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) frame.setPixel(x, y, x * 16, y * 16, 255);
  if (example === "asymmetric") {
    frame.setPixel(0, 0, 255, 0, 0);
    frame.setPixel(15, 1, 0, 255, 0);
    frame.setPixel(0, 2, 0, 0, 255);
    frame.setPixel(15, 15, 17, 34, 51);
  }
  return compileOfflineFrame(merkuryRegistry, merkuryReference, {
    type: "ShowFrame",
    frame,
  });
}
export const merkuryEntry: OfflineEntry = freezeDefinition({
  id: "merkury",
  label: "Merkury MI-LNL62-999W 16×16 RGB",
  geometry: { width: 16, height: 16 },
  reference: merkuryReference,
  examples: [
    { id: "blank", label: "Blank" },
    { id: "full", label: "Full white" },
    { id: "asymmetric", label: "RGB boundary markers" },
    { id: "rgb-gradient", label: "RGB gradient" },
  ],
  pixelPolicy:
    "Exact 16×16 row-major RGB bytes. No resize, crop, gamma or brightness conversion; physical orientation unverified.",
  previewDescription:
    "One 16×16 RGB input frame; physical colors and orientation unverified.",
  deliveryDescription:
    "Eight planned 100-byte blocks (800 bytes total), BC 0F, one-based block index, 96 RGB bytes, 55. Source pacing: 20 ms after each block. No actual TX evidence.",
  limitations: [
    "Source-only unverified reference; every plan is independently dry-run-only. Name and FFD0/FFD1 identifiers do not authenticate hardware or establish GATT properties.",
    "Only the eight frame blocks are modeled. Source image-mode setup, finalization, storage and repeated refresh are omitted. This is not a complete hardware display procedure; acceptance, visible rendering, receipts, retention and power-cycle behavior remain unknown.",
    "20 ms is a draw_file.py source choice; other inspected implementations use 25 ms or 5 ms. With-response is an offline placeholder because source response mode is unspecified. Neither choice is a proven hardware rule.",
    "draw_picture.py has a stale 113-byte/16-byte-header/zero-based-index docstring; executed code agrees with draw_file.py and show_image.html on 100-byte blocks and indices 1–8.",
    "README reports browser service-listing trouble; HTML implementations are attempts, not evidence of browser compatibility. No checksum, compression, storage or receipt semantics inferred.",
    "Independent implementation and authored vectors; no upstream code or artwork copied. Pinned source license: MIT, copyright 2025 Oscar Lindberg.",
  ],
  sourceIds: MERKURY_SOURCE_BASIS.map((source) => source.split("@")[0]!),
  compile: compileMerkuryExample,
});
