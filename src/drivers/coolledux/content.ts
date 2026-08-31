import type { Framebuffer } from "../../render/framebuffer";
import type { FrameSequence } from "../../render/frame-sequence";
import { buildAnnouncePacket, buildDataChunkPackets, crc32Custom, lzssCompress, lzssCompressSafe, UX_CHUNK_DELAY_MS, UX_PACKAGE_SIZE, type DataChunk } from "./wire";
import { encodeFrameRegion } from "./pixels";

/**
 * CoolLEDUX stored-program content builders: Graffiti (static raw-pixel
 * frames), tiled pixel Animation, native GIF, and the decorative Frame
 * border. All content is tiled into <=8-column segments inside ONE program
 * because a single Graffiti/Animation segment renders only ~8 columns
 * regardless of its declared width (hardware-confirmed by the pinned
 * reference). Tiles keep the full profile height: the firmware assumes a
 * 16-row stride when decoding a segment's pixel stream.
 *
 * Dimensions always come from the caller (ultimately the DeviceProfile).
 * Nothing here assumes 64x16 or 32x16 globally.
 */

export const DEFAULT_TILE_WIDTH = 8;

export interface Tile {
  readonly startColumn: number;
  readonly width: number;
}

/** Split a canvas into <=tileWidth-column tiles; a non-multiple width yields a narrower final tile, never a crop. */
export function tileColumns(width: number, tileWidth = DEFAULT_TILE_WIDTH): readonly Tile[] {
  if (!Number.isInteger(width) || width <= 0) throw new RangeError("Canvas width must be a positive integer.");
  if (!Number.isInteger(tileWidth) || tileWidth <= 0) throw new RangeError("Tile width must be a positive integer.");
  const tiles: Tile[] = [];
  for (let startColumn = 0; startColumn < width; startColumn += tileWidth) {
    tiles.push({ startColumn, width: Math.min(tileWidth, width - startColumn) });
  }
  return tiles;
}

function u16be(value: number): [number, number] { return [(value >>> 8) & 0xff, value & 0xff]; }
function u32be(value: number): [number, number, number, number] { return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]; }
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/**
 * Graffiti segment (cmd 0x02): 7 zero bytes, layerType, startColumn/Row,
 * showWidth/Height, mode/speed/stayTime, an INNER 4-byte length prefixing
 * just the pixel stream, then the stream. mode MUST be 0 (Static): the
 * hardware ignores per-pixel color entirely under mode 2.
 */
export function graffitiSegment(pixelStream: Uint8Array, showWidth: number, showHeight: number, options: { startColumn?: number; startRow?: number; layerType?: number; mode?: number; speed?: number; stayTime?: number } = {}): Uint8Array {
  const { startColumn = 0, startRow = 0, layerType = 0, mode = 0, speed = 0, stayTime = 3 } = options;
  const payload = Uint8Array.of(
    0x02, 0, 0, 0, 0, 0, 0, 0,
    layerType & 0xff,
    ...u16be(startColumn), ...u16be(startRow), ...u16be(showWidth), ...u16be(showHeight),
    mode & 0xff, speed & 0xff, stayTime & 0xff,
    ...u32be(pixelStream.length),
    ...pixelStream,
  );
  return concat([Uint8Array.of(...u32be(payload.length + 4)), payload]);
}

/**
 * Animation segment (cmd 0x03 0x01 — a two-byte content tag): frame count,
 * per-frame delay list (u16 ms each), then the frames' pixel streams.
 */
export function animationSegment(frameStreams: readonly Uint8Array[], delaysMs: readonly number[], showWidth: number, showHeight: number, options: { startColumn?: number; startRow?: number; layerType?: number } = {}): Uint8Array {
  if (frameStreams.length !== delaysMs.length) throw new RangeError("Each animation frame needs a delay entry.");
  if (delaysMs.some((delay) => !Number.isInteger(delay) || delay <= 0 || delay > 0xffff)) throw new RangeError("Frame delays must be integers in 1..65535 ms.");
  const { startColumn = 0, startRow = 0, layerType = 1 } = options;
  const payload = concat([
    Uint8Array.of(
      0x03, 0x01, 0, 0, 0, 0, 0, 0,
      layerType & 0xff,
      ...u16be(startColumn), ...u16be(startRow), ...u16be(showWidth), ...u16be(showHeight),
      0x00, ...u16be(frameStreams.length),
      ...delaysMs.flatMap((delay) => u16be(delay)),
    ),
    ...frameStreams,
  ]);
  return concat([Uint8Array.of(...u32be(payload.length + 4)), payload]);
}

/**
 * GIF segment (cmd 0x0C): the literal raw bytes of a .gif file, unmodified.
 * The sign has a native GIF decoder (hardware-confirmed by the pinned
 * reference in its untiled <=8-column zone; wider canvases are untested).
 */
export function gifSegment(gifBytes: Uint8Array, showWidth: number, showHeight: number, options: { startColumn?: number; startRow?: number; layerType?: number } = {}): Uint8Array {
  const { startColumn = 0, startRow = 0, layerType = 0 } = options;
  const payload = concat([
    Uint8Array.of(
      0x0c, 0, 0, 0, 0, 0, 0, 0,
      layerType & 0xff, 0x00,
      ...u16be(startColumn), ...u16be(startRow), ...u16be(showWidth), ...u16be(showHeight),
      ...u32be(gifBytes.length),
    ),
    gifBytes,
  ]);
  return concat([Uint8Array.of(...u32be(payload.length + 4)), payload]);
}

/**
 * Decorative Frame border segment (cmd 0x04): border LED positions from a
 * color table, not a raster grid, so it never hits the 8-column segment cap.
 */
export function frameBorderSegment(table: Uint8Array, showWidth: number, showHeight: number, options: { layerType?: number; frameShowType?: number; speed?: number } = {}): Uint8Array {
  const { layerType = 0, frameShowType = 0, speed = 50 } = options;
  const payload = concat([
    Uint8Array.of(
      0x04, 0, 0, 0, 0, 0, 0, 0,
      layerType & 0xff,
      ...u16be(0), ...u16be(0), ...u16be(showWidth), ...u16be(showHeight),
      frameShowType & 0xff, speed & 0xff, 0x01,
      ...u16be(table.length),
    ),
    table,
  ]);
  return concat([Uint8Array.of(...u32be(payload.length + 4)), payload]);
}

/** The reference border color table (rainbow gradient around the perimeter). */
export const FRAME_TYPE_ONE_TABLE: Uint8Array = hexToBytes(
  "0f000f200f400f600f800fa00fc00ff00cf00af008f006f004f002f00"
  + "0f000f200f400f600f800fa00fc00ff00cf00af008f006f004f002f00"
  + "0f020f040f060f080f0a0f0c0f0f0f0f0c0f0a0f080f060f040f020f00",
);

/** Program container: 8 zero bytes, content-number byte, zero byte, then the segments. */
export function buildProgram(segments: readonly Uint8Array[]): Uint8Array {
  return concat([Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, segments.length & 0xff, 0x00), ...segments]);
}

export type CompressionMode = "lzss-safe" | "lzss";

export interface CompiledProgram {
  readonly programBytes: Uint8Array;
  readonly crc32: number;
  readonly compressedBytes: Uint8Array;
  readonly compression: CompressionMode;
  readonly announcePacket: Uint8Array;
  readonly chunks: readonly DataChunk[];
  /** announce + chunk packets in transmission order. */
  readonly packets: readonly Uint8Array[];
  readonly tileCount: number;
  readonly tileWidth: number;
  readonly pacingMs: number;
}

function compileProgram(segments: readonly Uint8Array[], compression: CompressionMode, tileWidth: number): CompiledProgram {
  const programBytes = buildProgram(segments);
  const compressedBytes = compression === "lzss-safe" ? lzssCompressSafe(programBytes) : lzssCompress(programBytes);
  const announcePacket = buildAnnouncePacket(programBytes, 0, 1, 1);
  const chunks = buildDataChunkPackets(compressedBytes, UX_PACKAGE_SIZE);
  return {
    programBytes, crc32: crc32Custom(programBytes), compressedBytes, compression, announcePacket, chunks,
    packets: [announcePacket, ...chunks.map((chunk) => chunk.packet)],
    tileCount: segments.length, tileWidth, pacingMs: UX_CHUNK_DELAY_MS,
  };
}

/**
 * Compile a full logical framebuffer into a tiled Graffiti program. Uses the
 * safe/all-literal compressor: hardware evidence shows back-reference LZSS is
 * unreliable for multi-color raw-pixel frames over write-without-response.
 */
export function compileGraffitiFrame(frame: Framebuffer, tileWidth = DEFAULT_TILE_WIDTH): CompiledProgram {
  const segments = tileColumns(frame.width, tileWidth).map((tile) =>
    graffitiSegment(encodeFrameRegion(frame, tile.startColumn, tile.width, "graffiti"), tile.width, frame.height, { startColumn: tile.startColumn }));
  return compileProgram(segments, "lzss-safe", tileWidth);
}

/**
 * Compile a frame sequence into a tiled pixel Animation program. Every tile
 * carries the full frame sequence with an identical delay list so the sign
 * plays all tiles back in lockstep on its own.
 */
export function compileAnimation(sequence: FrameSequence, tileWidth = DEFAULT_TILE_WIDTH): CompiledProgram {
  const delays = sequence.timing.map(({ milliseconds }) => milliseconds);
  const segments = tileColumns(sequence.width, tileWidth).map((tile) =>
    animationSegment(
      sequence.frames.map((frame) => encodeFrameRegion(frame, tile.startColumn, tile.width, "animation")),
      delays, tile.width, sequence.height, { startColumn: tile.startColumn },
    ));
  return compileProgram(segments, "lzss-safe", tileWidth);
}

/** Compile raw GIF bytes into a single-segment program (untiled: tiling GIF content is untested upstream). */
export function compileGif(gifBytes: Uint8Array, showWidth: number, showHeight: number): CompiledProgram {
  return compileProgram([gifSegment(gifBytes, showWidth, showHeight)], "lzss-safe", showWidth);
}

/** Compile the decorative frame border as a standalone single-segment program. */
export function compileFrameBorder(showWidth: number, showHeight: number, table: Uint8Array = FRAME_TYPE_ONE_TABLE): CompiledProgram {
  return compileProgram([frameBorderSegment(table, showWidth, showHeight)], "lzss-safe", showWidth);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new RangeError("Hex string must have an even length.");
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
