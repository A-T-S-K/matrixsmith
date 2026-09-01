import { compileAnimationStaticFrame, compileGraffitiFrame, compileGraffitiRawWords, compileAnimationRawWords, type CompiledProgram } from "./content";
import { orientationPattern } from "../../render/patterns";

/**
 * Fixed CoolLEDUX diagnostic content. Every program here is deterministic
 * and fully defined by this module: the only caller-controllable inputs are
 * the profile geometry and the small declared parameter sets (e.g. stayTime
 * 3 vs 0). Nothing accepts arbitrary raw words, bytes, or pixel data — this
 * is intentionally NOT a general raw writer.
 */

export type DiagnosticContentId =
  | "graffiti-black-probe"
  | "graffiti-timing-probe"
  | "animation-static-raster"
  | "pixel-channel-probe"
  | "color-white-probe";

export interface DiagnosticRegion {
  /** Raw 16-bit pixel word, exactly as transmitted (no substitution, no transfer curve). */
  readonly rawWord: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  /** Only for words whose meaning the current RGB444 hypothesis predicts. */
  readonly expectedUnderRgb444?: string;
}

export interface DiagnosticParameter {
  readonly id: string;
  readonly label: string;
  /** The complete set of allowed values; anything else is refused. */
  readonly allowed: readonly number[];
  readonly defaultValue: number;
}

export interface BuiltDiagnosticContent {
  readonly compiled: CompiledProgram;
  readonly contentType: "graffiti" | "animation";
  readonly frameCount: number;
  readonly regions: readonly DiagnosticRegion[];
  readonly playback?: { readonly mode: number; readonly speed: number; readonly stayTime: number };
  readonly frameDelaysMs?: readonly number[];
}

export interface DiagnosticContentDefinition {
  readonly id: DiagnosticContentId;
  readonly label: string;
  readonly description: string;
  readonly parameters: readonly DiagnosticParameter[];
  build(profile: { readonly width: number; readonly height: number }, parameters?: Readonly<Record<string, number>>): BuiltDiagnosticContent;
}

/** Raw words probed by the pixel-channel diagnostic, in patch order. */
export const PIXEL_CHANNEL_PROBE_WORDS: readonly number[] = Object.freeze([
  0x0000, 0x0f00, 0x00f0, 0x000f, 0x0fff,
  0x1000, 0x2000, 0x4000, 0x8000, 0xf000, 0xffff,
]);

const RGB444_EXPECTATIONS: Readonly<Record<number, string>> = Object.freeze({
  0x0000: "off / black",
  0x0f00: "red",
  0x00f0: "green",
  0x000f: "blue",
  0x0fff: "white (all RGB nibbles max)",
  0xffff: "white plus unknown high nibble at max",
});

function requireParameter(definition: DiagnosticContentDefinition, parameters: Readonly<Record<string, number>> | undefined, id: string): number {
  const spec = definition.parameters.find((parameter) => parameter.id === id);
  if (!spec) throw new Error(`Diagnostic ${definition.id} has no parameter ${id}.`);
  const value = parameters?.[id] ?? spec.defaultValue;
  if (!spec.allowed.includes(value)) throw new Error(`Diagnostic ${definition.id} does not allow ${id}=${value}; allowed values are ${spec.allowed.join(", ")}.`);
  return value;
}

/**
 * TEST A content — characterize Graffiti black/off. Alternating 8-column
 * regions carry literal raw 0x0000 and raw 0x0004 (the inherited workaround
 * word), bypassing the normal off-color substitution entirely. One marker
 * pixel (raw 0x0FFF) at the top of each tile keeps tile placement
 * distinguishable without contaminating the regions' interiors.
 */
const graffitiBlackProbe: DiagnosticContentDefinition = {
  id: "graffiti-black-probe",
  label: "Graffiti black/off probe",
  description: "Alternating 8-column regions of literal raw 0x0000 and raw 0x0004 on the Graffiti path.",
  parameters: [],
  build(profile) {
    const { width, height } = profile;
    const words = new Uint16Array(width * height);
    const regions: DiagnosticRegion[] = [];
    const tileWidth = 8;
    for (let start = 0; start < width; start += tileWidth) {
      const regionWidth = Math.min(tileWidth, width - start);
      const rawWord = (start / tileWidth) % 2 === 0 ? 0x0000 : 0x0004;
      for (let x = start; x < start + regionWidth; x += 1) for (let y = 0; y < height; y += 1) words[y * width + x] = rawWord;
      // Tile marker: one pixel at the top-left of each tile.
      words[start] = 0x0fff;
      regions.push({ rawWord, x: start, y: 0, width: regionWidth, height, label: `columns ${start}–${start + regionWidth - 1}: raw 0x${rawWord.toString(16).padStart(4, "0").toUpperCase()}` });
      regions.push({ rawWord: 0x0fff, x: start, y: 0, width: 1, height: 1, label: `tile marker at column ${start}`, expectedUnderRgb444: RGB444_EXPECTATIONS[0x0fff]! });
    }
    return {
      compiled: compileGraffitiRawWords(words, width, height, { mode: 0, speed: 0, stayTime: 3 }),
      contentType: "graffiti", frameCount: 1, regions,
      playback: { mode: 0, speed: 0, stayTime: 3 },
    };
  },
};

/**
 * TEST B/C content — Graffiti playback timing with an explicit stayTime
 * discriminator. The raster is the deterministic high-contrast orientation
 * pattern; every byte other than stayTime is identical between variants.
 * Only stayTime 3 (the sole upstream-used value) and 0 (the controlled
 * comparison) are allowed: no other value has credible source evidence.
 */
const graffitiTimingProbe: DiagnosticContentDefinition = {
  id: "graffiti-timing-probe",
  label: "Graffiti playback timing probe",
  description: "Deterministic high-contrast Graffiti raster with mode=0, speed=0, and a declared stayTime.",
  parameters: [{ id: "stayTime", label: "Graffiti stayTime byte", allowed: [3, 0], defaultValue: 3 }],
  build(profile, parameters) {
    const stayTime = requireParameter(this, parameters, "stayTime");
    const frame = orientationPattern(profile.width, profile.height);
    return {
      compiled: compileGraffitiFrame(frame, 8, { mode: 0, speed: 0, stayTime }),
      contentType: "graffiti", frameCount: 1, regions: [],
      playback: { mode: 0, speed: 0, stayTime },
    };
  },
};

/**
 * TEST D content — the same logical diagnostic raster delivered as a tiled
 * Animation program with true-black 0x0000 background. frames=1 is the
 * primary variant; frames=2 (two IDENTICAL frames) is the separate optional
 * follow-up and is never sent automatically.
 */
const animationStaticRaster: DiagnosticContentDefinition = {
  id: "animation-static-raster",
  label: "Static raster via Animation",
  description: "The orientation raster compiled as a tiled Animation program with literal 0x0000 background.",
  parameters: [{ id: "frames", label: "Frame count", allowed: [1, 2], defaultValue: 1 }],
  build(profile, parameters) {
    const frames = requireParameter(this, parameters, "frames");
    const frame = orientationPattern(profile.width, profile.height);
    const delayMs = 1000;
    return {
      compiled: compileAnimationStaticFrame(frame, frames === 1 ? "single" : "identical-pair", delayMs),
      contentType: "animation", frameCount: frames, regions: [],
      frameDelaysMs: Array.from({ length: frames }, () => delayMs),
    };
  },
};

/**
 * TEST E content — raw pixel-channel characterization via the Animation
 * path (verified frames/tiling/black). Small 3×6 patches keep total LED
 * current conservative; each patch carries one fixed raw word from
 * PIXEL_CHANNEL_PROBE_WORDS with the high nibble transmitted untransformed.
 */
const pixelChannelProbe: DiagnosticContentDefinition = {
  id: "pixel-channel-probe",
  label: "Raw pixel-channel probe",
  description: "Eleven small fixed raw-word patches (RGB nibbles plus high-nibble probes) on the Animation path.",
  parameters: [],
  build(profile) {
    const { width, height } = profile;
    const words = new Uint16Array(width * height); // background raw 0x0000 (verified true black on Animation)
    const regions: DiagnosticRegion[] = [];
    const cellWidth = 4;
    const cellHeight = 8;
    const columns = Math.max(1, Math.floor(width / cellWidth));
    PIXEL_CHANNEL_PROBE_WORDS.forEach((rawWord, index) => {
      const cellX = (index % columns) * cellWidth;
      const cellY = Math.floor(index / columns) * cellHeight;
      if (cellX + cellWidth > width || cellY + cellHeight > height) throw new Error("Pixel-channel probe does not fit this profile geometry.");
      const x = cellX;
      const y = cellY + 1;
      const patchWidth = 3;
      const patchHeight = Math.min(6, height - y);
      for (let px = x; px < x + patchWidth; px += 1) for (let py = y; py < y + patchHeight; py += 1) words[py * width + px] = rawWord;
      const hex = `0x${rawWord.toString(16).padStart(4, "0").toUpperCase()}`;
      regions.push({
        rawWord, x, y, width: patchWidth, height: patchHeight,
        label: `patch ${index + 1}: raw ${hex}`,
        ...(RGB444_EXPECTATIONS[rawWord] ? { expectedUnderRgb444: RGB444_EXPECTATIONS[rawWord] } : {}),
      });
    });
    return {
      compiled: compileAnimationRawWords([words], [60000], width, height),
      contentType: "animation", frameCount: 1, regions,
      frameDelaysMs: [60000],
    };
  },
};

/**
 * TEST F content — color/white characterization. Runs only after channel-map
 * evidence exists. Moderate 8×6 bands compare pure R, G, B, and RGB-max
 * white; when the high-nibble emitter has been established, a second row
 * adds high-nibble-only and combined bands. No gain/calibration magic: the
 * raw words are exactly what the wire carries.
 */
const colorWhiteProbe: DiagnosticContentDefinition = {
  id: "color-white-probe",
  label: "Color / white probe",
  description: "Labeled bands of pure red, green, blue, RGB-max white, and (when established) the high-nibble channel.",
  parameters: [{ id: "includeHighNibble", label: "Include high-nibble white bands", allowed: [0, 1], defaultValue: 0 }],
  build(profile, parameters) {
    const includeHighNibble = requireParameter(this, parameters, "includeHighNibble") === 1;
    const { width, height } = profile;
    const words = new Uint16Array(width * height);
    const regions: DiagnosticRegion[] = [];
    const topBands: readonly { word: number; label: string; expected?: string }[] = [
      { word: 0x0f00, label: "pure red band", expected: RGB444_EXPECTATIONS[0x0f00]! },
      { word: 0x00f0, label: "pure green band", expected: RGB444_EXPECTATIONS[0x00f0]! },
      { word: 0x000f, label: "pure blue band", expected: RGB444_EXPECTATIONS[0x000f]! },
      { word: 0x0fff, label: "RGB-max band", expected: RGB444_EXPECTATIONS[0x0fff]! },
    ];
    const bandWidth = Math.floor(width / topBands.length);
    topBands.forEach((band, index) => {
      const x = index * bandWidth;
      for (let px = x; px < x + bandWidth; px += 1) for (let py = 1; py < Math.min(7, height); py += 1) words[py * width + px] = band.word;
      regions.push({ rawWord: band.word, x, y: 1, width: bandWidth, height: Math.min(6, height - 1), label: band.label, expectedUnderRgb444: band.expected! });
    });
    if (includeHighNibble && height >= 16) {
      const bottomBands: readonly { word: number; label: string }[] = [
        { word: 0xf000, label: "high-nibble-only band (raw 0xF000)" },
        { word: 0xffff, label: "combined band (raw 0xFFFF)" },
      ];
      const bottomWidth = Math.floor(width / bottomBands.length);
      bottomBands.forEach((band, index) => {
        const x = index * bottomWidth;
        for (let px = x; px < x + bottomWidth; px += 1) for (let py = 9; py < Math.min(15, height); py += 1) words[py * width + px] = band.word;
        regions.push({ rawWord: band.word, x, y: 9, width: bottomWidth, height: 6, label: band.label });
      });
    }
    return {
      compiled: compileAnimationRawWords([words], [60000], width, height),
      contentType: "animation", frameCount: 1, regions,
      frameDelaysMs: [60000],
    };
  },
};

export const COOLLEDUX_DIAGNOSTIC_CONTENT: readonly DiagnosticContentDefinition[] = Object.freeze([
  graffitiBlackProbe, graffitiTimingProbe, animationStaticRaster, pixelChannelProbe, colorWhiteProbe,
]);

export function diagnosticContent(id: string): DiagnosticContentDefinition {
  const definition = COOLLEDUX_DIAGNOSTIC_CONTENT.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown CoolLEDUX diagnostic content ${id}.`);
  return definition;
}
