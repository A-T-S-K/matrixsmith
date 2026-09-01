import type { Framebuffer } from "../render/framebuffer";
import type { FrameSequence } from "../render/frame-sequence";

export type DisplayMode = "static" | "left" | "right" | "up" | "down" | "snowflake" | "picture" | "laser";

export type MatrixOperation =
  | { readonly type: "GetDeviceInfo" }
  | { readonly type: "SetBrightness"; readonly raw: number }
  | { readonly type: "SetScrollSpeed"; readonly raw: number }
  | { readonly type: "SetDisplayMode"; readonly mode: DisplayMode }
  | { readonly type: "SetPower"; readonly on: boolean }
  | { readonly type: "ShowFrame"; readonly frame: Framebuffer }
  | { readonly type: "ShowAnimation"; readonly sequence: FrameSequence }
  | { readonly type: "ShowText"; readonly text: string; readonly frame?: Framebuffer }
  | { readonly type: "ShowScrollingText"; readonly text: string; readonly sequence: FrameSequence; readonly backend: "raster" }
  | { readonly type: "ShowGif"; readonly gifBytes: Uint8Array; readonly width: number; readonly height: number }
  /**
   * Fixed driver-defined diagnostic content. The diagnosticId selects one of
   * the driver's own deterministic programs (e.g. the Graffiti black probe);
   * parameters are limited to the numeric knobs that diagnostic declares.
   * This is NOT a raw writer: arbitrary bytes or pixel words cannot be
   * injected through it.
   */
  | { readonly type: "ShowDiagnostic"; readonly diagnosticId: string; readonly parameters?: Readonly<Record<string, number>> };

export function operationName(operation: MatrixOperation): string {
  return operation.type;
}
