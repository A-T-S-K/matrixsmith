import type { RasterStrategy } from "./raster-strategy";

/**
 * Structured per-profile behavior/quirks model. This replaces scattered
 * `if (profile.id === …)` conditionals with declarative facts, and every
 * uncertain field represents "unknown" honestly instead of defaulting to an
 * optimistic value. Built-in quirks are immutable at runtime: session
 * evidence never mutates them, it lives beside them as claim evidence.
 */

export type BlackSemantics =
  | {
      readonly state: "true-black";
      readonly basis: "observed" | "source-derived";
    }
  | {
      readonly state: "white-sentinel";
      readonly basis: "observed" | "source-derived";
      readonly workaroundWord: number;
    }
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
  readonly channelMap: {
    readonly state: "rgb444-hypothesis" | "verified-rgb444" | "unknown";
    readonly notes?: string;
  };
  readonly whiteChannel: WhiteChannelState;
  readonly preferredRasterStrategy: RasterStrategy | "unresolved";
  readonly rasterStrategyCandidates: readonly RasterStrategy[];
  readonly contentLimits: readonly string[];
  /** Unexplained raw metadata carried without invented semantics. */
  readonly unexplained: Readonly<Record<string, number | string>>;
}

/**
 * Current honest state of the physical iLedHat 32×16 profile.
 *
 * Every field below is a physical observation from the 2026-09-01 guided
 * session on the exact unit, not an inherited upstream default. The two that
 * matter most for normal use are the ones that used to be guesses: this panel
 * renders a literal Graffiti 0x0000 as genuine black (so the inherited 0x0004
 * workaround must NOT be applied here), and neither justified Graffiti
 * playback configuration holds a still image (so Animation, not Graffiti, is
 * the static-image route).
 */
export const ILEDHAT_QUIRKS: ProfileQuirks = Object.freeze<ProfileQuirks>({
  tileWidth: 8,
  heightStride: 16,
  graffitiBlack: { state: "true-black", basis: "observed" },
  animationBlack: { state: "true-black", basis: "observed" },
  graffitiPlaybackNotes: [
    "mode=0, speed=0, stayTime=3: the raster rendered correctly, held visibly still for approximately 3.6 s, then began moving.",
    "mode=0, speed=0, stayTime=0: the raster rendered correctly, held visibly still for approximately 1.0 s, then began moving.",
    "Both justified Graffiti playback configurations move, so Graffiti is not a viable static-image route on this panel. Only these two configurations were tested; the semantics of the stayTime byte itself remain unknown.",
    "Upstream reference hardware reports mode=0 as Static; the cause of the movement on this exact iLedHat is unknown.",
  ],
  pixelFormat: "rgb444-16bit",
  channelMap: {
    state: "verified-rgb444",
    notes:
      "Physically confirmed on this panel: byte0 low nibble drives red, byte1 high nibble green, byte1 low nibble blue. The byte0 high nibble drives nothing — probes 0x1000 through 0xF000 were all observed off.",
  },
  // Not "unknown pending a test": the high nibble was swept and drove no
  // emitter, so there is no fourth channel to be white.
  whiteChannel: { state: "absent", basis: "observed" },
  preferredRasterStrategy: "animation-single-frame",
  // Graffiti is deliberately absent. It stays implemented for diagnostics,
  // protocol research and profiles whose evidence says it works; it is not a
  // candidate for NORMAL static routing on a panel where it was physically
  // rejected.
  rasterStrategyCandidates: [
    "animation-single-frame",
    "animation-identical-frames",
  ],
  contentLimits: [
    "One Graffiti/Animation segment renders at most 8 columns; wider content must tile.",
    "Native GIF is source-verified only inside the untiled ≤8-column zone.",
  ],
  unexplained: { colorModeRaw: 3, firmwareRaw: 30 },
});

/** Source-derived defaults for CoolLEDUX profiles with no physical characterization. */
export const COOLLEDUX_DEFAULT_QUIRKS: ProfileQuirks =
  Object.freeze<ProfileQuirks>({
    tileWidth: 8,
    heightStride: 16,
    graffitiBlack: {
      state: "white-sentinel",
      basis: "source-derived",
      workaroundWord: 0x0004,
    },
    animationBlack: { state: "true-black", basis: "source-derived" },
    graffitiPlaybackNotes: [],
    pixelFormat: "rgb444-16bit",
    channelMap: { state: "rgb444-hypothesis" },
    whiteChannel: { state: "unknown" },
    preferredRasterStrategy: "unresolved",
    rasterStrategyCandidates: [
      "graffiti",
      "animation-single-frame",
      "animation-identical-frames",
    ],
    contentLimits: [
      "One Graffiti/Animation segment renders at most 8 columns; wider content must tile.",
    ],
    unexplained: {},
  });
