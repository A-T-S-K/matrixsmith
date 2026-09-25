import { Framebuffer } from "../framebuffer";
import type { DeviceColorModel } from "./types";

export function mapToDevice(
  frame: Framebuffer,
  model: DeviceColorModel,
): Framebuffer {
  const mapped = new Framebuffer(frame.width, frame.height);
  const levels = (1 << model.channelBits) - 1;
  for (let y = 0; y < frame.height; y += 1)
    for (let x = 0; x < frame.width; x += 1) {
      const pixel = frame.getPixel(x, y);
      if (model.trueBlack && pixel.r === 0 && pixel.g === 0 && pixel.b === 0)
        mapped.setPixel(x, y, 0, 0, 0);
      else
        mapped.setPixel(
          x,
          y,
          ...([pixel.r, pixel.g, pixel.b].map((value) =>
            Math.round((Math.round((value / 255) * levels) / levels) * 255),
          ) as [number, number, number]),
        );
    }
  return mapped;
}

export function countColors(frame: Framebuffer): number {
  const colors = new Set<number>();
  for (let i = 0; i < frame.data.length; i += 3)
    colors.add(
      ((frame.data[i] ?? 0) << 16) |
        ((frame.data[i + 1] ?? 0) << 8) |
        (frame.data[i + 2] ?? 0),
    );
  return colors.size;
}
