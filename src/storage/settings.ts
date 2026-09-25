import {
  BrowserStorageRepository,
  storageFailure,
  type KeyValueStorage,
  type PersistenceResult,
} from "./repository";

/**
 * Lightweight local presets for content settings. Small JSON only — image
 * pixels and GIF bytes never enter localStorage; only their configuration
 * (fit mode, colors, text) persists.
 */
export const CONTENT_SETTINGS_KEY = "matrixsmith:v2:content-settings";

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

export function loadContentSettings(
  storage?: KeyValueStorage,
): ContentSettings {
  try {
    const raw = new BrowserStorageRepository(storage).get(CONTENT_SETTINGS_KEY);
    if (!raw) return DEFAULT_CONTENT_SETTINGS;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 1
    )
      return DEFAULT_CONTENT_SETTINGS;
    if (!validSettings(value)) return DEFAULT_CONTENT_SETTINGS;
    return value;
  } catch {
    return DEFAULT_CONTENT_SETTINGS;
  }
}

export function saveContentSettings(
  settings: ContentSettings,
  storage?: KeyValueStorage,
): PersistenceResult {
  try {
    if (!validSettings(settings))
      return {
        ok: false,
        reason: "invalid-data",
        message: "Content settings are invalid.",
      };
    new BrowserStorageRepository(storage).set(
      CONTENT_SETTINGS_KEY,
      JSON.stringify(settings),
    );
    return { ok: true };
  } catch (error) {
    return storageFailure(error);
  }
}

function validSettings(value: unknown): value is ContentSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    ["text", "textColor", "textBackground"].every(
      (key) => typeof v[key] === "string",
    ) &&
    ["left", "center", "right"].includes(String(v.textAlignment)) &&
    ["auto", "still", "scroll"].includes(String(v.textDisplayMode)) &&
    ["contain", "cover", "stretch", "center"].includes(
      String(v.imageFitMode),
    ) &&
    ["auto", "artwork", "photo", "pixel-art", "legacy"].includes(
      String(v.imageMode),
    ) &&
    ["contain", "cover", "foreground-trim", "custom"].includes(
      String(v.imageComposition),
    ) &&
    typeof v.imageOpticalFit === "boolean" &&
    ["imageEdgeStrength", "imageZoom", "imageOffsetX", "imageOffsetY"].every(
      (key) => typeof v[key] === "number" && Number.isFinite(v[key]),
    ) &&
    (v.lastBrightness === null ||
      (typeof v.lastBrightness === "number" &&
        Number.isInteger(v.lastBrightness) &&
        v.lastBrightness >= 0 &&
        v.lastBrightness <= 255))
  );
}
