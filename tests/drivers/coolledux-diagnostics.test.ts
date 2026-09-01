import { describe, expect, it } from "vitest";
import { COOLLEDUX_DIAGNOSTIC_CONTENT, diagnosticContent, PIXEL_CHANNEL_PROBE_WORDS } from "../../src/drivers/coolledux/diagnostics";
import { lzssDecompress } from "../../src/drivers/coolledux/wire";
import { encodeFrameRegion } from "../../src/drivers/coolledux/pixels";
import { orientationPattern } from "../../src/render/patterns";

function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) if (haystack[start + index] !== needle[index]) continue outer;
    return true;
  }
  return false;
}
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { knownIledHatFingerprint } from "../helpers/fixtures";

const PROFILE = { width: 32, height: 16 };
const context = { profile: iledHat31aeProfile, fingerprint: knownIledHatFingerprint(), source: "live" as const };

/** Decompress the safe-LZSS program and return its raw bytes for inspection. */
function programBytes(compiledProgram: { compressedBytes: Uint8Array }): Uint8Array {
  return lzssDecompress(compiledProgram.compressedBytes);
}

/** Extract every 16-bit pixel word from a graffiti/animation segment stream given known geometry. */
function collectWords(program: Uint8Array): Set<number> {
  const words = new Set<number>();
  for (let index = 0; index + 1 < program.length; index += 2) words.add(((program[index] ?? 0) << 8) | (program[index + 1] ?? 0));
  return words;
}

describe("graffiti black/off probe", () => {
  const built = diagnosticContent("graffiti-black-probe").build(PROFILE);

  it("preserves literal raw 0x0000 and 0x0004 with no substitution", () => {
    const zeroRegion = built.regions.find((region) => region.rawWord === 0x0000 && region.width === 8);
    const workaroundRegion = built.regions.find((region) => region.rawWord === 0x0004);
    expect(zeroRegion).toBeDefined();
    expect(workaroundRegion).toBeDefined();
    // The exact bytes must survive compilation: decompress and confirm both words appear at volume.
    const bytes = programBytes(built.compiled);
    let zeroPairs = 0;
    let workaroundPairs = 0;
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      const word = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
      if (word === 0x0000) zeroPairs += 1;
      if (word === 0x0004) workaroundPairs += 1;
    }
    expect(zeroPairs).toBeGreaterThan(100);
    expect(workaroundPairs).toBeGreaterThan(100);
  });

  it("uses alternating 8-column regions across the canvas", () => {
    const bands = built.regions.filter((region) => region.width === 8);
    expect(bands.map((region) => region.rawWord)).toEqual([0x0000, 0x0004, 0x0000, 0x0004]);
    expect(bands.map((region) => region.x)).toEqual([0, 8, 16, 24]);
  });

  it("compiles four tiles on the graffiti path with the baseline playback bytes", () => {
    expect(built.contentType).toBe("graffiti");
    expect(built.compiled.tileCount).toBe(4);
    expect(built.playback).toEqual({ mode: 0, speed: 0, stayTime: 3 });
  });
});

describe("graffiti timing probe / stayTime discriminator", () => {
  it("keeps every byte identical between stayTime variants except the stayTime byte", () => {
    const baseline = diagnosticContent("graffiti-timing-probe").build(PROFILE, { stayTime: 3 });
    const variant = diagnosticContent("graffiti-timing-probe").build(PROFILE, { stayTime: 0 });
    const baseBytes = programBytes(baseline.compiled);
    const variantBytes = programBytes(variant.compiled);
    expect(baseBytes.length).toBe(variantBytes.length);
    const diffs: number[] = [];
    for (let index = 0; index < baseBytes.length; index += 1) if (baseBytes[index] !== variantBytes[index]) diffs.push(index);
    // Exactly one changed byte per tile: the stayTime field.
    expect(diffs).toHaveLength(baseline.compiled.tileCount);
    for (const index of diffs) { expect(baseBytes[index]).toBe(3); expect(variantBytes[index]).toBe(0); }
  });

  it("refuses stayTime values without credible source evidence", () => {
    expect(() => diagnosticContent("graffiti-timing-probe").build(PROFILE, { stayTime: 0xff })).toThrow(/allowed/i);
    expect(() => diagnosticContent("graffiti-timing-probe").build(PROFILE, { stayTime: 7 })).toThrow(/allowed/i);
  });

  it("records the tested playback parameters", () => {
    const built = diagnosticContent("graffiti-timing-probe").build(PROFILE, { stayTime: 0 });
    expect(built.playback).toEqual({ mode: 0, speed: 0, stayTime: 0 });
  });
});

describe("animation static raster", () => {
  it("builds one frame across four full-height tiles by default", () => {
    const built = diagnosticContent("animation-static-raster").build(PROFILE);
    expect(built.frameCount).toBe(1);
    expect(built.compiled.tileCount).toBe(4);
    expect(built.contentType).toBe("animation");
  });

  it("offers the identical-two-frame variant as a separate explicit build", () => {
    const single = diagnosticContent("animation-static-raster").build(PROFILE, { frames: 1 });
    const pair = diagnosticContent("animation-static-raster").build(PROFILE, { frames: 2 });
    expect(pair.frameCount).toBe(2);
    expect(pair.compiled.programBytes.length).toBeGreaterThan(single.compiled.programBytes.length);
    expect(() => diagnosticContent("animation-static-raster").build(PROFILE, { frames: 3 })).toThrow(/allowed/i);
  });

  it("keeps the animation background at literal 0x0000 (verified true black)", () => {
    const built = diagnosticContent("animation-static-raster").build(PROFILE);
    const bytes = programBytes(built.compiled);
    // The exact animation-path pixel stream (off = 0x0000) for tile 0 must
    // appear verbatim; the graffiti-path stream (off = 0x0004) must not.
    const frame = orientationPattern(PROFILE.width, PROFILE.height);
    const animationStream = encodeFrameRegion(frame, 0, 8, "animation");
    const graffitiStream = encodeFrameRegion(frame, 0, 8, "graffiti");
    expect(containsSubsequence(bytes, animationStream)).toBe(true);
    expect(containsSubsequence(bytes, graffitiStream)).toBe(false);
  });
});

describe("pixel-channel probe", () => {
  const built = diagnosticContent("pixel-channel-probe").build(PROFILE);

  it("transmits every declared raw word exactly, including untransformed high nibbles", () => {
    const words = collectWords(programBytes(built.compiled));
    for (const word of PIXEL_CHANNEL_PROBE_WORDS) expect(words.has(word)).toBe(true);
  });

  it("declares a region diagram entry for each probe word", () => {
    expect(built.regions).toHaveLength(PIXEL_CHANNEL_PROBE_WORDS.length);
    for (const region of built.regions) {
      expect(region.width * region.height).toBeLessThanOrEqual(18);
      expect(PIXEL_CHANNEL_PROBE_WORDS).toContain(region.rawWord);
    }
  });

  it("labels only RGB444-predictable words with an expectation", () => {
    const expectations = built.regions.filter((region) => region.expectedUnderRgb444);
    expect(expectations.map((region) => region.rawWord).sort((a, b) => a - b)).toEqual([0x0000, 0x000f, 0x00f0, 0x0f00, 0x0fff, 0xffff]);
    const highNibbleOnly = built.regions.filter((region) => [0x1000, 0x2000, 0x4000, 0x8000, 0xf000].includes(region.rawWord));
    for (const region of highNibbleOnly) expect(region.expectedUnderRgb444).toBeUndefined();
  });

  it("keeps the lit area conservative", () => {
    const litPixels = built.regions.reduce((total, region) => total + region.width * region.height, 0);
    expect(litPixels).toBeLessThanOrEqual(PROFILE.width * PROFILE.height / 2);
  });
});

describe("no general raw writer", () => {
  it("only accepts declared diagnostic ids through ShowDiagnostic", () => {
    expect(() => coolLedUxDriver.plan({ type: "ShowDiagnostic", diagnosticId: "arbitrary-bytes" }, context)).toThrow(/Unknown CoolLEDUX diagnostic/);
  });

  it("only accepts declared parameter values", () => {
    expect(() => coolLedUxDriver.plan({ type: "ShowDiagnostic", diagnosticId: "graffiti-timing-probe", parameters: { stayTime: 255 } }, context)).toThrow(/allowed/i);
  });

  it("exposes a fixed catalogue of diagnostic content", () => {
    expect(COOLLEDUX_DIAGNOSTIC_CONTENT.map(({ id }) => id)).toEqual([
      "graffiti-black-probe", "graffiti-timing-probe", "animation-static-raster", "pixel-channel-probe", "color-white-probe",
    ]);
  });

  it("plans diagnostics as persistent content with honest metadata", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowDiagnostic", diagnosticId: "graffiti-black-probe" }, context);
    expect(plan.risk).toBe("persistent");
    expect(plan.persistence).toBe("persistent");
    expect(plan.metadata.diagnosticId).toBe("graffiti-black-probe");
    expect(plan.metadata.graffitiStayTime).toBe(3);
  });
});
