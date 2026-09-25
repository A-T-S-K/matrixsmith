import { Framebuffer } from "./framebuffer";
export { analyzeImage } from "./image/analysis";
export { processImage } from "./image/process";
export { decodeImageSource } from "./image/decode";
export type {
  CompositionMode,
  DecodedImageSource,
  DeviceColorModel,
  ImageAnalysis,
  ImageComposition,
  ImageMode,
  ImageRecipe,
  ProcessedImage,
  ResolvedImageMode,
} from "./image/types";
export { ILEDHAT_RGB444 } from "./image/types";

/**
 * Browser-side image import: decode with the browser's native codecs (PNG,
 * JPEG, WebP, …), scale into the logical framebuffer with an explicit fit
 * mode, and never touch a server. The geometry math is pure and unit-tested;
 * only the decode step needs browser APIs.
 */
export type FitMode = "contain" | "cover" | "stretch" | "center";

export interface FitPlacement {
  /** Source rectangle to sample (in source pixels). */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** Destination rectangle to paint (in framebuffer pixels). */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

export function computeFitPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: FitMode,
): FitPlacement {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  )
    throw new RangeError("Dimensions must be positive.");
  switch (mode) {
    case "stretch":
      return {
        sx: 0,
        sy: 0,
        sw: sourceWidth,
        sh: sourceHeight,
        dx: 0,
        dy: 0,
        dw: targetWidth,
        dh: targetHeight,
      };
    case "contain": {
      const scale = Math.min(
        targetWidth / sourceWidth,
        targetHeight / sourceHeight,
      );
      const dw = Math.max(1, Math.round(sourceWidth * scale));
      const dh = Math.max(1, Math.round(sourceHeight * scale));
      return {
        sx: 0,
        sy: 0,
        sw: sourceWidth,
        sh: sourceHeight,
        dx: Math.floor((targetWidth - dw) / 2),
        dy: Math.floor((targetHeight - dh) / 2),
        dw,
        dh,
      };
    }
    case "cover": {
      const scale = Math.max(
        targetWidth / sourceWidth,
        targetHeight / sourceHeight,
      );
      const sw = Math.min(sourceWidth, Math.round(targetWidth / scale));
      const sh = Math.min(sourceHeight, Math.round(targetHeight / scale));
      return {
        sx: Math.floor((sourceWidth - sw) / 2),
        sy: Math.floor((sourceHeight - sh) / 2),
        sw,
        sh,
        dx: 0,
        dy: 0,
        dw: targetWidth,
        dh: targetHeight,
      };
    }
    case "center": {
      // 1:1 pixels, centered; larger sources crop symmetrically.
      const sw = Math.min(sourceWidth, targetWidth);
      const sh = Math.min(sourceHeight, targetHeight);
      return {
        sx: Math.floor((sourceWidth - sw) / 2),
        sy: Math.floor((sourceHeight - sh) / 2),
        sw,
        sh,
        dx: Math.floor((targetWidth - sw) / 2),
        dy: Math.floor((targetHeight - sh) / 2),
        dw: sw,
        dh: sh,
      };
    }
  }
}

/** Copy decoded RGBA pixel data into a logical framebuffer (alpha composited over black). */
export function rgbaToFramebuffer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Framebuffer {
  if (rgba.length !== width * height * 4)
    throw new RangeError("RGBA buffer does not match the given dimensions.");
  const frame = new Framebuffer(width, height);
  for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
    const alpha = (rgba[index + 3] ?? 0) / 255;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    frame.setPixel(
      x,
      y,
      Math.round((rgba[index] ?? 0) * alpha),
      Math.round((rgba[index + 1] ?? 0) * alpha),
      Math.round((rgba[index + 2] ?? 0) * alpha),
    );
  }
  return frame;
}

export interface DecodedImage {
  readonly frame: Framebuffer;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly fitMode: FitMode;
}

/**
 * Decode a local image file into the target framebuffer size, entirely in
 * the browser. Uses createImageBitmap + a canvas 2D context; smoothing stays
 * on so downscales average pixels rather than aliasing.
 */
export async function decodeImageFile(
  file: Blob,
  targetWidth: number,
  targetHeight: number,
  mode: FitMode,
): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const placement = computeFitPlacement(
      bitmap.width,
      bitmap.height,
      targetWidth,
      targetHeight,
      mode,
    );
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(targetWidth, targetHeight)
        : createDomCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d") as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(
      bitmap,
      placement.sx,
      placement.sy,
      placement.sw,
      placement.sh,
      placement.dx,
      placement.dy,
      placement.dw,
      placement.dh,
    );
    const rgba = context.getImageData(0, 0, targetWidth, targetHeight).data;
    return {
      frame: rgbaToFramebuffer(rgba, targetWidth, targetHeight),
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      fitMode: mode,
    };
  } finally {
    bitmap.close();
  }
}

export interface GifMetadata {
  readonly byteLength: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly isGif: boolean;
}

/** Read GIF header metadata locally; the logical screen descriptor carries canvas dimensions. */
export function readGifMetadata(bytes: Uint8Array): GifMetadata {
  const isGif =
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x39 || bytes[4] === 0x37) &&
    bytes[5] === 0x61;
  if (!isGif)
    return {
      byteLength: bytes.length,
      width: null,
      height: null,
      isGif: false,
    };
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  return { byteLength: bytes.length, width, height, isGif: true };
}

function createDomCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
