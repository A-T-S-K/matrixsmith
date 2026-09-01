import { Framebuffer } from "../framebuffer";
import { resolveComposition } from "./composition";
import type { DecodedImageSource, ImageComposition } from "./types";

interface PaletteColor { r: number; g: number; b: number; lab: [number, number, number]; count: number; chroma: number }

/**
 * Deterministic semantic-region reducer. A chromatic accent is reserved before
 * frequency selection, assignment uses OKLab, and destination pixels choose a
 * hard semantic color by supersampled region coverage. The bounded phase
 * search maximizes represented regions and penalizes speckles/symmetry drift.
 */
export function reduceArtwork(source: DecodedImageSource, width: number, height: number, composition: ImageComposition): { frame: Framebuffer; paletteSize: number; phase: number } {
  const palette = semanticPalette(source, 6);
  const transform = resolveComposition(source, width, height, composition);
  const phases = [-0.25, 0, 0.25];
  let best: { frame: Framebuffer; score: number; phase: number } | null = null;
  for (const phase of phases) {
    const frame = new Framebuffer(width, height); const counts = new Array(palette.length).fill(0) as number[];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const votes = new Array(palette.length).fill(0) as number[];
      for (const oy of [0.2, 0.5, 0.8]) for (const ox of [0.2, 0.5, 0.8]) {
        const px = x + ox + phase; const py = y + oy;
        if (px < transform.dx || py < transform.dy || px >= transform.dx + transform.dw || py >= transform.dy + transform.dh) { votes[0] = (votes[0] ?? 0) + 1; continue; }
        const sx = Math.max(0, Math.min(source.width - 1, Math.floor(transform.sx + (px - transform.dx) / transform.dw * transform.sw)));
        const sy = Math.max(0, Math.min(source.height - 1, Math.floor(transform.sy + (py - transform.dy) / transform.dh * transform.sh)));
        votes[nearestPalette(source, sx, sy, palette)]! += 1;
      }
      const winner = votes.reduce((bestIndex, vote, index) => vote > (votes[bestIndex] ?? -1) ? index : bestIndex, 0);
      const color = palette[winner]!; frame.setPixel(x, y, color.r, color.g, color.b); counts[winner]! += 1;
    }
    const represented = counts.filter((count) => count > 0).length;
    const speckles = isolatedPixels(frame);
    const symmetryDrift = horizontalSymmetryDrift(frame);
    const score = represented * 100 - speckles * 2 - symmetryDrift;
    if (!best || score > best.score) best = { frame, score, phase };
  }
  return { frame: best!.frame, paletteSize: palette.length, phase: best!.phase };
}

function semanticPalette(source: DecodedImageSource, maximum: number): PaletteColor[] {
  const bins = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (let i = 0; i < source.rgba.length; i += 4) {
    const a = (source.rgba[i + 3] ?? 0) / 255; const r = Math.round((source.rgba[i] ?? 0) * a); const g = Math.round((source.rgba[i + 1] ?? 0) * a); const b = Math.round((source.rgba[i + 2] ?? 0) * a);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bin.r += r; bin.g += g; bin.b += b; bin.count += 1; bins.set(key, bin);
  }
  const candidates = [...bins.values()].map((bin) => { const r = bin.r / bin.count; const g = bin.g / bin.count; const b = bin.b / bin.count; const lab = rgbToOklab(r, g, b); return { r, g, b, lab, count: bin.count, chroma: Math.hypot(lab[1], lab[2]) }; });
  candidates.sort((a, b) => b.count - a.count);
  const chosen: PaletteColor[] = [];
  const black = candidates.reduce((best, item) => item.lab[0] < best.lab[0] ? item : best, candidates[0]!); chosen.push({ ...black, r: 0, g: 0, b: 0, lab: rgbToOklab(0, 0, 0) });
  const accent = candidates.filter((item) => item.chroma > 0.08).sort((a, b) => b.chroma * Math.sqrt(b.count) - a.chroma * Math.sqrt(a.count))[0];
  if (accent) chosen.push(accent);
  for (const item of candidates) {
    if (chosen.length >= maximum) break;
    if (chosen.every((color) => labDistance(color.lab, item.lab) > 0.055)) chosen.push(item);
  }
  return chosen.map((item) => ({ ...item, r: Math.round(item.r), g: Math.round(item.g), b: Math.round(item.b) }));
}

function nearestPalette(source: DecodedImageSource, x: number, y: number, palette: readonly PaletteColor[]): number {
  const i = (y * source.width + x) * 4; const a = (source.rgba[i + 3] ?? 0) / 255;
  const lab = rgbToOklab((source.rgba[i] ?? 0) * a, (source.rgba[i + 1] ?? 0) * a, (source.rgba[i + 2] ?? 0) * a);
  let best = 0; let distance = Infinity; palette.forEach((color, index) => { const d = labDistance(lab, color.lab); if (d < distance) { distance = d; best = index; } }); return best;
}

export function rgbToOklab(r8: number, g8: number, b8: number): [number, number, number] {
  const linear = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = linear(r8); const g = linear(g8); const b = linear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b); const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b); const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labDistance(a: readonly number[], b: readonly number[]): number { return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)); }
function isolatedPixels(frame: Framebuffer): number { let count = 0; for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) { const p = frame.getPixel(x, y); let matches = 0; for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) if (x + ox >= 0 && x + ox < frame.width && y + oy >= 0 && y + oy < frame.height) { const q = frame.getPixel(x + ox, y + oy); if (p.r === q.r && p.g === q.g && p.b === q.b) matches += 1; } if (matches === 0) count += 1; } return count; }
function horizontalSymmetryDrift(frame: Framebuffer): number { let mismatch = 0; for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < Math.floor(frame.width / 2); x += 1) { const a = frame.getPixel(x, y); const b = frame.getPixel(frame.width - 1 - x, y); mismatch += Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b); } return mismatch / 255 / Math.max(1, frame.height); }
