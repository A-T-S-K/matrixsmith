import { describe, expect, it } from "vitest";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { compileAnimationStaticFrame, compileGraffitiFrame, encodeRawWordRegion } from "../../src/drivers/coolledux/content";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { COOLLEDUX_DEFAULT_QUIRKS, ILEDHAT_QUIRKS } from "../../src/core/quirks";
import { isRasterStrategy } from "../../src/core/raster-strategy";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { orientationPattern } from "../../src/render/patterns";

const fingerprint = knownIledHatFingerprint();
const frame = orientationPattern(32, 16);

describe("raster strategy routing", () => {
  it("routes ShowFrame through the profile's own preferred strategy", () => {
    // No session evidence: the characterized profile's preference decides,
    // and on this panel Graffiti was physically ruled out.
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame }, { profile: iledHat31aeProfile, fingerprint, source: "live" });
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.contentType).toBe("animation");
  });

  it("falls back to graffiti only for a profile with no resolved preference", () => {
    const unresolved = { ...iledHat31aeProfile, id: "coolledux-unresolved", quirks: COOLLEDUX_DEFAULT_QUIRKS };
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame }, { profile: unresolved, fingerprint, source: "live" });
    expect(plan.metadata.rasterStrategy).toBe("graffiti");
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
  it("ships the physically characterized iLedHat quirks", () => {
    expect(iledHat31aeProfile.quirks).toBe(ILEDHAT_QUIRKS);
    // Observed on this panel, not inherited: 0x0000 really is off here, so
    // the upstream 0x0004 workaround must never be substituted.
    expect(ILEDHAT_QUIRKS.graffitiBlack).toEqual({ state: "true-black", basis: "observed" });
    expect(ILEDHAT_QUIRKS.animationBlack).toEqual({ state: "true-black", basis: "observed" });
    // The high nibble was swept and drove nothing; there is no fourth channel
    // for a white emitter to live in.
    expect(ILEDHAT_QUIRKS.whiteChannel).toEqual({ state: "absent", basis: "observed" });
    expect(ILEDHAT_QUIRKS.preferredRasterStrategy).toBe("animation-single-frame");
    expect(ILEDHAT_QUIRKS.unexplained.colorModeRaw).toBe(3);
    expect(ILEDHAT_QUIRKS.channelMap.state).toBe("verified-rgb444");
  });

  it("drops Graffiti as a normal static candidate after physically rejecting it", () => {
    expect(ILEDHAT_QUIRKS.rasterStrategyCandidates).toEqual(["animation-single-frame", "animation-identical-frames"]);
    // Still implemented for diagnostics and for profiles whose evidence
    // supports it — the DEFAULT quirks are deliberately untouched.
    expect(COOLLEDUX_DEFAULT_QUIRKS.rasterStrategyCandidates).toContain("graffiti");
    expect(COOLLEDUX_DEFAULT_QUIRKS.graffitiBlack.state).toBe("white-sentinel");
    expect(COOLLEDUX_DEFAULT_QUIRKS.preferredRasterStrategy).toBe("unresolved");
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
