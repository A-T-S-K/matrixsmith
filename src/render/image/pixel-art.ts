import { Framebuffer } from "../framebuffer";
import { resolveComposition } from "./composition";
import type { DecodedImageSource, ImageComposition } from "./types";

export function reducePixelArt(source: DecodedImageSource, width: number, height: number, composition: ImageComposition): Framebuffer {
  const output = new Framebuffer(width, height);
  const t = resolveComposition(source, width, height, composition);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x + 0.5 < t.dx || y + 0.5 < t.dy || x + 0.5 >= t.dx + t.dw || y + 0.5 >= t.dy + t.dh) continue;
    const sx = Math.max(0, Math.min(source.width - 1, Math.floor(t.sx + (x + 0.5 - t.dx) / t.dw * t.sw)));
    const sy = Math.max(0, Math.min(source.height - 1, Math.floor(t.sy + (y + 0.5 - t.dy) / t.dh * t.sh)));
    const i = (sy * source.width + sx) * 4; const a = (source.rgba[i + 3] ?? 0) / 255;
    output.setPixel(x, y, (source.rgba[i] ?? 0) * a, (source.rgba[i + 1] ?? 0) * a, (source.rgba[i + 2] ?? 0) * a);
  }
  return output;
}
