import { Framebuffer } from "../framebuffer";
import { resolveComposition } from "./composition";
import type { DecodedImageSource, ImageComposition } from "./types";

/** Linear-light area reducer with a conservative destination-scale lightness unsharp mask. */
export function reducePhoto(
  source: DecodedImageSource,
  width: number,
  height: number,
  composition: ImageComposition,
  edgeStrength = 0.12,
): Framebuffer {
  const transform = resolveComposition(source, width, height, composition);
  const linear = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const sx0 =
        transform.sx + ((x - transform.dx) / transform.dw) * transform.sw;
      const sy0 =
        transform.sy + ((y - transform.dy) / transform.dh) * transform.sh;
      const sx1 =
        transform.sx + ((x + 1 - transform.dx) / transform.dw) * transform.sw;
      const sy1 =
        transform.sy + ((y + 1 - transform.dy) / transform.dh) * transform.sh;
      if (
        sx1 <= transform.sx ||
        sy1 <= transform.sy ||
        sx0 >= transform.sx + transform.sw ||
        sy0 >= transform.sy + transform.sh
      )
        continue;
      const sample = areaSample(
        source,
        Math.max(transform.sx, sx0),
        Math.max(transform.sy, sy0),
        Math.min(transform.sx + transform.sw, sx1),
        Math.min(transform.sy + transform.sh, sy1),
      );
      linear.set(sample, (y * width + x) * 3);
    }
  const output = new Framebuffer(width, height);
  const strength = Math.max(0, Math.min(0.25, edgeStrength));
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const centerL = luminance(linear, i);
      let neighborL = 0;
      let n = 0;
      for (const [ox, oy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const)
        if (x + ox >= 0 && x + ox < width && y + oy >= 0 && y + oy < height) {
          neighborL += luminance(linear, ((y + oy) * width + x + ox) * 3);
          n += 1;
        }
      const gain = Math.max(
        -0.08,
        Math.min(0.08, (centerL - neighborL / Math.max(1, n)) * strength),
      );
      output.setPixel(
        x,
        y,
        linearToSrgb((linear[i] ?? 0) + gain),
        linearToSrgb((linear[i + 1] ?? 0) + gain),
        linearToSrgb((linear[i + 2] ?? 0) + gain),
      );
    }
  return output;
}

function areaSample(
  source: DecodedImageSource,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  const ix0 = Math.floor(x0);
  const iy0 = Math.floor(y0);
  const ix1 = Math.ceil(x1);
  const iy1 = Math.ceil(y1);
  for (let y = iy0; y < iy1; y += 1)
    for (let x = ix0; x < ix1; x += 1) {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
      const weight =
        Math.max(0, Math.min(x1, x + 1) - Math.max(x0, x)) *
        Math.max(0, Math.min(y1, y + 1) - Math.max(y0, y));
      const i = (y * source.width + x) * 4;
      const alpha = (source.rgba[i + 3] ?? 0) / 255;
      r += srgbToLinear((source.rgba[i] ?? 0) / 255) * alpha * weight;
      g += srgbToLinear((source.rgba[i + 1] ?? 0) / 255) * alpha * weight;
      b += srgbToLinear((source.rgba[i + 2] ?? 0) / 255) * alpha * weight;
      total += weight;
    }
  return total > 0 ? [r / total, g / total, b / total] : [0, 0, 0];
}

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return Math.round(
    255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055),
  );
}
function luminance(values: Float32Array, i: number): number {
  return (
    (values[i] ?? 0) * 0.2126 +
    (values[i + 1] ?? 0) * 0.7152 +
    (values[i + 2] ?? 0) * 0.0722
  );
}
