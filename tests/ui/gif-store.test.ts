import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { createPresentationStore } from "../helpers/presentation-fixture";
import type { GifDecoder } from "../../src/render/gif";

const file = () =>
  new Blob([new Uint8Array([71, 73, 70, 56, 57, 97, 2, 0, 1, 0])]);
async function setup() {
  const transport = new FakeTransport(knownIledHatFingerprint());
  const runtime = new ApplicationRuntime(transport);
  await runtime.connect();
  const store = createPresentationStore(runtime, transport);
  const decoders: GifDecoder[] = [];
  const frames: { close: ReturnType<typeof vi.fn> }[] = [];
  class Decoder {
    static async isTypeSupported() {
      return true;
    }
    constructor() {
      const frame = {
        displayWidth: 2,
        displayHeight: 1,
        duration: 10_000,
        close: vi.fn(),
      };
      frames.push(frame);
      const decoder: GifDecoder = {
        complete: true,
        completed: Promise.resolve(),
        tracks: {
          ready: Promise.resolve(),
          selectedTrack: { frameCount: 1, repetitionCount: 0 },
        },
        decode: vi.fn().mockResolvedValue({ image: frame, complete: true }),
        close: vi.fn(),
      };
      decoders.push(decoder);
      return decoder;
    }
  }
  vi.stubGlobal("ImageDecoder", Decoder);
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(32 * 16 * 4) }),
      }),
    }),
  });
  return { store, runtime, decoders, frames };
}
afterEach(() => vi.unstubAllGlobals());
it("retains prior selection on failure, permits retry and holds sequence identity across traces", async () => {
  const { store, runtime } = await setup();
  await store.loadGif(file(), "valid");
  const selected = store.getSnapshot().content.gif!;
  await store.loadGif(new Blob(["broken"]), "broken");
  expect(store.getSnapshot().error).toMatch(/valid GIF/);
  expect(store.getSnapshot().content.gif).toBe(selected);
  runtime.trace.record("app.started", {});
  expect(store.getSnapshot().content.gif?.sequence).toBe(selected.sequence);
  await store.loadGif(file(), "retry");
  expect(store.getSnapshot().content.gif?.name).toBe("retry");
  expect(store.getSnapshot().error).toBeNull();
  await store.dispose();
});
it("new B aborts pending A and late A cannot overwrite B", async () => {
  const s = await setup();
  let resolve!: (result: { image: VideoFrame; complete: boolean }) => void;
  // Hold the first indexed decode while B replaces the selection.
  const original = file();
  const Native = globalThis as typeof globalThis & {
    ImageDecoder: new () => GifDecoder;
  };
  const Base = Native.ImageDecoder;
  class Paused {
    static async isTypeSupported() {
      return true;
    }
    constructor() {
      const d = new Base();
      if (s.decoders.length === 1)
        vi.mocked(d.decode).mockImplementation(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        );
      return d;
    }
  }
  vi.stubGlobal("ImageDecoder", Paused);
  const a = s.store.loadGif(original, "A");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await s.store.loadGif(file(), "B");
  expect(s.decoders[0]!.close).toHaveBeenCalledOnce();
  resolve({
    image: {
      displayWidth: 2,
      displayHeight: 1,
      duration: 10_000,
      close: s.frames[0]!.close,
    } as unknown as VideoFrame,
    complete: true,
  });
  await a;
  expect(s.store.getSnapshot().content.gif?.name).toBe("B");
  expect(s.frames[0]!.close).toHaveBeenCalledOnce();
  await s.store.dispose();
});
it.each(["profile", "disposal"])(
  "stops stale %s work and closes frame/decoder",
  async (kind) => {
    const s = await setup();
    let resolve!: (result: { image: VideoFrame; complete: boolean }) => void;
    const Base = (
      globalThis as typeof globalThis & { ImageDecoder: new () => GifDecoder }
    ).ImageDecoder;
    class Paused {
      static async isTypeSupported() {
        return true;
      }
      constructor() {
        const d = new Base();
        vi.mocked(d.decode).mockImplementation(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        );
        return d;
      }
    }
    vi.stubGlobal("ImageDecoder", Paused);
    const pending = s.store.loadGif(file(), "obsolete");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (kind === "profile")
      Object.assign(s.runtime.session, {
        profile: { ...s.runtime.session.profile!, width: 16 },
      });
    if (kind === "disposal") await s.store.dispose();
    resolve({
      image: {
        displayWidth: 2,
        displayHeight: 1,
        duration: 10_000,
        close: s.frames[0]!.close,
      } as unknown as VideoFrame,
      complete: true,
    });
    await pending;
    expect(s.store.getSnapshot().content.gif).toBeNull();
    expect(s.frames[0]!.close).toHaveBeenCalledOnce();
    expect(s.decoders[0]!.close).toHaveBeenCalledOnce();
    await s.store.dispose();
  },
);
it("blocks retained geometry mismatch at send without planning", async () => {
  const { store, runtime } = await setup();
  await store.loadGif(file(), "valid");
  Object.assign(runtime.session, {
    profile: { ...runtime.session.profile!, width: 16 },
  });
  const plan = vi.spyOn(runtime, "plan");
  store.requestSendGif();
  expect(plan).not.toHaveBeenCalled();
  expect(store.getSnapshot().sendAttempt?.failure?.message).toMatch(
    /another display size/,
  );
  await store.dispose();
});

it("workspace identity invalidates pending owner work", async () => {
  const s = await setup();
  const { ContentEditorStore } =
    await import("../../src/presentation/state/content-editor-store");
  let current = s.runtime;
  const editor = new ContentEditorStore(
    {
      workspaceStore: () => ({ getController: () => current }),
      snapshotStore: () => ({ _emit: () => {} }),
      noticeStore: () => ({
        setError: () => {},
        setInfo: () => {},
        _run: async (_label, action) => {
          await action();
        },
      }),
    },
    {
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    },
  );
  let resolve!: (result: { image: VideoFrame; complete: boolean }) => void;
  const Base = (
    globalThis as typeof globalThis & { ImageDecoder: new () => GifDecoder }
  ).ImageDecoder;
  class Paused {
    static async isTypeSupported() {
      return true;
    }
    constructor() {
      const d = new Base();
      vi.mocked(d.decode).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      return d;
    }
  }
  vi.stubGlobal("ImageDecoder", Paused);
  const pending = editor.loadGif(file(), "old workspace");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  current = new ApplicationRuntime(new FakeTransport());
  resolve({
    image: {
      displayWidth: 2,
      displayHeight: 1,
      duration: 10_000,
      close: s.frames[0]!.close,
    } as unknown as VideoFrame,
    complete: true,
  });
  await pending;
  expect(editor.getGifState()).toBeNull();
  expect(s.frames[0]!.close).toHaveBeenCalledOnce();
  expect(s.decoders[0]!.close).toHaveBeenCalledOnce();
  editor.dispose();
  await current.dispose();
  await s.store.dispose();
});

it("retains GIF sequence identity through upload failure and reconnect without sending", async () => {
  const s = await setup();
  await s.store.loadGif(file(), "kept.gif");
  const selected = s.store.getSnapshot().content.gif!;
  const send = vi
    .spyOn(s.runtime, "sendPersistentContent")
    .mockImplementation(async (_plan, options) => {
      options?.onExecutionStarted?.();
      s.runtime.transport.quarantine("scripted indeterminate upload");
      throw new Error("Unknown write outcome");
    });
  s.store.requestSendGif();
  await vi.waitFor(() =>
    expect(s.store.getSnapshot().sendAttempt?.failure?.stage).toBe("upload"),
  );
  expect(s.store.getSnapshot().content.gif).toBe(selected);
  await s.store.reconnectAndReviewDraft();
  expect(s.store.getSnapshot().sendAttempt?.phase).toBe("review");
  expect(s.store.getSnapshot().content.gif?.sequence).toBe(selected.sequence);
  expect(send).toHaveBeenCalledOnce();
  expect(s.decoders).toHaveLength(1);
  await s.store.dispose();
});
