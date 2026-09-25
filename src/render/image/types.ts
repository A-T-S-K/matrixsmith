import type { Framebuffer } from "../framebuffer";

export type ImageMode = "auto" | "artwork" | "photo" | "pixel-art" | "legacy";
export type ResolvedImageMode = Exclude<ImageMode, "auto">;
export type CompositionMode =
  "contain" | "cover" | "foreground-trim" | "custom";

export interface DecodedImageSource {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  readonly transparentFraction: number;
}

export interface ImageAnalysis {
  readonly likelyMode: "artwork" | "photo" | "pixel-art";
  readonly confidence: "low" | "medium" | "high";
  readonly confidenceScore: number;
  readonly uniqueColorEstimate: number;
  readonly entropy: number;
  readonly edgeDensity: number;
  readonly gradientDensity: number;
  readonly transparency: number;
  readonly blockEvidence: number;
  readonly warnings: readonly string[];
}

export interface ImageComposition {
  readonly mode: CompositionMode;
  readonly crop?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly zoom?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  /** Explicit, previewed horizontal deformation. Never inferred silently. */
  readonly opticalScaleX?: number;
}

export interface ImageRecipe {
  readonly mode: ImageMode;
  readonly composition: ImageComposition;
  readonly edgeStrength?: number;
}

export interface DeviceColorModel {
  readonly id: string;
  readonly channelBits: 4;
  readonly trueBlack: boolean;
}

export interface ProcessedImage {
  readonly frame: Framebuffer;
  readonly analysis: ImageAnalysis;
  readonly resolvedMode: ResolvedImageMode;
  readonly resolvedComposition: ImageComposition;
  readonly outputColorCount: number;
  readonly warnings: readonly string[];
  readonly processingMetadata: Readonly<
    Record<string, string | number | boolean>
  >;
}

export const ILEDHAT_RGB444: DeviceColorModel = Object.freeze({
  id: "iledhat-rgb444",
  channelBits: 4,
  trueBlack: true,
});
