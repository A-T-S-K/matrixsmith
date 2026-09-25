import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { FrameSequence } from "../../render/frame-sequence";
import { FramePreview } from "./FramePreview";

export function AnimatedFramePreview({
  sequence,
  label,
}: {
  readonly sequence: FrameSequence;
  readonly label: string;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setIndex(0);
    if (reduceMotion) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const advance = (current: number): void => {
      timer = setTimeout(() => {
        if (cancelled) return;
        const next = (current + 1) % sequence.frames.length;
        setIndex(next);
        advance(next);
      }, sequence.timing[current]?.milliseconds ?? 120);
    };
    advance(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sequence, reduceMotion]);
  return (
    <FramePreview
      frame={sequence.frames[index] ?? sequence.frames[0]!}
      label={label}
    />
  );
}
