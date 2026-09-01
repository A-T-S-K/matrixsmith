import { analyzeImage } from "./analysis";
import { reduceArtwork } from "./artwork";
import { countColors, mapToDevice } from "./device-map";
import { reducePhoto } from "./photo";
import { reducePixelArt } from "./pixel-art";
import type { DecodedImageSource, DeviceColorModel, ImageRecipe, ProcessedImage, ResolvedImageMode } from "./types";

export function processImage(source: DecodedImageSource, width: number, height: number, recipe: ImageRecipe, model: DeviceColorModel): ProcessedImage {
  const started = performance.now();
  const analysis = analyzeImage(source);
  const resolvedMode: ResolvedImageMode = recipe.mode === "auto"
    ? analysis.confidence === "high" && analysis.likelyMode !== "photo" ? analysis.likelyMode : "photo"
    : recipe.mode;
  const warnings = [...analysis.warnings];
  let intermediate; let detail: Record<string, string | number | boolean> = {};
  try {
    if (resolvedMode === "artwork") {
      const result = reduceArtwork(source, width, height, recipe.composition);
      intermediate = result.frame; detail = { semanticPaletteSize: result.paletteSize, signedDistanceFields: true, selectedGridPhase: result.phase, hardSemanticColors: true };
    } else if (resolvedMode === "pixel-art") intermediate = reducePixelArt(source, width, height, recipe.composition);
    else intermediate = reducePhoto(source, width, height, recipe.composition, recipe.edgeStrength);
  } catch (error) {
    intermediate = reducePhoto(source, width, height, recipe.composition, 0);
    warnings.push(`Advanced processing failed; Photo-safe fallback used (${error instanceof Error ? error.message : String(error)}).`);
  }
  const frame = mapToDevice(intermediate, model);
  return {
    frame, analysis, resolvedMode, resolvedComposition: recipe.composition, outputColorCount: countColors(frame), warnings,
    processingMetadata: { reducer: resolvedMode, deviceColorModel: model.id, dithering: false, processingMs: Math.round((performance.now() - started) * 10) / 10, ...detail },
  };
}
