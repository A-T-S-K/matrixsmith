import { BrowserStorageRepository, type KeyValueStorage } from "./repository";

/**
 * Lightweight local presets for content settings. Small JSON only — image
 * pixels and GIF bytes never enter localStorage; only their configuration
 * (fit mode, colors, text) persists.
 */
const KEY = "matrixsmith:v1:content-settings";

export interface ContentSettings {
  readonly schemaVersion: 1;
  readonly text: string;
  readonly textColor: string;
  readonly textBackground: string;
  readonly textAlignment: "left" | "center" | "right";
  readonly textDisplayMode: "auto" | "still" | "scroll";
  readonly imageFitMode: "contain" | "cover" | "stretch" | "center";
  readonly imageMode: "auto" | "artwork" | "photo" | "pixel-art" | "legacy";
  readonly imageComposition: "contain" | "cover" | "foreground-trim" | "custom";
  readonly imageOpticalFit: boolean;
  readonly imageEdgeStrength: number;
  readonly imageZoom: number;
  readonly imageOffsetX: number;
  readonly imageOffsetY: number;
  readonly lastBrightness: number | null;
}

export const DEFAULT_CONTENT_SETTINGS: ContentSettings = Object.freeze({
  schemaVersion: 1,
  text: "",
  textColor: "#FF8800",
  textBackground: "#000000",
  textAlignment: "center",
  textDisplayMode: "auto",
  imageFitMode: "contain",
  imageMode: "auto",
  imageComposition: "contain",
  imageOpticalFit: false,
  imageEdgeStrength: 0.12,
  imageZoom: 1,
  imageOffsetX: 0,
  imageOffsetY: 0,
  lastBrightness: null,
});

export function loadContentSettings(storage?: KeyValueStorage): ContentSettings {
  try {
    const raw = new BrowserStorageRepository(storage).get(KEY);
    if (!raw) return DEFAULT_CONTENT_SETTINGS;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return DEFAULT_CONTENT_SETTINGS;
    return { ...DEFAULT_CONTENT_SETTINGS, ...(value as Partial<ContentSettings>), schemaVersion: 1 };
  } catch {
    return DEFAULT_CONTENT_SETTINGS;
  }
}

export function saveContentSettings(settings: ContentSettings, storage?: KeyValueStorage): void {
  try {
    new BrowserStorageRepository(storage).set(KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings simply don't persist.
  }
}
