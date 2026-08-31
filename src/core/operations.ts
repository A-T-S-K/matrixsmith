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
  | { readonly type: "ShowText"; readonly text: string; readonly frame?: Framebuffer };

export function operationName(operation: MatrixOperation): string {
  return operation.type;
}
