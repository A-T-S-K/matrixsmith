/**
 * Structured evidence about a compiled content program (static frame, text,
 * animation, GIF). Recorded whenever the CoolLEDUX compiler produces a
 * TransmissionPlan so reports can describe exactly what was built without
 * re-deriving it from raw packet hex.
 */
export interface ContentCompilationRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly operation: string;
  readonly contentType: "graffiti" | "animation" | "gif" | "text" | "frame-border";
  readonly profileId: string;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileCount: number;
  readonly programBytes: number;
  readonly crc32: number;
  readonly compressedBytes: number;
  readonly compression: "lzss-safe" | "lzss";
  readonly chunkCount: number;
  readonly pacingMs: number;
  readonly frameCount?: number;
  readonly frameDelaysMs?: readonly number[];
  readonly sourceDimensions?: string;
  readonly fitMode?: string;
  readonly textContent?: string;
  readonly textRendering?: string;
  readonly transactionId?: string;
}

export function contentCompilationId(): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `compilation:${value}`;
}
