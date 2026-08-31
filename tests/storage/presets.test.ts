import { describe, expect, it } from "vitest";
import { Framebuffer } from "../../src/render/framebuffer";
import { loadPreset, savePreset } from "../../src/storage/presets";
import type { KeyValueStorage } from "../../src/storage/repository";

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

describe("preset storage", () => {
  it("persists structured dimension-aware MatrixSmith records", () => {
    const storage = new MemoryStorage();
    const frame = new Framebuffer(8, 8);
    frame.setPixel(7, 7, 1, 2, 3);
    savePreset("tiny", frame, "profile", storage);
    expect([...storage.data.keys()][0]).toBe("matrixsmith:v1:preset:tiny");
    expect(loadPreset("tiny", storage)?.getPixel(7, 7)).toEqual({ r: 1, g: 2, b: 3 });
  });

  it("reads the legacy 32×16 namespace", () => {
    const storage = new MemoryStorage();
    const data = new Array(32 * 16 * 3).fill(0);
    data.splice(-3, 3, 7, 8, 9);
    storage.setItem("iledhat:preset:legacy", JSON.stringify(data));
    expect(loadPreset("legacy", storage)?.getPixel(31, 15)).toEqual({ r: 7, g: 8, b: 9 });
  });
});
