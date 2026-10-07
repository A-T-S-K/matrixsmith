import type { Geometry } from "./target";

export const GEOMETRY_LIMITS = { dimension: 512, pixels: 65_536 } as const;
export interface GeometryErrors {
  readonly width?: string;
  readonly height?: string;
  readonly budget?: string;
}
export function geometryErrors(width: number, height: number): GeometryErrors {
  const dimension = (value: number) =>
    !Number.isInteger(value) || value < 1 || value > GEOMETRY_LIMITS.dimension
      ? `Enter a whole number of pixels from 1 to ${GEOMETRY_LIMITS.dimension}.`
      : undefined;
  const w = dimension(width);
  const h = dimension(height);
  return {
    ...(w ? { width: w } : {}),
    ...(h ? { height: h } : {}),
    ...(!w && !h && width * height > GEOMETRY_LIMITS.pixels
      ? {
          budget: `Display geometry exceeds the ${GEOMETRY_LIMITS.pixels.toLocaleString("en-US")}-pixel budget (${width * height} pixels). Reduce width or height.`,
        }
      : {}),
  };
}
export function validateGeometry(width: number, height: number): Geometry {
  const errors = geometryErrors(width, height);
  if (Object.keys(errors).length)
    throw new Error(
      `Invalid display geometry. ${Object.values(errors).join(" ")}`,
    );
  return { width, height };
}
