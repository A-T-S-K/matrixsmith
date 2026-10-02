import { FrameSequence } from "./frame-sequence";
import { measureText, renderTextColumns, textColumns } from "./font";

export type TextDisplayMode = "auto" | "still" | "scroll";

interface ScrollPlanMetadata {
  readonly textWidth: number;
  readonly step: number;
  readonly frameDelayMs: number;
  readonly frameCount: number;
  readonly decodedBytesPerTile: number;
  readonly safetyBudgetBytesPerTile: number;
  readonly warnings: readonly string[];
}

export type ScrollPlan = ScrollPlanMetadata &
  (
    | { readonly safe: true; readonly sequence: FrameSequence }
    | { readonly safe: false; readonly reason: string }
  );

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
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  )
    throw new RangeError(
      "Scroll target dimensions must be positive safe integers.",
    );
  const textWidth = measureText(text).width;
  let step = 1;
  const count = () => Math.ceil((width + textWidth) / step) + 1;
  while (count() > RASTER_SCROLL_FRAME_BUDGET && step < 8) step++;
  const frameCount = count();
  const frameDelayMs = 120 * step;
  const decodedBytesPerTile = frameCount * Math.min(8, width) * height * 2;
  const safe =
    frameCount <= RASTER_SCROLL_FRAME_BUDGET &&
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
  const metadata = {
    textWidth,
    step,
    frameDelayMs,
    frameCount,
    decodedBytesPerTile,
    safetyBudgetBytesPerTile: RASTER_SCROLL_DECODED_TILE_BUDGET,
    warnings,
  };
  if (!safe)
    return {
      ...metadata,
      safe: false,
      reason:
        "Text is too long for the scrolling preview budget. Shorten the message or choose Still.",
    };
  const columns = textColumns(text);
  const frames = Array.from({ length: frameCount }, (_, index) =>
    renderTextColumns(columns, width, height, {
      ...colors,
      alignment: "left",
      offsetX: Math.max(-textWidth, width - index * step),
    }),
  );
  return {
    ...metadata,
    safe: true,
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
