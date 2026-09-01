import { compileAnimationStaticFrame, compileGraffitiFrame, compileGraffitiRawWords, compileAnimationRawWords, type CompiledProgram } from "./content";
import { orientationPattern } from "../../render/patterns";
import { Framebuffer } from "../../render/framebuffer";
import { rawWordHex, type DiagnosticRegion } from "../../investigation/regions";

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

export type { DiagnosticRegion };

export interface DiagnosticParameter {
  readonly id: string;
  readonly label: string;
  /** The complete set of allowed values; anything else is refused. */
  readonly allowed: readonly number[];
  readonly defaultValue: number;
}

export interface BuiltDiagnosticContent {
  readonly compiled: CompiledProgram;
  /**
   * What the panel is expected to show, for host-side preview only.
   *
   * Raw-word probes render their encoded words directly, with words whose
   * meaning is unknown drawn mid-gray: the preview shows POSITIONS and never
   * promises what an unprobed value will physically look like.
   */
  readonly preview: Framebuffer;
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

/**
 * Human names for the pixel-channel probe zones, in patch order.
 *
 * The zones whose meaning the RGB444 hypothesis predicts are named for what
 * they test ("Red test"). The high-nibble probes are deliberately NOT given
 * color names: nothing is known about what — if anything — they drive, and
 * naming one "white" would put an assumption in front of the observer and
 * bias the answer. They are "Extra channel A…D" until the panel says
 * otherwise.
 */
const PIXEL_CHANNEL_ZONES: readonly { readonly id: string; readonly name: string; readonly description: string }[] = Object.freeze([
  { id: "black-reference", name: "Black reference", description: "Should be completely off. It is the reference every other zone is judged against." },
  { id: "channel-red", name: "Red test", description: "Drives only the first RGB nibble." },
  { id: "channel-green", name: "Green test", description: "Drives only the second RGB nibble." },
  { id: "channel-blue", name: "Blue test", description: "Drives only the third RGB nibble." },
  { id: "channel-rgb-white", name: "RGB white test", description: "All three RGB nibbles at maximum together." },
  { id: "extra-channel-a", name: "Extra channel A", description: "Probes an unused part of the pixel value. It may light up, or stay dark." },
  { id: "extra-channel-b", name: "Extra channel B", description: "Probes an unused part of the pixel value. It may light up, or stay dark." },
  { id: "extra-channel-c", name: "Extra channel C", description: "Probes an unused part of the pixel value. It may light up, or stay dark." },
  { id: "extra-channel-d", name: "Extra channel D", description: "Probes an unused part of the pixel value. It may light up, or stay dark." },
  { id: "extra-channel-max", name: "Extra channel max", description: "All the unused bits at maximum together." },
  { id: "combined-output", name: "Combined output", description: "Everything at maximum: RGB plus the unused bits." },
]);

/** Stable zone id for a probe word, so questions can reference it. */
export function pixelChannelZoneId(word: number): string {
  const index = PIXEL_CHANNEL_PROBE_WORDS.indexOf(word);
  const zone = PIXEL_CHANNEL_ZONES[index];
  if (!zone) throw new Error(`No pixel-channel zone is defined for raw word ${rawWordHex(word)}.`);
  return zone.id;
}

/**
 * Host preview of an encoded raw-word buffer. Words the current hypothesis
 * predicts render their predicted colour; a word with high-nibble bits and no
 * RGB content renders mid-gray, because claiming it will be dark would be
 * exactly the assumption these probes exist to test.
 */
function rawWordPreview(words: Uint16Array, width: number, height: number): Framebuffer {
  const frame = new Framebuffer(width, height);
  frame.clear();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const word = words[y * width + x] ?? 0;
      const r = ((word >> 8) & 0x0f) * 17;
      const g = ((word >> 4) & 0x0f) * 17;
      const b = (word & 0x0f) * 17;
      const highNibble = (word >> 12) & 0x0f;
      if (highNibble !== 0 && r === 0 && g === 0 && b === 0) frame.setPixel(x, y, 120, 120, 120);
      else if (word === 0x0004) frame.setPixel(x, y, 0, 0, 68);
      else frame.setPixel(x, y, r, g, b);
    }
  }
  return frame;
}

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
      // Tile marker: one pixel at the top-left of each tile. It is not a
      // question target, so it stays a technical note rather than a zone.
      words[start] = 0x0fff;
      const index = start / tileWidth;
      const isBlackCandidate = index % 2 === 0;
      const zone = String.fromCharCode(65 + index);
      regions.push({
        id: `${isBlackCandidate ? "black-candidate" : "workaround"}-${index}`,
        groupId: isBlackCandidate ? "black-candidate" : "workaround",
        shortLabel: zone,
        displayLabel: `Zone ${zone} · ${isBlackCandidate ? "Black candidate" : "Current workaround"}`,
        description: isBlackCandidate
          ? "True black — should be completely off if this display does not need the workaround."
          : "The inherited workaround color, kept as a side-by-side comparison.",
        x: start, y: 0, width: regionWidth, height,
        technical: {
          rawWord,
          notes: [
            `Columns ${start + 1}–${start + regionWidth} carry literal raw ${rawWordHex(rawWord)} with no off-color substitution.`,
            `A single bright marker pixel (${rawWordHex(0x0fff)}) sits at this tile's top-left corner; ignore it when judging the color.`,
          ],
        },
      });
    }
    return {
      compiled: compileGraffitiRawWords(words, width, height, { mode: 0, speed: 0, stayTime: 3 }),
      preview: rawWordPreview(words, width, height),
      contentType: "graffiti", frameCount: 1, regions,
      playback: { mode: 0, speed: 0, stayTime: 3 },
    };
  },
};

/**
 * Human zones of the deterministic orientation raster. Placement questions
 * ("is the red corner here?", "are the four sections all present?") reference
 * these so the UI can highlight the exact feature being asked about instead
 * of relying on the user to remember the intended layout.
 */
function orientationRegions(width: number, height: number): DiagnosticRegion[] {
  const corner = Math.max(2, Math.min(3, Math.floor(Math.min(width, height) / 4)));
  const tileWidth = Math.max(1, Math.floor(width / 4));
  const corners: readonly { id: string; name: string; color: string; x: number; y: number }[] = [
    { id: "corner-top-left", name: "Top-left corner", color: "red", x: 0, y: 0 },
    { id: "corner-top-right", name: "Top-right corner", color: "green", x: width - corner, y: 0 },
    { id: "corner-bottom-left", name: "Bottom-left corner", color: "blue", x: 0, y: height - corner },
    { id: "corner-bottom-right", name: "Bottom-right corner", color: "yellow", x: width - corner, y: height - corner },
  ];
  const regions: DiagnosticRegion[] = corners.map((entry, index) => ({
    id: entry.id,
    groupId: "corners",
    shortLabel: String(index + 1),
    displayLabel: `Zone ${index + 1} · ${entry.name}`,
    description: `The ${entry.name.toLowerCase()} is ${entry.color}. Together the four corners show whether the image is rotated or mirrored.`,
    x: entry.x, y: entry.y, width: corner, height: corner,
    technical: { expectedUnderHypothesis: entry.color, notes: [`Corner block ${corner}×${corner} px at (${entry.x}, ${entry.y}).`] },
  }));
  for (let index = 0; index < 4; index += 1) {
    const x = index * tileWidth;
    regions.push({
      id: `tile-${index + 1}`,
      groupId: "tiles",
      shortLabel: `T${index + 1}`,
      displayLabel: `Section ${index + 1}`,
      description: "One of the four vertical sections the panel is built from. All four should be present and aligned.",
      x, y: 0, width: index === 3 ? width - x : tileWidth, height,
      technical: { notes: [`Vertical section covering columns ${x + 1}–${index === 3 ? width : x + tileWidth}.`] },
    });
  }
  for (let index = 1; index < 4; index += 1) {
    const x = index * tileWidth;
    regions.push({
      id: `seam-${index}`,
      groupId: "seams",
      shortLabel: `S${index}`,
      displayLabel: `Seam ${index}`,
      description: "The join between two sections. A visible step or gap here means the sections are misaligned.",
      x: Math.max(0, x - 1), y: 0, width: 2, height,
      technical: { notes: [`Boundary between sections ${index} and ${index + 1} at column ${x + 1}.`] },
    });
  }
  return regions;
}

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
      preview: frame,
      contentType: "graffiti", frameCount: 1, regions: orientationRegions(profile.width, profile.height),
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
      preview: frame,
      contentType: "animation", frameCount: frames, regions: orientationRegions(profile.width, profile.height),
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
      const zone = PIXEL_CHANNEL_ZONES[index]!;
      const expected = RGB444_EXPECTATIONS[rawWord];
      regions.push({
        id: zone.id,
        shortLabel: String(index + 1),
        displayLabel: `Zone ${index + 1} · ${zone.name}`,
        description: zone.description,
        x, y, width: patchWidth, height: patchHeight,
        technical: {
          rawWord,
          ...(expected ? { expectedUnderHypothesis: expected } : {}),
          notes: [
            `Raw pixel word ${rawWordHex(rawWord)}, transmitted untransformed.`,
            expected
              ? `Current hypothesis predicts: ${expected}.`
              : "No expectation is claimed for this word — record exactly what the panel shows.",
          ],
        },
      });
    });
    return {
      compiled: compileAnimationRawWords([words], [60000], width, height),
      preview: rawWordPreview(words, width, height),
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
    const topBands: readonly { word: number; id: string; name: string; description: string }[] = [
      { word: 0x0f00, id: "band-red", name: "Red band", description: "Pure red at full strength." },
      { word: 0x00f0, id: "band-green", name: "Green band", description: "Pure green at full strength." },
      { word: 0x000f, id: "band-blue", name: "Blue band", description: "Pure blue at full strength." },
      { word: 0x0fff, id: "band-rgb-white", name: "RGB white band", description: "Red, green, and blue together at full strength." },
    ];
    const bandWidth = Math.floor(width / topBands.length);
    topBands.forEach((band, index) => {
      const x = index * bandWidth;
      for (let px = x; px < x + bandWidth; px += 1) for (let py = 1; py < Math.min(7, height); py += 1) words[py * width + px] = band.word;
      const expected = RGB444_EXPECTATIONS[band.word];
      regions.push({
        id: band.id,
        shortLabel: String(index + 1),
        displayLabel: `Zone ${index + 1} · ${band.name}`,
        description: band.description,
        x, y: 1, width: bandWidth, height: Math.min(6, height - 1),
        technical: {
          rawWord: band.word,
          ...(expected ? { expectedUnderHypothesis: expected } : {}),
          notes: [`Raw pixel word ${rawWordHex(band.word)}.`],
        },
      });
    });
    if (includeHighNibble && height >= 16) {
      // Named for what is being probed, never for a color: the fourth
      // channel's appearance is exactly what this test is asking about.
      const bottomBands: readonly { word: number; id: string; name: string; description: string }[] = [
        { word: 0xf000, id: "band-extra-channel", name: "Extra channel band", description: "The fourth channel on its own, with no red, green, or blue." },
        { word: 0xffff, id: "band-combined", name: "Combined band", description: "The fourth channel together with red, green, and blue." },
      ];
      const bottomWidth = Math.floor(width / bottomBands.length);
      bottomBands.forEach((band, index) => {
        const x = index * bottomWidth;
        for (let px = x; px < x + bottomWidth; px += 1) for (let py = 9; py < Math.min(15, height); py += 1) words[py * width + px] = band.word;
        regions.push({
          id: band.id,
          shortLabel: String(topBands.length + index + 1),
          displayLabel: `Zone ${topBands.length + index + 1} · ${band.name}`,
          description: band.description,
          x, y: 9, width: bottomWidth, height: 6,
          technical: {
            rawWord: band.word,
            notes: [`Raw pixel word ${rawWordHex(band.word)}, transmitted untransformed.`],
          },
        });
      });
    }
    return {
      compiled: compileAnimationRawWords([words], [60000], width, height),
      preview: rawWordPreview(words, width, height),
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
