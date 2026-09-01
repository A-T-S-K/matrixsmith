import type { Framebuffer, Rgb } from "../../render/framebuffer";

/**
 * CoolLEDUX RGB444 color encoding. Two distinct encodings exist depending on
 * content type: a plain truncating divide for TEXT message color runs, and a
 * perceptual clamping curve for per-pixel Graffiti/Animation content. The
 * logical framebuffer stays RGB888 and driver-independent; only this driver
 * performs wire conversion.
 */

/** Text-message color encoding: plain /16 truncation, packed as [R4, G4<<4|B4]. */
export function rgb444TextColor(r: number, g: number, b: number): Uint8Array {
  const r4 = Math.floor(clampByte(r) / 16);
  const g4 = Math.floor(clampByte(g) / 16);
  const b4 = Math.floor(clampByte(b) / 16);
  return Uint8Array.of(r4 & 0x0f, ((g4 & 0x0f) << 4) | (b4 & 0x0f));
}

/** Per-channel clamping curve for Graffiti/Animation pixels: v<=47 -> 0, v>=238 -> 15, else a linear ramp. */
export function rgb444TransferChannel(value: number): number {
  const v = clampByte(value);
  if (v >= 238) return 15;
  if (v <= 47) return 0;
  return Math.floor((v - 47) / 14) + 1;
}

/** Per-pixel Graffiti/Animation color encoding via the clamping curve. */
export function rgb444PixelColor(r: number, g: number, b: number): Uint8Array {
  const r4 = rgb444TransferChannel(r);
  const g4 = rgb444TransferChannel(g);
  const b4 = rgb444TransferChannel(b);
  return Uint8Array.of(r4 & 0x0f, ((g4 & 0x0f) << 4) | (b4 & 0x0f));
}

/**
 * Graffiti-path "off" sentinel. Hardware-confirmed by the pinned reference:
 * a literal 0x0000 pixel renders as bright white on the Graffiti path, and
 * bytes 0x01-0x03 double under envelope escaping, so 0x0004 is the dimmest
 * escape-free nonzero value.
 */
export const PIXEL_OFF_COLOR: Uint8Array = Uint8Array.of(0x00, 0x04);

/** Animation-path "off": a literal 0x0000 renders as genuine black on the Animation path only. */
export const ANIMATION_OFF_COLOR: Uint8Array = Uint8Array.of(0x00, 0x00);

export type ContentPath = "graffiti" | "animation";

export function offColorFor(path: ContentPath): Uint8Array {
  return path === "graffiti" ? PIXEL_OFF_COLOR : ANIMATION_OFF_COLOR;
}

/**
 * Off-color selection honoring session-resolved black semantics. The
 * conservative default (inherited 0x0004 workaround) applies until trusted
 * current-session evidence establishes this exact device's behavior:
 * true-black permits literal 0x0000; a directly observed white sentinel
 * keeps (or sets) its workaround word.
 */
export function offColorForBehavior(path: ContentPath, black: import("../../core/quirks").BlackSemantics | null | undefined): Uint8Array {
  if (path !== "graffiti" || !black) return offColorFor(path);
  if (black.state === "true-black") return Uint8Array.of(0x00, 0x00);
  if (black.state === "white-sentinel") return Uint8Array.of((black.workaroundWord >> 8) & 0xff, black.workaroundWord & 0xff);
  return offColorFor(path);
}

function isOff(pixel: Rgb): boolean {
  // A pixel every channel of which collapses to 0 through the transfer curve
  // is "off"; encoding it literally would hit the Graffiti white sentinel.
  return rgb444TransferChannel(pixel.r) === 0 && rgb444TransferChannel(pixel.g) === 0 && rgb444TransferChannel(pixel.b) === 0;
}

/**
 * Encode a logical RGB888 framebuffer region as the dense column-major
 * RGB444 pixel stream used by Graffiti/Animation segments: for x in
 * startColumn..startColumn+width, for y in 0..height, two bytes per pixel.
 */
export function encodeFrameRegion(frame: Framebuffer, startColumn: number, width: number, path: ContentPath, offOverride?: Uint8Array): Uint8Array {
  if (startColumn < 0 || startColumn + width > frame.width) throw new RangeError("Region is outside the framebuffer.");
  const off = offOverride ?? offColorFor(path);
  const out = new Uint8Array(width * frame.height * 2);
  let offset = 0;
  for (let x = startColumn; x < startColumn + width; x += 1) {
    for (let y = 0; y < frame.height; y += 1) {
      const pixel = frame.getPixel(x, y);
      const encoded = isOff(pixel) ? off : rgb444PixelColor(pixel.r, pixel.g, pixel.b);
      out[offset] = encoded[0] ?? 0;
      out[offset + 1] = encoded[1] ?? 0;
      offset += 2;
    }
  }
  return out;
}

export function encodeFrame(frame: Framebuffer, path: ContentPath): Uint8Array {
  return encodeFrameRegion(frame, 0, frame.width, path);
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}
