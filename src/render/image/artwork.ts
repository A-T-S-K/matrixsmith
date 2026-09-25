import { Framebuffer } from "../framebuffer";
import { resolveComposition } from "./composition";
import type { DecodedImageSource, ImageComposition } from "./types";

interface PaletteColor {
  r: number;
  g: number;
  b: number;
  lab: [number, number, number];
  count: number;
  chroma: number;
}
interface SemanticFields {
  readonly width: number;
  readonly height: number;
  readonly labels: Uint8Array;
  readonly signed: readonly Float32Array[];
}

/**
 * Deterministic semantic-region reducer. A chromatic accent is reserved before
 * frequency selection, assignment uses OKLab, and destination pixels choose a
 * hard semantic color by supersampled region coverage. The bounded phase
 * search maximizes represented regions and penalizes speckles/symmetry drift.
 */
export function reduceArtwork(
  source: DecodedImageSource,
  width: number,
  height: number,
  composition: ImageComposition,
): { frame: Framebuffer; paletteSize: number; phase: number } {
  const palette = semanticPalette(source, 6);
  const fields = buildSemanticFields(source, palette);
  const transform = resolveComposition(source, width, height, composition);
  const phases = [-0.25, 0, 0.25];
  let best: { frame: Framebuffer; score: number; phase: number } | null = null;
  for (const phase of phases) {
    const frame = new Framebuffer(width, height);
    const counts = new Array(palette.length).fill(0) as number[];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const votes = new Array(palette.length).fill(0) as number[];
        for (const oy of [0.2, 0.5, 0.8])
          for (const ox of [0.2, 0.5, 0.8]) {
            const px = x + ox + phase;
            const py = y + oy;
            if (
              px < transform.dx ||
              py < transform.dy ||
              px >= transform.dx + transform.dw ||
              py >= transform.dy + transform.dh
            ) {
              votes[0] = (votes[0] ?? 0) + 1;
              continue;
            }
            const sx = Math.max(
              0,
              Math.min(
                source.width - 1,
                Math.floor(
                  transform.sx +
                    ((px - transform.dx) / transform.dw) * transform.sw,
                ),
              ),
            );
            const sy = Math.max(
              0,
              Math.min(
                source.height - 1,
                Math.floor(
                  transform.sy +
                    ((py - transform.dy) / transform.dh) * transform.sh,
                ),
              ),
            );
            votes[fieldLabel(fields, sx / source.width, sy / source.height)]! +=
              1;
          }
        const centerSx =
          transform.sx +
          ((x + 0.5 + phase - transform.dx) / transform.dw) * transform.sw;
        const centerSy =
          transform.sy +
          ((y + 0.5 - transform.dy) / transform.dh) * transform.sh;
        const fieldIndex = fieldOffset(
          fields,
          centerSx / source.width,
          centerSy / source.height,
        );
        const winner = votes.reduce((bestIndex, vote, index) => {
          const score =
            vote * 2 +
            Math.max(
              -2,
              Math.min(2, (fields.signed[index]?.[fieldIndex] ?? -99) / 2),
            );
          const bestScore =
            (votes[bestIndex] ?? 0) * 2 +
            Math.max(
              -2,
              Math.min(2, (fields.signed[bestIndex]?.[fieldIndex] ?? -99) / 2),
            );
          return score > bestScore ? index : bestIndex;
        }, 0);
        const color = palette[winner]!;
        frame.setPixel(x, y, color.r, color.g, color.b);
        counts[winner]! += 1;
      }
    const represented = counts.filter((count) => count > 0).length;
    const speckles = isolatedPixels(frame);
    const symmetryDrift = horizontalSymmetryDrift(frame);
    const fragmentation = fragmentationPenalty(frame, palette);
    const score =
      represented * 100 - speckles * 2 - symmetryDrift - fragmentation * 5;
    if (!best || score > best.score) best = { frame, score, phase };
  }
  return {
    frame: best!.frame,
    paletteSize: palette.length,
    phase: best!.phase,
  };
}

/** Bounded semantic masks plus signed chamfer distance for continuous boundary evidence. */
function buildSemanticFields(
  source: DecodedImageSource,
  palette: readonly PaletteColor[],
): SemanticFields {
  const scale = Math.min(1, 256 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const labels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      labels[y * width + x] = nearestPalette(
        source,
        Math.min(
          source.width - 1,
          Math.floor(((x + 0.5) / width) * source.width),
        ),
        Math.min(
          source.height - 1,
          Math.floor(((y + 0.5) / height) * source.height),
        ),
        palette,
      );
  const signed = palette.map((_, label) => {
    const toRegion = chamferDistance(
      labels,
      width,
      height,
      (value) => value === label,
    );
    const toOther = chamferDistance(
      labels,
      width,
      height,
      (value) => value !== label,
    );
    const field = new Float32Array(labels.length);
    for (let i = 0; i < field.length; i += 1)
      field[i] = labels[i] === label ? (toOther[i] ?? 0) : -(toRegion[i] ?? 0);
    return field;
  });
  return { width, height, labels, signed };
}

function chamferDistance(
  labels: Uint8Array,
  width: number,
  height: number,
  target: (label: number) => boolean,
): Float32Array {
  const distance = new Float32Array(labels.length);
  const far = width + height;
  for (let i = 0; i < distance.length; i += 1)
    distance[i] = target(labels[i] ?? 0) ? 0 : far;
  const root2 = Math.SQRT2;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let d = distance[i] ?? far;
      if (x > 0) d = Math.min(d, (distance[i - 1] ?? far) + 1);
      if (y > 0) d = Math.min(d, (distance[i - width] ?? far) + 1);
      if (x > 0 && y > 0)
        d = Math.min(d, (distance[i - width - 1] ?? far) + root2);
      if (x + 1 < width && y > 0)
        d = Math.min(d, (distance[i - width + 1] ?? far) + root2);
      distance[i] = d;
    }
  for (let y = height - 1; y >= 0; y -= 1)
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      let d = distance[i] ?? far;
      if (x + 1 < width) d = Math.min(d, (distance[i + 1] ?? far) + 1);
      if (y + 1 < height) d = Math.min(d, (distance[i + width] ?? far) + 1);
      if (x + 1 < width && y + 1 < height)
        d = Math.min(d, (distance[i + width + 1] ?? far) + root2);
      if (x > 0 && y + 1 < height)
        d = Math.min(d, (distance[i + width - 1] ?? far) + root2);
      distance[i] = d;
    }
  return distance;
}

function fieldOffset(
  fields: SemanticFields,
  normalizedX: number,
  normalizedY: number,
): number {
  const x = Math.max(
    0,
    Math.min(fields.width - 1, Math.floor(normalizedX * fields.width)),
  );
  const y = Math.max(
    0,
    Math.min(fields.height - 1, Math.floor(normalizedY * fields.height)),
  );
  return y * fields.width + x;
}
function fieldLabel(
  fields: SemanticFields,
  normalizedX: number,
  normalizedY: number,
): number {
  return fields.labels[fieldOffset(fields, normalizedX, normalizedY)] ?? 0;
}

function semanticPalette(
  source: DecodedImageSource,
  maximum: number,
): PaletteColor[] {
  const bins = new Map<
    number,
    { r: number; g: number; b: number; count: number }
  >();
  for (let i = 0; i < source.rgba.length; i += 4) {
    const a = (source.rgba[i + 3] ?? 0) / 255;
    const r = Math.round((source.rgba[i] ?? 0) * a);
    const g = Math.round((source.rgba[i + 1] ?? 0) * a);
    const b = Math.round((source.rgba[i + 2] ?? 0) * a);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.count += 1;
    bins.set(key, bin);
  }
  const candidates = [...bins.values()].map((bin) => {
    const r = bin.r / bin.count;
    const g = bin.g / bin.count;
    const b = bin.b / bin.count;
    const lab = rgbToOklab(r, g, b);
    return {
      r,
      g,
      b,
      lab,
      count: bin.count,
      chroma: Math.hypot(lab[1], lab[2]),
    };
  });
  candidates.sort((a, b) => b.count - a.count);
  const chosen: PaletteColor[] = [];
  const black = candidates.reduce(
    (best, item) => (item.lab[0] < best.lab[0] ? item : best),
    candidates[0]!,
  );
  chosen.push({ ...black, r: 0, g: 0, b: 0, lab: rgbToOklab(0, 0, 0) });
  const accent = candidates
    .filter((item) => item.chroma > 0.08)
    .sort(
      (a, b) => b.chroma * Math.sqrt(b.count) - a.chroma * Math.sqrt(a.count),
    )[0];
  if (accent) chosen.push(accent);
  for (const item of candidates) {
    if (chosen.length >= maximum) break;
    if (chosen.every((color) => labDistance(color.lab, item.lab) > 0.055))
      chosen.push(item);
  }
  return chosen.map((item) => ({
    ...item,
    r: Math.round(item.r),
    g: Math.round(item.g),
    b: Math.round(item.b),
  }));
}

function nearestPalette(
  source: DecodedImageSource,
  x: number,
  y: number,
  palette: readonly PaletteColor[],
): number {
  const i = (y * source.width + x) * 4;
  const a = (source.rgba[i + 3] ?? 0) / 255;
  const lab = rgbToOklab(
    (source.rgba[i] ?? 0) * a,
    (source.rgba[i + 1] ?? 0) * a,
    (source.rgba[i + 2] ?? 0) * a,
  );
  let best = 0;
  let distance = Infinity;
  palette.forEach((color, index) => {
    const d = labDistance(lab, color.lab);
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

export function rgbToOklab(
  r8: number,
  g8: number,
  b8: number,
): [number, number, number] {
  const linear = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(r8);
  const g = linear(g8);
  const b = linear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function labDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}
function isolatedPixels(frame: Framebuffer): number {
  let count = 0;
  for (let y = 0; y < frame.height; y += 1)
    for (let x = 0; x < frame.width; x += 1) {
      const p = frame.getPixel(x, y);
      let matches = 0;
      for (const [ox, oy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const)
        if (
          x + ox >= 0 &&
          x + ox < frame.width &&
          y + oy >= 0 &&
          y + oy < frame.height
        ) {
          const q = frame.getPixel(x + ox, y + oy);
          if (p.r === q.r && p.g === q.g && p.b === q.b) matches += 1;
        }
      if (matches === 0) count += 1;
    }
  return count;
}
function fragmentationPenalty(
  frame: Framebuffer,
  palette: readonly PaletteColor[],
): number {
  let penalty = 0;
  for (let label = 1; label < palette.length; label += 1) {
    const color = palette[label]!;
    const seen = new Uint8Array(frame.width * frame.height);
    let components = 0;
    for (let y = 0; y < frame.height; y += 1)
      for (let x = 0; x < frame.width; x += 1) {
        const start = y * frame.width + x;
        if (seen[start]) continue;
        const pixel = frame.getPixel(x, y);
        if (
          pixel.r !== Math.round(color.r) ||
          pixel.g !== Math.round(color.g) ||
          pixel.b !== Math.round(color.b)
        )
          continue;
        components += 1;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const at = stack.pop()!;
          const ax = at % frame.width;
          const ay = Math.floor(at / frame.width);
          for (const [ox, oy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            const nx = ax + ox;
            const ny = ay + oy;
            if (nx < 0 || ny < 0 || nx >= frame.width || ny >= frame.height)
              continue;
            const ni = ny * frame.width + nx;
            if (seen[ni]) continue;
            const next = frame.getPixel(nx, ny);
            if (
              next.r === Math.round(color.r) &&
              next.g === Math.round(color.g) &&
              next.b === Math.round(color.b)
            ) {
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }
    penalty += Math.max(0, components - 1);
  }
  return penalty;
}
function horizontalSymmetryDrift(frame: Framebuffer): number {
  let mismatch = 0;
  for (let y = 0; y < frame.height; y += 1)
    for (let x = 0; x < Math.floor(frame.width / 2); x += 1) {
      const a = frame.getPixel(x, y);
      const b = frame.getPixel(frame.width - 1 - x, y);
      mismatch +=
        Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    }
  return mismatch / 255 / Math.max(1, frame.height);
}
