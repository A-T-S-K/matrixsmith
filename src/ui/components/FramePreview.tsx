import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Framebuffer } from "../../render/framebuffer";
import { toRgba } from "../../render/pixel-format";

/**
 * Draws a logical framebuffer as a crisp, scaled LED-style preview. Host
 * preview only: no device color order or orientation is assumed.
 */
export function FramePreview({ frame, scale = 8, label }: { readonly frame: Framebuffer; readonly scale?: number; readonly label?: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(toRgba(frame)), frame.width, frame.height), 0, 0);
  }, [frame]);
  return <div class="frame-preview" role="img" aria-label={label ?? `${frame.width}×${frame.height} preview`}>
    <canvas ref={canvasRef} style={{ width: `${frame.width * scale}px`, maxWidth: "100%", imageRendering: "pixelated" }}/>
    <small>{frame.width}×{frame.height}</small>
  </div>;
}
