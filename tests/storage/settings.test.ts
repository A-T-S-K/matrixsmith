import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_SETTINGS,
  loadContentSettings,
  saveContentSettings,
} from "../../src/storage/settings";
import type { KeyValueStorage } from "../../src/storage/repository";

function memoryStorage(): KeyValueStorage & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("content settings persistence", () => {
  it("round-trips settings and merges defaults for missing keys", () => {
    const storage = memoryStorage();
    saveContentSettings(
      { ...DEFAULT_CONTENT_SETTINGS, text: "HELLO", lastBrightness: 0x40 },
      storage,
    );
    const loaded = loadContentSettings(storage);
    expect(loaded.text).toBe("HELLO");
    expect(loaded.lastBrightness).toBe(0x40);
    expect(loaded.imageFitMode).toBe("contain");
  });

  it("stores only small JSON, never binary media", () => {
    const storage = memoryStorage();
    saveContentSettings(
      { ...DEFAULT_CONTENT_SETTINGS, text: "HELLO" },
      storage,
    );
    const raw = [...storage.map.values()].join("");
    expect(raw.length).toBeLessThan(500);
  });

  it("falls back to defaults on corrupt or missing data", () => {
    const storage = memoryStorage();
    expect(loadContentSettings(storage)).toEqual(DEFAULT_CONTENT_SETTINGS);
    storage.setItem("matrixsmith:v2:content-settings", "{not json");
    expect(loadContentSettings(storage)).toEqual(DEFAULT_CONTENT_SETTINGS);
    storage.setItem(
      "matrixsmith:v2:content-settings",
      JSON.stringify({ schemaVersion: 99 }),
    );
    expect(loadContentSettings(storage)).toEqual(DEFAULT_CONTENT_SETTINGS);
  });

  it("truthfully reports a storage write failure", () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
    };
    expect(saveContentSettings(DEFAULT_CONTENT_SETTINGS, storage)).toEqual(
      expect.objectContaining({ ok: false, reason: "unavailable" }),
    );
  });
});
