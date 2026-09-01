import { describe, expect, it } from "vitest";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { compileAnimationStaticFrame, compileGraffitiFrame, encodeRawWordRegion } from "../../src/drivers/coolledux/content";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { ILEDHAT_QUIRKS } from "../../src/core/quirks";
import { isRasterStrategy } from "../../src/core/raster-strategy";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { orientationPattern } from "../../src/render/patterns";

const fingerprint = knownIledHatFingerprint();
const frame = orientationPattern(32, 16);

describe("raster strategy routing", () => {
  it("defaults ShowFrame to the graffiti strategy", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame }, { profile: iledHat31aeProfile, fingerprint, source: "live" });
    expect(plan.metadata.rasterStrategy).toBe("graffiti");
    expect(plan.metadata.contentType).toBe("graffiti");
  });

  it("routes ShowFrame through a validated animation-single-frame strategy", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame }, { profile: iledHat31aeProfile, fingerprint, source: "live", rasterStrategy: "animation-single-frame" });
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.contentType).toBe("animation");
    expect(plan.metadata.frameCount).toBe(1);
  });

  it("routes ShowText through the same strategy selection as images", () => {
    const plan = coolLedUxDriver.plan({ type: "ShowText", text: "HI", frame }, { profile: iledHat31aeProfile, fingerprint, source: "live", rasterStrategy: "animation-identical-frames" });
    expect(plan.metadata.rasterStrategy).toBe("animation-identical-frames");
    expect(plan.metadata.frameCount).toBe(2);
    expect(plan.metadata.contentType).toBe("text");
  });

  it("compiles distinct programs per strategy from the same logical frame", () => {
    const graffiti = compileGraffitiFrame(frame);
    const single = compileAnimationStaticFrame(frame, "single");
    const pair = compileAnimationStaticFrame(frame, "identical-pair");
    expect(single.programBytes).not.toEqual(graffiti.programBytes);
    expect(pair.programBytes.length).toBeGreaterThan(single.programBytes.length);
    expect(single.tileCount).toBe(4);
  });
});

describe("profile quirks", () => {
  it("ships the iLedHat quirks with honest unknowns", () => {
    expect(iledHat31aeProfile.quirks).toBe(ILEDHAT_QUIRKS);
    expect(ILEDHAT_QUIRKS.graffitiBlack.state).toBe("unknown");
    expect(ILEDHAT_QUIRKS.animationBlack).toEqual({ state: "true-black", basis: "observed" });
    expect(ILEDHAT_QUIRKS.whiteChannel.state).toBe("unknown");
    expect(ILEDHAT_QUIRKS.preferredRasterStrategy).toBe("unresolved");
    expect(ILEDHAT_QUIRKS.unexplained.colorModeRaw).toBe(3);
    expect(ILEDHAT_QUIRKS.channelMap.state).toBe("rgb444-hypothesis");
  });

  it("keeps quirks immutable at runtime", () => {
    expect(Object.isFrozen(ILEDHAT_QUIRKS)).toBe(true);
  });

  it("declares every strategy candidate as a real strategy", () => {
    for (const candidate of ILEDHAT_QUIRKS.rasterStrategyCandidates) expect(isRasterStrategy(candidate)).toBe(true);
  });
});

describe("encodeRawWordRegion", () => {
  it("emits column-major big-endian words byte-for-byte", () => {
    const words = Uint16Array.of(
      0x1234, 0xabcd,
      0x0004, 0xf000,
    ); // 2×2 grid, row-major
    const encoded = encodeRawWordRegion(words, 2, 2, 0, 2);
    expect([...encoded]).toEqual([0x12, 0x34, 0x00, 0x04, 0xab, 0xcd, 0xf0, 0x00]);
  });

  it("rejects out-of-range regions and mismatched grids", () => {
    expect(() => encodeRawWordRegion(Uint16Array.of(0), 2, 2, 0, 2)).toThrow(RangeError);
    expect(() => encodeRawWordRegion(new Uint16Array(4), 2, 2, 1, 2)).toThrow(RangeError);
  });
});
