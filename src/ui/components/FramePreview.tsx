import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Framebuffer } from "../../render/framebuffer";
import { toRgba } from "../../render/pixel-format";

/**
 * Draws a logical framebuffer as a crisp, scaled LED-style preview. Host
 * preview only: no device color order or orientation is assumed.
 */
export function FramePreview({
  frame,
  scale = 8,
  label,
  fill = false,
  showSize = true,
}: {
  readonly frame: Framebuffer;
  readonly scale?: number;
  readonly label?: string;
  /** Fill the container width instead of using a fixed pixel scale. Region
   *  overlays position by percentage, so they only line up when the canvas
   *  and its container are the same box. */
  readonly fill?: boolean;
  readonly showSize?: boolean;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(toRgba(frame)),
        frame.width,
        frame.height,
      ),
      0,
      0,
    );
  }, [frame]);
  return (
    <div
      class="frame-preview"
      role="img"
      aria-label={label ?? `${frame.width}×${frame.height} preview`}
    >
      <canvas
        ref={canvasRef}
        style={
          fill
            ? { width: "100%", height: "auto", imageRendering: "pixelated" }
            : {
                width: `${frame.width * scale}px`,
                maxWidth: "100%",
                imageRendering: "pixelated",
              }
        }
      />
      {showSize && (
        <small>
          {frame.width}×{frame.height}
        </small>
      )}
    </div>
  );
}
