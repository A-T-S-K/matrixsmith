import { expect, it, vi } from "vitest";
import {
  inspectImageDimensions,
  validateImageDimensions,
} from "../../src/render/image/dimensions";
import {
  readBoundedText,
  FileActivity,
} from "../../src/application/file-input";

function webp(kind: string, size: number) {
  const bytes = new Uint8Array(20 + size);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WEBP"],
    [12, kind],
  ] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, size, true);
  return bytes;
}
it("reads JPEG frame dimensions past metadata and standalone markers", async () => {
  const bytes = Uint8Array.from([
    255, 216, 255, 255, 1, 255, 224, 0, 4, 0, 0, 255, 192, 0, 8, 8, 0, 16, 0,
    32, 1,
  ]);
  await expect(
    inspectImageDimensions(new Blob([bytes])),
  ).resolves.toBeUndefined();
  bytes[16] = 255;
  bytes[17] = 255;
  bytes[18] = 255;
  bytes[19] = 255;
  await expect(inspectImageDimensions(new Blob([bytes]))).rejects.toThrow(
    /24.megapixel/,
  );
});
it("handles extended, lossy, and lossless WebP headers", async () => {
  const extended = webp("VP8X", 10);
  await expect(
    inspectImageDimensions(new Blob([extended])),
  ).resolves.toBeUndefined();
  extended.set([255, 255, 255], 24);
  extended.set([255, 255, 255], 27);
  await expect(inspectImageDimensions(new Blob([extended]))).rejects.toThrow(
    /24.megapixel/,
  );
  const lossy = webp("VP8 ", 10);
  lossy.set([157, 1, 42, 32, 0, 16, 0], 23);
  await expect(
    inspectImageDimensions(new Blob([lossy])),
  ).resolves.toBeUndefined();
  const lossless = webp("VP8L", 5);
  lossless[20] = 47;
  await expect(
    inspectImageDimensions(new Blob([lossless])),
  ).resolves.toBeUndefined();
  lossless[4] = 255;
  await expect(inspectImageDimensions(new Blob([lossless]))).rejects.toThrow(
    /truncated/,
  );
});
it("rejects zero, fractional, nonfinite, and excessive dimensions", () => {
  for (const [width, height] of [
    [0, 1],
    [-1, 1],
    [1.2, 1],
    [NaN, 2],
    [1, Infinity],
  ])
    expect(() => validateImageDimensions(width!, height!)).toThrow(/invalid/);
  expect(() => validateImageDimensions(6000, 4000)).not.toThrow();
  expect(() => validateImageDimensions(6000, 4001)).toThrow(/24.megapixel/);
});
it("checks file length before invoking any read", async () => {
  const text = vi.fn(),
    slice = vi.fn();
  const huge = { size: 26 * 1024 * 1024, text, slice } as unknown as Blob;
  await expect(readBoundedText(huge, "bundle")).rejects.toThrow(/10 MiB/);
  await expect(readBoundedText(huge, "capture")).rejects.toThrow(/25 MiB/);
  await expect(inspectImageDimensions(huge)).rejects.toThrow(/25 MiB/);
  expect(text).not.toHaveBeenCalled();
  expect(slice).not.toHaveBeenCalled();
  await expect(readBoundedText(new Blob(["valid"]), "bundle")).resolves.toBe(
    "valid",
  );
});
it("file activity remains busy until every pending selection settles", async () => {
  const activity = new FileActivity();
  let finish!: () => void;
  const first = activity.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(
    activity.run(() => {
      throw new Error("bad file");
    }),
  ).rejects.toThrow("bad file");
  expect(activity.active).toBe(true);
  finish();
  await first;
  expect(activity.active).toBe(false);
});
