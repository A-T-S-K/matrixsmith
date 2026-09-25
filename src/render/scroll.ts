import { FrameSequence } from "./frame-sequence";
import { measureText, renderText, scrollOffsets } from "./font";

export type TextDisplayMode = "auto" | "still" | "scroll";

export interface ScrollPlan {
  readonly textWidth: number;
  readonly step: number;
  readonly frameDelayMs: number;
  readonly frameCount: number;
  readonly decodedBytesPerTile: number;
  readonly safetyBudgetBytesPerTile: number;
  readonly safe: boolean;
  readonly warnings: readonly string[];
  readonly sequence: FrameSequence;
}

/** Source-derived guardrail, deliberately not claimed as an iLedHat limit. */
export const RASTER_SCROLL_FRAME_BUDGET = 48;
export const RASTER_SCROLL_DECODED_TILE_BUDGET = 16 * 1024;

export function planRasterScroll(
  text: string,
  width: number,
  height: number,
  colors: {
    color: { r: number; g: number; b: number };
    background: { r: number; g: number; b: number };
  },
): ScrollPlan {
  const textWidth = measureText(text).width;
  let step = 1;
  let offsets = scrollOffsets(text, width, step);
  while (offsets.length > RASTER_SCROLL_FRAME_BUDGET && step < 8) {
    step += 1;
    offsets = scrollOffsets(text, width, step);
  }
  const frameDelayMs = 120 * step;
  const frames = offsets.map((offset) =>
    renderText(text, width, height, {
      ...colors,
      alignment: "left",
      offsetX: offset,
    }),
  );
  const decodedBytesPerTile = frames.length * Math.min(8, width) * height * 2;
  const safe =
    frames.length <= RASTER_SCROLL_FRAME_BUDGET &&
    decodedBytesPerTile <= RASTER_SCROLL_DECODED_TILE_BUDGET;
  const warnings = [
    ...(step > 1
      ? [
          `Scroll step increased to ${step} pixels to keep the raster program bounded.`,
        ]
      : []),
    ...(!safe
      ? [
          "Raster scroll exceeds the conservative source-derived safety budget and is blocked before Bluetooth transmission.",
        ]
      : []),
  ];
  return {
    textWidth,
    step,
    frameDelayMs,
    frameCount: frames.length,
    decodedBytesPerTile,
    safetyBudgetBytesPerTile: RASTER_SCROLL_DECODED_TILE_BUDGET,
    safe,
    warnings,
    sequence: new FrameSequence(
      frames,
      frames.map(() => ({ milliseconds: frameDelayMs })),
    ),
  };
}

export function resolvesToScroll(
  mode: TextDisplayMode,
  text: string,
  width: number,
): boolean {
  return (
    mode === "scroll" || (mode === "auto" && measureText(text).width > width)
  );
}
