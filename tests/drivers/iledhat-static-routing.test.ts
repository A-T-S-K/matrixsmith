import { describe, expect, it } from "vitest";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import {
  compileAnimationStaticFrame,
  compileGraffitiFrame,
} from "../../src/drivers/coolledux/content";
import { encodeFrameRegion } from "../../src/drivers/coolledux/pixels";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
import { COOLLEDUX_DEFAULT_QUIRKS } from "../../src/core/quirks";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { Framebuffer } from "../../src/render/framebuffer";
import type { DeviceProfile } from "../../src/core/device";
import type { DriverContext } from "../../src/drivers/types";

/**
 * Normal content routing on the characterized iLedHat.
 *
 * Two shipped profile facts have to reach the compiler without any session
 * evidence, because a fact nobody consults is not worth shipping: this panel
 * cannot hold a still image through Graffiti, and its literal 0x0000 really
 * is off. Getting either wrong is silently visible on the display — a picture
 * that scrolls away, or a "black" background rendered as dim blue.
 */

function context(
  profile: DeviceProfile = iledHat31aeProfile,
  extra: Partial<DriverContext> = {},
): DriverContext {
  return {
    profile,
    fingerprint: knownIledHatFingerprint(),
    source: "live",
    ...extra,
  };
}

/** A frame with one lit pixel; everything else is logical black. */
function frameWithBlackBackground(): Framebuffer {
  const frame = new Framebuffer(32, 16);
  frame.setPixel(0, 0, 255, 0, 0);
  return frame;
}

describe("normal static routing on the characterized profile", () => {
  it("compiles ShowFrame through one-frame Animation with no session evidence", () => {
    const plan = coolLedUxDriver.plan(
      { type: "ShowFrame", frame: frameWithBlackBackground() },
      context(),
    );
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.contentType).toBe("animation");
    expect(plan.metadata.frameCount).toBe(1);
    expect(plan.metadata.tileCount).toBe(4);
    expect(plan.metadata.tileWidth).toBe(8);
    expect(plan.metadata.width).toBe(32);
    expect(plan.metadata.height).toBe(16);
  });

  it("compiles locally rendered ShowText through the same route", () => {
    const plan = coolLedUxDriver.plan(
      { type: "ShowText", text: "HI", frame: frameWithBlackBackground() },
      context(),
    );
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.frameCount).toBe(1);
    expect(plan.metadata.tileCount).toBe(4);
  });

  it("produces exactly the bytes the one-frame Animation compiler produces", () => {
    const frame = frameWithBlackBackground();
    const plan = coolLedUxDriver.plan({ type: "ShowFrame", frame }, context());
    const expected = compileAnimationStaticFrame(frame, "single");
    expect(plan.metadata.crc32).toBe(
      `0x${expected.crc32.toString(16).padStart(8, "0").toUpperCase()}`,
    );
    expect(plan.metadata.programBytes).toBe(expected.programBytes.length);
    // And emphatically NOT the Graffiti bytes.
    const graffiti = compileGraffitiFrame(
      frame,
      undefined,
      {},
      { state: "true-black", basis: "observed" },
    );
    expect(plan.metadata.crc32).not.toBe(
      `0x${graffiti.crc32.toString(16).padStart(8, "0").toUpperCase()}`,
    );
  });

  it("still lets a session-validated strategy override the profile preference", () => {
    const plan = coolLedUxDriver.plan(
      { type: "ShowFrame", frame: frameWithBlackBackground() },
      context(iledHat31aeProfile, {
        rasterStrategy: "animation-identical-frames",
      }),
    );
    expect(plan.metadata.rasterStrategy).toBe("animation-identical-frames");
    expect(plan.metadata.frameCount).toBe(2);
  });

  it("keeps the conservative Graffiti default for a profile with no resolved preference", () => {
    const unresolved: DeviceProfile = {
      ...iledHat31aeProfile,
      id: "coolledux-unresolved",
      quirks: COOLLEDUX_DEFAULT_QUIRKS,
    };
    const plan = coolLedUxDriver.plan(
      { type: "ShowFrame", frame: frameWithBlackBackground() },
      context(unresolved),
    );
    expect(plan.metadata.rasterStrategy).toBe("graffiti");
    expect(plan.metadata.contentType).toBe("graffiti");
  });
});

describe("black is black on the characterized profile", () => {
  it("never substitutes the inherited 0x0004 workaround on the normal path", () => {
    const plan = coolLedUxDriver.plan(
      { type: "ShowFrame", frame: frameWithBlackBackground() },
      context(),
    );
    // The Animation path never used the sentinel, but assert the produced
    // program contains no 0x0004 word rather than trusting that by reputation.
    const program = compileAnimationStaticFrame(
      frameWithBlackBackground(),
      "single",
    ).programBytes;
    expect(plan.metadata.programBytes).toBe(program.length);
    expect(containsWord(program, 0x0004)).toBe(false);
    expect(containsWord(program, 0x0000)).toBe(true);
  });

  it("writes literal 0x0000 when Graffiti is invoked on this profile for research", () => {
    // Graffiti is still reachable for diagnostics on this panel. When it is,
    // it must use the panel's OWN observed black semantics, not the upstream
    // workaround — with no current-session evidence required.
    const frame = frameWithBlackBackground();
    const fromProfile = compileGraffitiFrame(
      frame,
      undefined,
      {},
      iledHat31aeProfile.quirks!.graffitiBlack,
    );
    const literal = compileGraffitiFrame(
      frame,
      undefined,
      {},
      { state: "true-black", basis: "observed" },
    );
    const workaround = compileGraffitiFrame(
      frame,
      undefined,
      {},
      {
        state: "white-sentinel",
        basis: "source-derived",
        workaroundWord: 0x0004,
      },
    );
    expect(fromProfile.crc32).toBe(literal.crc32);
    expect(fromProfile.crc32).not.toBe(workaround.crc32);
    expect(containsWord(fromProfile.programBytes, 0x0004)).toBe(false);
  });

  it("keeps the workaround for an uncharacterized CoolLEDUX profile", () => {
    const frame = frameWithBlackBackground();
    const unresolved = compileGraffitiFrame(
      frame,
      undefined,
      {},
      COOLLEDUX_DEFAULT_QUIRKS.graffitiBlack,
    );
    expect(containsWord(unresolved.programBytes, 0x0004)).toBe(true);
  });
});

describe("no fourth-channel assumption", () => {
  it("leaves the byte0 high nibble clear in the encoded pixel stream", () => {
    // The high nibble drives nothing on this panel. A compiler that started
    // using it for a white channel would light nothing and corrupt colour.
    const frame = new Framebuffer(32, 16);
    for (let x = 0; x < 32; x += 1)
      for (let y = 0; y < 16; y += 1) frame.setPixel(x, y, 255, 255, 255);
    expect(
      coolLedUxDriver.plan({ type: "ShowFrame", frame }, context()).metadata
        .rasterStrategy,
    ).toBe("animation-single-frame");
    // RGB444 full white is 0x0F 0xFF: red in byte0's LOW nibble, green and
    // blue in byte1. The high nibble stays clear for every pixel.
    const stream = encodeFrameRegion(frame, 0, 8, "animation");
    expect(stream.length).toBe(8 * 16 * 2);
    for (let index = 0; index < stream.length; index += 2) {
      expect(stream[index]! & 0xf0).toBe(0);
      expect(stream[index]).toBe(0x0f);
      expect(stream[index + 1]).toBe(0xff);
    }
  });
});

function containsWord(bytes: Uint8Array, word: number): boolean {
  const high = (word >>> 8) & 0xff;
  const low = word & 0xff;
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    if (bytes[index] === high && bytes[index + 1] === low) return true;
  }
  return false;
}
