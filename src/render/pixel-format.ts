import type { Framebuffer } from "./framebuffer";

/** Host preview only. No device color order or orientation is assumed. */
export function toRgba(frame: Framebuffer): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let source = 0, target = 0; source < frame.data.length; source += 3, target += 4) {
    rgba[target] = frame.data[source] ?? 0;
    rgba[target + 1] = frame.data[source + 1] ?? 0;
    rgba[target + 2] = frame.data[source + 2] ?? 0;
    rgba[target + 3] = 255;
  }
  return rgba;
}
