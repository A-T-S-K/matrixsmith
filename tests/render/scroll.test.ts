import { describe, expect, it } from "vitest";
import { planRasterScroll, resolvesToScroll } from "../../src/render/scroll";

const COLORS = { color: { r: 255, g: 136, b: 0 }, background: { r: 0, g: 0, b: 0 } };

describe("semantic scrolling-text planning", () => {
  const phrases = ["MatrixSmith", "Matrix Smith", "MatrixSmith by", "Matrix Smith by", "MatrixSmith by ATSK", "FREE LLM TOKENS :-)"] as const;
  it.each(phrases)("preflights %s inside the conservative raster budget", (text) => {
    const plan = planRasterScroll(text, 32, 16, COLORS);
    expect(plan.textWidth).toBe(text.length * 6 - 1);
    expect(plan.frameCount).toBeLessThanOrEqual(48);
    expect(plan.decodedBytesPerTile).toBeLessThanOrEqual(plan.safetyBudgetBytesPerTile);
    expect(plan.safe).toBe(true);
    expect(plan.sequence.frames).toHaveLength(plan.frameCount);
  });

  it("Auto selects still only when the rendered text fits", () => {
    expect(resolvesToScroll("auto", "HELLO", 32)).toBe(false);
    expect(resolvesToScroll("auto", "MatrixSmith", 32)).toBe(true);
    expect(resolvesToScroll("still", "MatrixSmith", 32)).toBe(false);
    expect(resolvesToScroll("scroll", "HI", 32)).toBe(true);
  });
});
