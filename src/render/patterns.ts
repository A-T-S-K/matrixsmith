import { Framebuffer } from "./framebuffer";
import { FrameSequence } from "./frame-sequence";

/**
 * Deterministic hardware test patterns. The orientation frame identifies all
 * four corners, the center, and both axes with visually distinct colors:
 *
 *   top-left     red        top-right    green
 *   bottom-left  blue       bottom-right yellow
 *   center       white
 *
 * A single top-edge marker row (dim red) and left-edge marker column (dim
 * blue) make mirrored or rotated panels obvious even when corners look
 * plausible.
 */
export function orientationPattern(width = 32, height = 16): Framebuffer {
  const frame = new Framebuffer(width, height);
  frame.clear();

  // Edge axes: dim marker dots along the top row and left column.
  for (let x = 0; x < width; x += 2) frame.setPixel(x, 0, 96, 0, 0);
  for (let y = 0; y < height; y += 2) frame.setPixel(0, y, 0, 0, 96);

  const corner = Math.max(
    2,
    Math.min(3, Math.floor(Math.min(width, height) / 4)),
  );
  paintBlock(frame, 0, 0, corner, corner, 255, 0, 0);
  paintBlock(frame, width - corner, 0, corner, corner, 0, 255, 0);
  paintBlock(frame, 0, height - corner, corner, corner, 0, 0, 255);
  paintBlock(
    frame,
    width - corner,
    height - corner,
    corner,
    corner,
    255,
    255,
    0,
  );

  const centerW = Math.min(4, width);
  const centerH = Math.min(2, height);
  paintBlock(
    frame,
    Math.floor((width - centerW) / 2),
    Math.floor((height - centerH) / 2),
    centerW,
    centerH,
    255,
    255,
    255,
  );
  return frame;
}

/** Frame 2 of the diagnostic animation: same geometry, inverted/rotated colors. */
export function orientationPatternInverted(
  width = 32,
  height = 16,
): Framebuffer {
  const frame = new Framebuffer(width, height);
  frame.clear();
  for (let x = 0; x < width; x += 2) frame.setPixel(x, 0, 0, 96, 0);
  for (let y = 0; y < height; y += 2) frame.setPixel(0, y, 96, 96, 0);

  const corner = Math.max(
    2,
    Math.min(3, Math.floor(Math.min(width, height) / 4)),
  );
  paintBlock(frame, 0, 0, corner, corner, 0, 255, 0);
  paintBlock(frame, width - corner, 0, corner, corner, 255, 0, 0);
  paintBlock(frame, 0, height - corner, corner, corner, 255, 255, 0);
  paintBlock(frame, width - corner, height - corner, corner, corner, 0, 0, 255);

  const centerW = Math.min(4, width);
  const centerH = Math.min(2, height);
  paintBlock(
    frame,
    Math.floor((width - centerW) / 2),
    Math.floor((height - centerH) / 2),
    centerW,
    centerH,
    255,
    0,
    255,
  );
  return frame;
}

/**
 * Two-frame diagnostic animation for validating frame ordering, timing, tile
 * synchronization, and loop behavior: the orientation frame, then its
 * inverted variant, one second each.
 */
export function diagnosticAnimation(width = 32, height = 16): FrameSequence {
  return new FrameSequence(
    [
      orientationPattern(width, height),
      orientationPatternInverted(width, height),
    ],
    [{ milliseconds: 1000 }, { milliseconds: 1000 }],
  );
}

function paintBlock(
  frame: Framebuffer,
  startX: number,
  startY: number,
  blockWidth: number,
  blockHeight: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let y = startY; y < startY + blockHeight; y += 1) {
    for (let x = startX; x < startX + blockWidth; x += 1)
      frame.setPixel(x, y, r, g, b);
  }
}
