import type { RasterStrategy } from "./raster-strategy";

/**
 * Structured per-profile behavior/quirks model. This replaces scattered
 * `if (profile.id === …)` conditionals with declarative facts, and every
 * uncertain field represents "unknown" honestly instead of defaulting to an
 * optimistic value. Built-in quirks are immutable at runtime: session
 * evidence never mutates them, it lives beside them as claim evidence.
 */

export type BlackSemantics =
  | { readonly state: "true-black"; readonly basis: "observed" | "source-derived" }
  | { readonly state: "white-sentinel"; readonly basis: "observed" | "source-derived"; readonly workaroundWord: number }
  | { readonly state: "unknown" };

export type WhiteChannelState =
  | { readonly state: "present"; readonly basis: "observed" }
  | { readonly state: "absent"; readonly basis: "observed" }
  | { readonly state: "unknown"; readonly hypothesis?: string };

export interface ProfileQuirks {
  /** Maximum columns one Graffiti/Animation segment renders. */
  readonly tileWidth: number;
  /** Firmware decodes segment pixel streams assuming this row stride. */
  readonly heightStride: number;
  readonly graffitiBlack: BlackSemantics;
  readonly animationBlack: BlackSemantics;
  /** Honest free-text notes about observed Graffiti playback behavior. */
  readonly graffitiPlaybackNotes: readonly string[];
  readonly pixelFormat: "rgb444-16bit" | "unknown";
  /** Channel map of the 16-bit pixel word, or unknown until characterized. */
  readonly channelMap: { readonly state: "rgb444-hypothesis" | "verified-rgb444" | "unknown"; readonly notes?: string };
  readonly whiteChannel: WhiteChannelState;
  readonly preferredRasterStrategy: RasterStrategy | "unresolved";
  readonly rasterStrategyCandidates: readonly RasterStrategy[];
  readonly contentLimits: readonly string[];
  /** Unexplained raw metadata carried without invented semantics. */
  readonly unexplained: Readonly<Record<string, number | string>>;
}

/** Current honest state of the physical iLedHat 32×16 profile. */
export const ILEDHAT_QUIRKS: ProfileQuirks = Object.freeze<ProfileQuirks>({
  tileWidth: 8,
  heightStride: 16,
  graffitiBlack: { state: "unknown" },
  animationBlack: { state: "true-black", basis: "observed" },
  graffitiPlaybackNotes: [
    "With mode=0, speed=0, stayTime=3 the tiled raster initially rendered correctly, then began moving in a deterministic cycle (movement, blank interval, wrap/re-entry, reconstruction).",
    "Upstream reference hardware reports mode=0 as Static; the cause of the movement on this exact iLedHat is unknown.",
  ],
  pixelFormat: "rgb444-16bit",
  channelMap: { state: "rgb444-hypothesis", notes: "byte0 low nibble R, byte1 high nibble G, byte1 low nibble B per the pinned source; not physically confirmed on this panel, and RGB-max white looks non-neutral here." },
  whiteChannel: { state: "unknown", hypothesis: "The LED package may contain a dedicated white emitter; the byte0 high nibble is unused by the current encoding. Untested." },
  preferredRasterStrategy: "unresolved",
  rasterStrategyCandidates: ["graffiti", "animation-single-frame", "animation-identical-frames"],
  contentLimits: [
    "One Graffiti/Animation segment renders at most 8 columns; wider content must tile.",
    "Native GIF is source-verified only inside the untiled ≤8-column zone.",
  ],
  unexplained: { colorModeRaw: 3, firmwareRaw: 30 },
});

/** Source-derived defaults for CoolLEDUX profiles with no physical characterization. */
export const COOLLEDUX_DEFAULT_QUIRKS: ProfileQuirks = Object.freeze<ProfileQuirks>({
  tileWidth: 8,
  heightStride: 16,
  graffitiBlack: { state: "white-sentinel", basis: "source-derived", workaroundWord: 0x0004 },
  animationBlack: { state: "true-black", basis: "source-derived" },
  graffitiPlaybackNotes: [],
  pixelFormat: "rgb444-16bit",
  channelMap: { state: "rgb444-hypothesis" },
  whiteChannel: { state: "unknown" },
  preferredRasterStrategy: "unresolved",
  rasterStrategyCandidates: ["graffiti", "animation-single-frame", "animation-identical-frames"],
  contentLimits: ["One Graffiti/Animation segment renders at most 8 columns; wider content must tile."],
  unexplained: {},
});
