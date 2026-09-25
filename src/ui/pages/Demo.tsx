import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { FrameSequence } from "../../render/frame-sequence";
import { diagnosticAnimation } from "../../render/patterns";
import { planRasterScroll } from "../../render/scroll";
import { FramePreview } from "../components/FramePreview";

const colors = {
  color: { r: 94, g: 234, b: 212 },
  background: { r: 0, g: 0, b: 0 },
};
const messages = ["MATRIXSMITH", "BSIDES ABQ", "LED MATRIX"].map(
  (message) => planRasterScroll(message, 32, 16, colors).sequence,
);
const diagnostic = diagnosticAnimation();
const sequence = new FrameSequence(
  [...messages.flatMap((message) => message.frames), ...diagnostic.frames],
  [...messages.flatMap((message) => message.timing), ...diagnostic.timing],
);

export function Demo(): JSX.Element {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % sequence.frames.length),
      sequence.timing[index]!.milliseconds,
    );
    return () => window.clearTimeout(timer);
  }, [index]);

  return (
    <main class="demo-page">
      <h1>MatrixSmith</h1>
      <div class="demo-matrix" data-frame={index}>
        <FramePreview
          frame={sequence.frames[index]!}
          label="MatrixSmith virtual matrix output"
          fill
          showSize={false}
        />
      </div>
    </main>
  );
}
