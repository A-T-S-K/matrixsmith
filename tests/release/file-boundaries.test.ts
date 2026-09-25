import { afterEach, expect, it, vi } from "vitest";
import { decodeImageSource } from "../../src/render/image/decode";
import {
  DEFAULT_CONTENT_SETTINGS,
  saveContentSettings,
} from "../../src/storage/settings";

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: "image/png" });
}
afterEach(() => vi.unstubAllGlobals());
it("rejects excessive encoded dimensions before decoding", async () => {
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  await expect(decodeImageSource(png(100000, 100000))).rejects.toThrow(
    /24.megapixel/,
  );
  expect(decode).not.toHaveBeenCalled();
});
it("closes an oversized decoded bitmap without allocating a canvas", async () => {
  const close = vi.fn();
  const canvas = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 100000, height: 100000, close }),
  );
  vi.stubGlobal("OffscreenCanvas", canvas);
  await expect(decodeImageSource(png(32, 16))).rejects.toThrow(/24.megapixel/);
  expect(canvas).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it("rejects malformed encoded files before decoding", async () => {
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  await expect(decodeImageSource(new Blob(["not an image"]))).rejects.toThrow(
    /image/i,
  );
  expect(decode).not.toHaveBeenCalled();
});
it("reports unavailable storage instead of claiming success", () => {
  vi.stubGlobal("localStorage", undefined);
  expect(saveContentSettings(DEFAULT_CONTENT_SETTINGS)).toMatchObject({
    ok: false,
    reason: "unavailable",
  });
});
