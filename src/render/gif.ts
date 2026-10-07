import { INPUT_LIMITS } from "../application/input-limits";
import { FrameSequence } from "./frame-sequence";
import {
  computeFitPlacement,
  readGifMetadata,
  rgbaToFramebuffer,
} from "./image";
import {
  RASTER_SCROLL_FRAME_BUDGET,
  RASTER_SCROLL_DECODED_TILE_BUDGET,
} from "./scroll";

export const GIF_SOURCE_PIXEL_BUDGET = INPUT_LIMITS.imagePixels;
export const GIF_FALLBACK_DELAY_MS = 100;
export type GifRepetition = number | "infinite" | "unknown";
export interface DecodedGif {
  readonly sequence: FrameSequence;
  readonly byteLength: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly frameCount: number;
  readonly totalDurationMs: number;
  readonly repetition: GifRepetition;
  readonly warnings: readonly string[];
}

// ImageDecoder is not yet present in the project's DOM declarations.
export interface GifDecoder {
  readonly complete: boolean;
  readonly completed: Promise<void>;
  readonly tracks: {
    readonly ready: Promise<void>;
    readonly selectedTrack: {
      readonly frameCount: number;
      readonly repetitionCount?: number;
    } | null;
  };
  decode(options: { frameIndex: number; completeFramesOnly: true }): Promise<{
    image: VideoFrame;
    complete: boolean;
  }>;
  close(): void;
}
export interface GifDecoderConstructor {
  new (options: {
    data: Uint8Array;
    type: "image/gif";
    preferAnimation: true;
  }): GifDecoder;
  isTypeSupported(type: string): Promise<boolean>;
}
export function gifDelayMs(duration: number | null | undefined): number {
  if (duration !== null && duration !== undefined && !Number.isFinite(duration))
    throw new Error("GIF frame duration is nonfinite.");
  if (duration === null || duration === undefined || duration <= 0)
    return GIF_FALLBACK_DELAY_MS;
  const delay = Math.max(1, Math.round(duration / 1000));
  if (delay > 65_535) throw new Error("GIF frame delay exceeds 65,535 ms.");
  return delay;
}
function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`GIF ${label} must be a positive safe integer.`);
}
export function preflightGif(
  sourceWidth: number,
  sourceHeight: number,
  frameCount: number,
  targetWidth: number,
  targetHeight: number,
): void {
  positive(sourceWidth, "source width");
  positive(sourceHeight, "source height");
  positive(frameCount, "frame count");
  positive(targetWidth, "target width");
  positive(targetHeight, "target height");
  if (frameCount > RASTER_SCROLL_FRAME_BUDGET)
    throw new Error(
      `GIF frame count exceeds the ${RASTER_SCROLL_FRAME_BUDGET}-frame budget.`,
    );
  if (sourceWidth > GIF_SOURCE_PIXEL_BUDGET / sourceHeight / frameCount)
    throw new Error("GIF source work exceeds the 24,000,000-pixel budget.");
  if (
    frameCount >
    RASTER_SCROLL_DECODED_TILE_BUDGET /
      Math.min(8, targetWidth) /
      targetHeight /
      2
  )
    throw new Error("GIF tile program size exceeds the 16 KiB decoded budget.");
}

/** Sequential browser compositing into device-sized frames; no native GIF fallback. */
export async function decodeGif(
  file: Blob,
  targetWidth: number,
  targetHeight: number,
  options: {
    readonly decoder?: GifDecoderConstructor;
    readonly signal?: AbortSignal;
    readonly isCurrent?: () => boolean;
  } = {},
): Promise<DecodedGif> {
  const check = (): void => {
    if (options.signal?.aborted || options.isCurrent?.() === false)
      throw new DOMException("GIF selection is obsolete.", "AbortError");
  };
  check();
  if (
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    file.size > INPUT_LIMITS.gifBytes
  )
    throw new Error("GIF file size exceeds the 8 MiB input budget.");
  const header = readGifMetadata(
    new Uint8Array(await file.slice(0, 10).arrayBuffer()),
  );
  check();
  if (!header.isGif || header.width === null || header.height === null)
    throw new Error(
      "That file is not a valid GIF (missing GIF87a/GIF89a header).",
    );
  preflightGif(header.width, header.height, 1, targetWidth, targetHeight);
  const Decoder =
    options.decoder ??
    (globalThis as typeof globalThis & { ImageDecoder?: GifDecoderConstructor })
      .ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported("image/gif")))
    throw new Error(
      "Local GIF decoding is unavailable. Use a current Chrome or Android Chrome browser, or choose an image/text instead.",
    );
  check();
  const data = new Uint8Array(await file.arrayBuffer());
  check();
  const decoder = new Decoder({
    data,
    type: "image/gif",
    preferAnimation: true,
  });
  // Both promises can fail independently, including on close. Attach handlers
  // immediately, before waiting on either one or installing abort cleanup.
  const metadataReady = Promise.all([decoder.tracks.ready, decoder.completed]);
  let closed = false;
  const close = (): void => {
    if (!closed) {
      closed = true;
      decoder.close();
    }
  };
  options.signal?.addEventListener("abort", close, { once: true });
  try {
    await metadataReady;
    check();
    const track = decoder.tracks.selectedTrack;
    if (!decoder.complete || !track)
      throw new Error("GIF complete track metadata is unavailable.");
    const frameCount = track.frameCount;
    preflightGif(
      header.width,
      header.height,
      frameCount,
      targetWidth,
      targetHeight,
    );
    const repetition: GifRepetition =
      track.repetitionCount === Infinity
        ? "infinite"
        : Number.isSafeInteger(track.repetitionCount) &&
            track.repetitionCount! >= 0
          ? track.repetitionCount!
          : "unknown";
    const warnings =
      typeof repetition === "number"
        ? [
            "The display loops this animation; its finite source repetition cannot be preserved.",
          ]
        : [];
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    const frames = [];
    const timing = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      check();
      const result = await decoder.decode({
        frameIndex,
        completeFramesOnly: true,
      });
      const frame = result.image;
      try {
        check();
        if (
          !result.complete ||
          frame.displayWidth !== header.width ||
          frame.displayHeight !== header.height
        )
          throw new Error(
            "GIF decoded dimensions or completeness disagree with approved metadata.",
          );
        const milliseconds = gifDelayMs(frame.duration);
        const p = computeFitPlacement(
          frame.displayWidth,
          frame.displayHeight,
          targetWidth,
          targetHeight,
          "contain",
        );
        context.clearRect(0, 0, targetWidth, targetHeight);
        context.drawImage(
          frame,
          p.sx,
          p.sy,
          p.sw,
          p.sh,
          p.dx,
          p.dy,
          p.dw,
          p.dh,
        );
        frames.push(
          rgbaToFramebuffer(
            context.getImageData(0, 0, targetWidth, targetHeight).data,
            targetWidth,
            targetHeight,
          ),
        );
        timing.push({ milliseconds });
      } finally {
        frame.close();
      }
    }
    check();
    return {
      sequence: new FrameSequence(frames, timing),
      byteLength: file.size,
      sourceWidth: header.width,
      sourceHeight: header.height,
      targetWidth,
      targetHeight,
      frameCount,
      totalDurationMs: timing.reduce(
        (sum, entry) => sum + entry.milliseconds,
        0,
      ),
      repetition,
      warnings,
    };
  } finally {
    options.signal?.removeEventListener("abort", close);
    close();
  }
}
