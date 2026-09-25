import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Framebuffer } from "../../render/framebuffer";
import { toRgba } from "../../render/pixel-format";
import { FramePreview } from "./FramePreview";
import { Tabs } from "./Tabs";

export function ImagePreview({
  frame,
}: {
  readonly frame: Framebuffer;
}): JSX.Element {
  const [view, setView] = useState<"logical" | "led" | "apparent">("logical");
  return (
    <div class="image-preview-group">
      <Tabs
        label="Preview view"
        selected={view}
        onSelect={setView}
        class="segmented"
        items={[
          {
            id: "logical",
            label: "Logical matrix",
            panel: (
              <FramePreview
                frame={frame}
                label="Exact logical matrix preview"
              />
            ),
          },
          {
            id: "led",
            label: "Simulated LEDs",
            panel: <LedCanvas frame={frame} />,
          },
          {
            id: "apparent",
            label: "Apparent size",
            panel: (
              <FramePreview
                frame={frame}
                scale={1}
                label="Apparent-size preview"
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function LedCanvas({ frame }: { readonly frame: Framebuffer }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scale = 10;
    canvas.width = frame.width * scale;
    canvas.height = frame.height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#080a0c";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const rgba = toRgba(frame);
    for (let y = 0; y < frame.height; y += 1)
      for (let x = 0; x < frame.width; x += 1) {
        const i = (y * frame.width + x) * 4;
        const r = rgba[i] ?? 0;
        const g = rgba[i + 1] ?? 0;
        const b = rgba[i + 2] ?? 0;
        context.beginPath();
        context.fillStyle = `rgb(${r} ${g} ${b})`;
        context.shadowColor = context.fillStyle;
        context.shadowBlur = 3;
        context.arc(
          x * scale + scale / 2,
          y * scale + scale / 2,
          3.2,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
  }, [frame]);
  return (
    <div class="frame-preview" role="img" aria-label="Simulated LED preview">
      <canvas
        ref={ref}
        style={{ width: "100%", maxWidth: `${frame.width * 10}px` }}
      />
      <small>Approximate LED dots</small>
    </div>
  );
}
