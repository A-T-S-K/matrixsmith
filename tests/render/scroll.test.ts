import * as font from "../../src/render/font";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planRasterScroll, resolvesToScroll } from "../../src/render/scroll";

const COLORS = {
  color: { r: 255, g: 136, b: 0 },
  background: { r: 0, g: 0, b: 0 },
};

describe("semantic scrolling-text planning", () => {
  const phrases = [
    "MatrixSmith",
    "Matrix Smith",
    "MatrixSmith by",
    "Matrix Smith by",
    "MatrixSmith by ATSK",
    "FREE LLM TOKENS :-)",
  ] as const;
  it.each(phrases)(
    "preflights %s inside the conservative raster budget",
    (text) => {
      const plan = planRasterScroll(text, 32, 16, COLORS);
      expect(plan.textWidth).toBe(text.length * 6 - 1);
      expect(plan.frameCount).toBeLessThanOrEqual(48);
      expect(plan.decodedBytesPerTile).toBeLessThanOrEqual(
        plan.safetyBudgetBytesPerTile,
      );
      expect(plan.safe).toBe(true);
      if (!plan.safe) throw new Error("Expected safe plan");
      expect(plan.sequence.frames).toHaveLength(plan.frameCount);
    },
  );

  it("Auto selects still only when the rendered text fits", () => {
    expect(resolvesToScroll("auto", "HELLO", 32)).toBe(false);
    expect(resolvesToScroll("auto", "MatrixSmith", 32)).toBe(true);
    expect(resolvesToScroll("still", "MatrixSmith", 32)).toBe(false);
    expect(resolvesToScroll("scroll", "HI", 32)).toBe(true);
  });
});

it.each([1000, 1000000])(
  "rejects %s characters without a sendable sequence",
  (count) => {
    const plan = planRasterScroll("X".repeat(count), 32, 16, COLORS);
    expect(plan.safe).toBe(false);
    expect(plan.frameCount).toBe(Math.ceil((32 + count * 6 - 1) / 8) + 1);
    expect(plan).not.toHaveProperty("sequence");
  },
);

afterEach(() => vi.restoreAllMocks());
it.each([1000, 1000000])(
  "does no glyph/raster allocation for rejected %s-character text",
  (count) => {
    const columns = vi.spyOn(font, "textColumns");
    const raster = vi.spyOn(font, "renderTextColumns");
    expect(planRasterScroll("X".repeat(count), 32, 16, COLORS).safe).toBe(
      false,
    );
    expect(columns).not.toHaveBeenCalled();
    expect(raster).not.toHaveBeenCalled();
  },
);
it.each(["MatrixSmith", "Matrix Smith", "FREE LLM TOKENS :-)", "😀A"])(
  "preserves exact offsets, pixels and timing for %s",
  (text) => {
    const plan = planRasterScroll(text, 32, 16, COLORS);
    if (!plan.safe) throw new Error(plan.reason);
    const offsets = font.scrollOffsets(text, 32, plan.step);
    expect(plan.frameCount).toBe(offsets.length);
    expect(plan.frameDelayMs).toBe(120 * plan.step);
    offsets.forEach((offset, index) => {
      expect(plan.sequence.frames[index]).toEqual(
        font.renderText(text, 32, 16, {
          ...COLORS,
          alignment: "left",
          offsetX: offset,
        }),
      );
      expect(plan.sequence.timing[index]?.milliseconds).toBe(120 * plan.step);
    });
  },
);
it("preflights exact frame and decoded-tile boundaries at larger geometry", () => {
  // Empty text at width 47 is exactly 48 frames; 48 forces the next step.
  expect(planRasterScroll("", 47, 16, COLORS)).toMatchObject({
    frameCount: 48,
    step: 1,
    safe: true,
  });
  expect(planRasterScroll("", 48, 16, COLORS).step).toBe(2);
  // 32 frames × 8 columns × 32 rows × 2 bytes = 16 KiB.
  expect(planRasterScroll("", 31, 32, COLORS)).toMatchObject({
    safe: true,
    decodedBytesPerTile: 16384,
  });
  expect(planRasterScroll("", 31, 33, COLORS)).toMatchObject({
    safe: false,
    decodedBytesPerTile: 16896,
  });
});
