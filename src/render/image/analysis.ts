import type { DecodedImageSource, ImageAnalysis } from "./types";

/** Conservative deterministic signals. Low confidence intentionally routes to Photo-safe. */
export function analyzeImage(source: DecodedImageSource): ImageAnalysis {
  const stride = Math.max(1, Math.floor(Math.sqrt((source.width * source.height) / 4096)));
  const colors = new Set<number>();
  const histogram = new Map<number, number>();
  let samples = 0; let edges = 0; let gradients = 0; let repeated2x2 = 0; let blocks = 0;
  for (let y = 0; y < source.height; y += stride) for (let x = 0; x < source.width; x += stride) {
    const i = (y * source.width + x) * 4;
    const r = source.rgba[i] ?? 0; const g = source.rgba[i + 1] ?? 0; const b = source.rgba[i + 2] ?? 0;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    colors.add(key); histogram.set(key, (histogram.get(key) ?? 0) + 1); samples += 1;
    if (x + stride < source.width) {
      const j = (y * source.width + x + stride) * 4;
      const d = Math.abs(r - (source.rgba[j] ?? 0)) + Math.abs(g - (source.rgba[j + 1] ?? 0)) + Math.abs(b - (source.rgba[j + 2] ?? 0));
      if (d > 96) edges += 1;
      if (d > 12 && d < 96) gradients += 1;
    }
    if (x + 1 < source.width && y + 1 < source.height) {
      blocks += 1;
      const same = pixelEqual(source, x, y, x + 1, y) && pixelEqual(source, x, y, x, y + 1) && pixelEqual(source, x, y, x + 1, y + 1);
      if (same) repeated2x2 += 1;
    }
  }
  let entropy = 0;
  for (const count of histogram.values()) { const p = count / Math.max(1, samples); entropy -= p * Math.log2(p); }
  const edgeDensity = edges / Math.max(1, samples);
  const gradientDensity = gradients / Math.max(1, samples);
  const blockEvidence = repeated2x2 / Math.max(1, blocks);
  const colorRatio = colors.size / Math.max(1, samples);
  let likelyMode: ImageAnalysis["likelyMode"] = "photo"; let score = 0.65;
  if (source.width <= 128 && source.height <= 128 && blockEvidence > 0.7 && colors.size <= 64) { likelyMode = "pixel-art"; score = Math.min(0.98, 0.55 + blockEvidence * 0.45); }
  else if (colors.size <= 48 && entropy < 4.5 && edgeDensity > gradientDensity * 0.7) { likelyMode = "artwork"; score = Math.min(0.95, 0.58 + (1 - colorRatio) * 0.25 + edgeDensity * 0.5); }
  else if (colors.size > 96 && entropy > 5 && gradientDensity > 0.08) { likelyMode = "photo"; score = Math.min(0.94, 0.62 + gradientDensity * 0.5); }
  else score = 0.48;
  const confidence = score >= 0.78 ? "high" : score >= 0.6 ? "medium" : "low";
  return { likelyMode, confidence, confidenceScore: score, uniqueColorEstimate: colors.size, entropy, edgeDensity, gradientDensity, transparency: source.transparentFraction, blockEvidence, warnings: confidence === "low" ? ["Content type is uncertain; Auto will use Photo-safe processing."] : [] };
}

function pixelEqual(source: DecodedImageSource, ax: number, ay: number, bx: number, by: number): boolean {
  const a = (ay * source.width + ax) * 4; const b = (by * source.width + bx) * 4;
  return source.rgba[a] === source.rgba[b] && source.rgba[a + 1] === source.rgba[b + 1] && source.rgba[a + 2] === source.rgba[b + 2] && source.rgba[a + 3] === source.rgba[b + 3];
}
