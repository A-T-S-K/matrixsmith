import type { DecodedImageSource } from "./types";

export async function decodeImageSource(file: Blob): Promise<DecodedImageSource> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bitmap.width, bitmap.height) : createDomCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    context.clearRect(0, 0, bitmap.width, bitmap.height); context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let transparent = 0; for (let i = 3; i < rgba.length; i += 4) if ((rgba[i] ?? 255) < 255) transparent += 1;
    return { rgba, width: bitmap.width, height: bitmap.height, hasAlpha: transparent > 0, transparentFraction: transparent / Math.max(1, bitmap.width * bitmap.height) };
  } finally { bitmap.close(); }
}

function createDomCanvas(width: number, height: number): HTMLCanvasElement { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; }
