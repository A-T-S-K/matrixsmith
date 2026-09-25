import type { DecodedImageSource, ImageComposition } from "./types";

export interface SourceTransform {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

export function resolveComposition(
  source: DecodedImageSource,
  targetWidth: number,
  targetHeight: number,
  composition: ImageComposition,
): SourceTransform {
  const opticalScaleX = clamp(composition.opticalScaleX ?? 1, 1, 1.35);
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;
  if (composition.mode === "custom" && composition.crop) {
    sx = clamp(Math.round(composition.crop.x), 0, source.width - 1);
    sy = clamp(Math.round(composition.crop.y), 0, source.height - 1);
    sw = clamp(Math.round(composition.crop.width), 1, source.width - sx);
    sh = clamp(Math.round(composition.crop.height), 1, source.height - sy);
  } else if (composition.mode === "foreground-trim") {
    const bounds = foregroundBounds(source);
    if (bounds) ({ x: sx, y: sy, width: sw, height: sh } = bounds);
  }
  const effectiveWidth = sw * opticalScaleX;
  const cover = composition.mode === "cover";
  const scale =
    (cover ? Math.max : Math.min)(
      targetWidth / effectiveWidth,
      targetHeight / sh,
    ) * clamp(composition.zoom ?? 1, 0.25, 4);
  const dw = Math.max(1, effectiveWidth * scale);
  const dh = Math.max(1, sh * scale);
  return {
    sx,
    sy,
    sw,
    sh,
    dx: (targetWidth - dw) / 2 + (composition.offsetX ?? 0),
    dy: (targetHeight - dh) / 2 + (composition.offsetY ?? 0),
    dw,
    dh,
  };
}

function foregroundBounds(
  source: DecodedImageSource,
): { x: number; y: number; width: number; height: number } | null {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  const corner = [
    source.rgba[0] ?? 0,
    source.rgba[1] ?? 0,
    source.rgba[2] ?? 0,
  ];
  for (let y = 0; y < source.height; y += 1)
    for (let x = 0; x < source.width; x += 1) {
      const i = (y * source.width + x) * 4;
      const alpha = source.rgba[i + 3] ?? 0;
      const distance =
        Math.abs((source.rgba[i] ?? 0) - corner[0]!) +
        Math.abs((source.rgba[i + 1] ?? 0) - corner[1]!) +
        Math.abs((source.rgba[i + 2] ?? 0) - corner[2]!);
      if (alpha > 16 && (source.hasAlpha ? alpha > 48 : distance > 24)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  return maxX < minX
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
