import { DriverRegistry } from "../../drivers/registry-core";
import { microbitLedDriver } from "../../drivers/microbit";
import {
  MICROBIT_CODEC_ID,
  MICROBIT_SOURCE_BASIS,
  MICROBIT_DAL_REVISION,
  microbitLedReference,
} from "../../profiles/microbit-led-reference";
import { compileOfflineFrame } from "../../application/offline-compilation";
import { Framebuffer } from "../../render/framebuffer";
import { freezeDefinition } from "../../profiles/freeze";
export const microbitReference = freezeDefinition({
  implementation: MICROBIT_CODEC_ID,
  profile: microbitLedReference,
  sourceBasis: MICROBIT_SOURCE_BASIS,
});
export const microbitRegistry = new DriverRegistry([microbitLedDriver]);
export function compileMicrobitExample(example: string) {
  if (!["blank", "full", "asymmetric", "checkerboard"].includes(example))
    throw new Error("Unknown authored example.");
  const frame = new Framebuffer(5, 5);
  if (example === "asymmetric")
    for (const [x, y] of [
      [0, 0],
      [4, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [3, 4],
    ])
      frame.setPixel(x!, y!, 255, 255, 255);
  if (example === "full" || example === "checkerboard")
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        if (example === "full" || (x + y) % 2 === 0)
          frame.setPixel(x, y, 255, 255, 255);
  return compileOfflineFrame(microbitRegistry, microbitReference, {
    type: "ShowFrame",
    frame,
  });
}
export const microbitEntry = freezeDefinition({
  id: "microbit",
  label: "micro:bit LED Matrix State 5×5",
  geometry: { width: 5, height: 5 },
  reference: microbitReference,
  examples: [
    { id: "blank", label: "Blank" },
    { id: "full", label: "Full" },
    { id: "asymmetric", label: "Asymmetric markers" },
    { id: "checkerboard", label: "Checkerboard" },
  ],
  pixelPolicy:
    "Exact black/white input; no threshold, resize or crop. Five binary octets, rows top to bottom with USB at top. Leftmost pixel is bit 4, rightmost bit 0. Unused bits 7–5 are zero. This value is not a UTF-8 string.",
  previewDescription: "One 5×5 binary monochrome matrix.",
  deliveryDescription:
    "Direct LED Matrix State characteristic value: one planned write, five bytes. No program header, padding, compression, CRC or chunks. No actual TX evidence.",
  limitations: [
    "A matrix update can interrupt another display animation. The pinned DAL callback stops animation and replaces the display image pixels. This is ShowFrame, not a read-only query.",
    "The inspected callback contains no storage operation. Physical acceptance, other firmware behavior, timing, readback and power-cycle behavior remain unknown. A GATT response is not evidence of rendering.",
    "LED service availability depends on firmware. Name and service UUID cannot authenticate board generation or prove service availability. Pairing/security configuration is a compatibility question this offline tool cannot establish.",
    `Runtime scope: Lancaster microbit-dal at ${MICROBIT_DAL_REVISION}; LED-service documentation identifies DAL v2.1.1. MakeCode startLEDService documentation was inspected on 2026-10-03 for enablement context only. This is not a claim that all V1/V2 or MakeCode firmware behaves identically.`,
    "The pinned callback accepts 1–5 rows and masks bits 4–0; this compiler deliberately requires a complete five-row value. Bits 7–5 have no display semantics in that callback. No supplied-state decoder or readback editor is offered.",
    "Independent encoder and literal vectors; no upstream code or artwork copied. Runtime source: MIT, copyright 2016 British Broadcasting Corporation, provided by Lancaster University by arrangement with the BBC.",
  ],
  sourceIds: MICROBIT_SOURCE_BASIS.map((source) => source.split("@")[0]!),
  compile: compileMicrobitExample,
});
