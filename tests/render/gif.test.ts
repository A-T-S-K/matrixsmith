import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeGif,
  gifDelayMs,
  preflightGif,
  type GifDecoder,
  type GifDecoderConstructor,
} from "../../src/render/gif";

export function gifHeader(width = 2, height = 1): Blob {
  return new Blob([
    new Uint8Array([
      71,
      73,
      70,
      56,
      57,
      97,
      width & 255,
      width >> 8,
      height & 255,
      height >> 8,
    ]),
  ]);
}
function setup(count = 2) {
  const frame = {
    displayWidth: 2,
    displayHeight: 1,
    duration: 20_000,
    close: vi.fn(),
  };
  const decoder: GifDecoder = {
    complete: true,
    completed: Promise.resolve(),
    tracks: {
      ready: Promise.resolve(),
      selectedTrack: { frameCount: count, repetitionCount: Infinity },
    },
    decode: vi
      .fn()
      .mockImplementation(async () => ({ image: frame, complete: true })),
    close: vi.fn(),
  };
  const construct = vi.fn();
  class Decoder {
    static isTypeSupported = vi.fn().mockResolvedValue(true);
    constructor(options: unknown) {
      construct(options);
      return decoder;
    }
  }
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(8) })),
  };
  const canvas = vi.fn(() => ({ getContext: () => context }));
  vi.stubGlobal("document", { createElement: canvas });
  return {
    decoder,
    frame,
    construct,
    context,
    canvas,
    Decoder: Decoder as unknown as GifDecoderConstructor,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("GIF timing and preflight", () => {
  it.each([
    [null, 100],
    [undefined, 100],
    [0, 100],
    [-2, 100],
    [1, 1],
    [1499, 1],
    [1500, 2],
    [65_535_000, 65_535],
  ])("normalizes %s microseconds to %s ms", (input, expected) =>
    expect(gifDelayMs(input)).toBe(expected),
  );
  it.each([NaN, Infinity, -Infinity, 65_535_500])(
    "rejects malformed/unrepresentable duration %s",
    (input) => expect(() => gifDelayMs(input)).toThrow(),
  );
  it("accepts boundaries and rejects excess before proportional work", () => {
    expect(() => preflightGif(1000, 500, 48, 32, 16)).not.toThrow();
    expect(() => preflightGif(1, 1, 32, 32, 32)).not.toThrow();
    expect(() => preflightGif(1, 1, 49, 32, 16)).toThrow(/frame count/);
    expect(() => preflightGif(1001, 500, 48, 32, 16)).toThrow(/source work/);
    expect(() => preflightGif(1, 1, 33, 32, 32)).toThrow(/tile program/);
    for (const value of [
      0,
      -1,
      NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => preflightGif(value, 1, 1, 32, 16)).toThrow(/source width/);
    expect(() => preflightGif(1, 1, 0, 32, 16)).toThrow(/frame count/);
    expect(() => preflightGif(1, 1, 1, 0, 16)).toThrow(/target width/);
  });
});
describe("sequential local decoder", () => {
  it("rejects file size before any read", async () => {
    const file = {
      size: 8 * 1024 * 1024 + 1,
      arrayBuffer: vi.fn(),
      slice: vi.fn(),
    };
    await expect(decodeGif(file as unknown as Blob, 32, 16)).rejects.toThrow(
      /file size/,
    );
    expect(file.slice).not.toHaveBeenCalled();
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
  it("rejects oversized header before full read or codec construction", async () => {
    const { Decoder, construct } = setup();
    const file = gifHeader(65535, 65535);
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(decodeGif(file, 2, 1, { decoder: Decoder })).rejects.toThrow(
      /source work/,
    );
    expect(read).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });
  it("handles missing API/unsupported codec and malformed headers locally", async () => {
    vi.stubGlobal("ImageDecoder", undefined);
    await expect(decodeGif(gifHeader(), 2, 1)).rejects.toThrow(
      /current Chrome/,
    );
    const { Decoder, construct } = setup();
    vi.mocked(Decoder.isTypeSupported).mockResolvedValue(false);
    await expect(
      decodeGif(gifHeader(), 2, 1, { decoder: Decoder }),
    ).rejects.toThrow(/unavailable/);
    expect(construct).not.toHaveBeenCalled();
    await expect(
      decodeGif(new Blob(["bad"]), 2, 1, { decoder: Decoder }),
    ).rejects.toThrow(/valid GIF/);
    await expect(
      decodeGif(gifHeader(0), 2, 1, { decoder: Decoder }),
    ).rejects.toThrow(/source width/);
  });
  it.each([0, 49])(
    "rejects final frame count %s before canvas/decode",
    async (count) => {
      const s = setup(count);
      await expect(
        decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder }),
      ).rejects.toThrow(/frame count/);
      expect(s.canvas).not.toHaveBeenCalled();
      expect(s.decoder.decode).not.toHaveBeenCalled();
      expect(s.decoder.close).toHaveBeenCalledOnce();
    },
  );
  it("rejects incomplete/absent track metadata", async () => {
    const s = setup();
    Object.assign(s.decoder, { complete: false });
    await expect(
      decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder }),
    ).rejects.toThrow(/complete track/);
    Object.assign(s.decoder, { complete: true });
    Object.assign(s.decoder.tracks, { selectedTrack: null });
    await expect(
      decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder }),
    ).rejects.toThrow(/complete track/);
    expect(s.decoder.decode).not.toHaveBeenCalled();
  });
  it("waits for completion and uses the final count", async () => {
    const s = setup(1);
    let complete!: () => void;
    Object.assign(s.decoder, {
      completed: new Promise<void>((resolve) => {
        complete = resolve;
      }),
    });
    const pending = decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder });
    await vi.waitFor(() => expect(s.construct).toHaveBeenCalled());
    expect(s.decoder.decode).not.toHaveBeenCalled();
    Object.assign(s.decoder.tracks.selectedTrack!, { frameCount: 49 });
    complete();
    await expect(pending).rejects.toThrow(/frame count/);
    expect(s.decoder.decode).not.toHaveBeenCalled();
  });
  it("supervises independent metadata failure and closes", async () => {
    const s = setup();
    Object.assign(s.decoder, {
      completed: Promise.reject(new Error("bad metadata")),
    });
    // Start within the same turn so the deliberately rejected promise is observed.
    await expect(
      decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder }),
    ).rejects.toThrow(/bad metadata/);
    expect(s.decoder.close).toHaveBeenCalledOnce();
  });
  it("converts complete frames with stable sequence/timing and closes resources", async () => {
    const s = setup();
    const result = await decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder });
    expect(result).toMatchObject({
      frameCount: 2,
      totalDurationMs: 40,
      repetition: "infinite",
      targetWidth: 2,
    });
    expect(s.context.clearRect).toHaveBeenCalledTimes(2);
    expect(s.frame.close).toHaveBeenCalledTimes(2);
    expect(s.decoder.close).toHaveBeenCalledOnce();
    expect(s.construct).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/gif", preferAnimation: true }),
    );
    expect(s.decoder.decode).toHaveBeenNthCalledWith(2, {
      frameIndex: 1,
      completeFramesOnly: true,
    });
  });
  it.each(["dimension", "duration", "incomplete", "canvas"])(
    "closes consumed frame on %s error",
    async (kind) => {
      const s = setup();
      if (kind === "dimension") s.frame.displayWidth = 3;
      if (kind === "duration") s.frame.duration = Infinity;
      if (kind === "incomplete")
        vi.mocked(s.decoder.decode).mockResolvedValue({
          image: s.frame as unknown as VideoFrame,
          complete: false,
        });
      if (kind === "canvas")
        s.context.drawImage.mockImplementation(() => {
          throw new Error("canvas failed");
        });
      await expect(
        decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder }),
      ).rejects.toThrow();
      expect(s.frame.close).toHaveBeenCalledOnce();
      expect(s.decoder.close).toHaveBeenCalledOnce();
    },
  );
  it("stops stale work during decode and closes the returned frame", async () => {
    const s = setup();
    let current = true;
    vi.mocked(s.decoder.decode).mockImplementation(async () => {
      current = false;
      return { image: s.frame as unknown as VideoFrame, complete: true };
    });
    await expect(
      decodeGif(gifHeader(), 2, 1, {
        decoder: s.Decoder,
        isCurrent: () => current,
      }),
    ).rejects.toThrow(/obsolete/);
    expect(s.decoder.decode).toHaveBeenCalledOnce();
    expect(s.frame.close).toHaveBeenCalledOnce();
    expect(s.decoder.close).toHaveBeenCalledOnce();
  });
  it("abort closes pending metadata and supervises both close rejections", async () => {
    const s = setup();
    const abort = new AbortController();
    let rejectReady!: (error: Error) => void;
    let rejectComplete!: (error: Error) => void;
    Object.assign(s.decoder.tracks, {
      ready: new Promise<void>((_, reject) => {
        rejectReady = reject;
      }),
    });
    Object.assign(s.decoder, {
      completed: new Promise<void>((_, reject) => {
        rejectComplete = reject;
      }),
    });
    vi.mocked(s.decoder.close).mockImplementation(() => {
      rejectReady(new Error("closed"));
      rejectComplete(new Error("closed"));
    });
    const pending = decodeGif(gifHeader(), 2, 1, {
      decoder: s.Decoder,
      signal: abort.signal,
    });
    const result = expect(pending).rejects.toThrow(/closed/);
    await vi.waitFor(() => expect(s.construct).toHaveBeenCalled());
    abort.abort();
    await result;
    expect(s.decoder.close).toHaveBeenCalledOnce();
  });
});

it.each([
  {
    width: 1001,
    height: 500,
    count: 48,
    targetHeight: 16,
    error: /source work/,
  },
  { width: 2, height: 1, count: 33, targetHeight: 32, error: /tile program/ },
])(
  "rejects complete metadata budget before pixels: $error",
  async ({ width, height, count, targetHeight, error }) => {
    const s = setup(count);
    await expect(
      decodeGif(gifHeader(width, height), 32, targetHeight, {
        decoder: s.Decoder,
      }),
    ).rejects.toThrow(error);
    expect(s.canvas).not.toHaveBeenCalled();
    expect(s.decoder.decode).not.toHaveBeenCalled();
    expect(s.decoder.close).toHaveBeenCalledOnce();
  },
);
it.each([undefined, NaN, -1, Infinity, 0, 2])(
  "retains repetition metadata safely: %s",
  async (repetition) => {
    const s = setup(1);
    Object.assign(s.decoder.tracks.selectedTrack!, {
      repetitionCount: repetition,
    });
    const decoded = await decodeGif(gifHeader(), 2, 1, { decoder: s.Decoder });
    const expected =
      repetition === Infinity
        ? "infinite"
        : repetition === 0 || repetition === 2
          ? repetition
          : "unknown";
    expect(decoded.repetition).toBe(expected);
    expect(decoded.warnings.length).toBe(typeof expected === "number" ? 1 : 0);
    expect(JSON.stringify(decoded)).not.toContain("Infinity");
  },
);
