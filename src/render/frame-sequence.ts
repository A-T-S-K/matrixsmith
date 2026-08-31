import { Framebuffer } from "./framebuffer";

export interface FrameTiming {
  readonly milliseconds: number;
}

export class FrameSequence {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly Framebuffer[];
  readonly timing: readonly FrameTiming[];

  constructor(frames: readonly Framebuffer[], timing: readonly FrameTiming[]) {
    if (frames.length === 0) throw new RangeError("A frame sequence needs at least one frame.");
    if (frames.length !== timing.length) throw new RangeError("Each frame needs a timing entry.");
    const first = frames[0];
    if (!first) throw new RangeError("A frame sequence needs at least one frame.");
    if (frames.some((frame) => frame.width !== first.width || frame.height !== first.height)) {
      throw new RangeError("All sequence frames must have identical dimensions.");
    }
    if (timing.some(({ milliseconds }) => !Number.isInteger(milliseconds) || milliseconds <= 0)) {
      throw new RangeError("Frame timings must be positive integer milliseconds.");
    }
    this.width = first.width;
    this.height = first.height;
    this.frames = [...frames];
    this.timing = [...timing];
  }
}
