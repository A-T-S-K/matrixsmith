/**
 * How a static raster (image, rendered text, single frame) is physically
 * delivered to the display. "ShowFrame" is deliberately decoupled from any
 * one protocol opcode: a profile/session can have candidate strategies, and
 * physical validation selects the one Normal Use routes through.
 */
export type RasterStrategy = "graffiti" | "animation-single-frame" | "animation-identical-frames";

export const RASTER_STRATEGY_LABELS: Readonly<Record<RasterStrategy, string>> = Object.freeze({
  graffiti: "Graffiti stored program",
  "animation-single-frame": "One-frame Animation program",
  "animation-identical-frames": "Two identical Animation frames",
});

export interface RasterStrategyState {
  /** Strategies the driver can compile for this profile. */
  readonly candidates: readonly RasterStrategy[];
  /** The strategy physical evidence has validated this session, if any. */
  readonly validated: RasterStrategy | null;
  /** Honest notes about known limitations per candidate. */
  readonly limitations: Readonly<Partial<Record<RasterStrategy, string>>>;
}

export function isRasterStrategy(value: unknown): value is RasterStrategy {
  return value === "graffiti" || value === "animation-single-frame" || value === "animation-identical-frames";
}
