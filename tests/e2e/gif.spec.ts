import { expect, test } from "./fixtures";
import { readFileSync } from "node:fs";

const fixture = readFileSync(
  new URL("../fixtures/gif/partial-disposal.gif", import.meta.url),
);
test("local GIF codec compositing, timing, preview and synchronized raster send", async ({
  page,
}) => {
  await page.goto("/?sim#/home");
  await page.getByRole("button", { name: "Connect a display" }).click();
  await page.getByRole("tab", { name: "GIF", exact: true }).click();
  await page
    .locator('input[type="file"][accept="image/gif,.gif"]')
    .setInputFiles({
      name: "partial-disposal.gif",
      mimeType: "image/gif",
      buffer: fixture,
    });
  await expect(page.getByLabel("Decoded GIF preview")).toBeVisible();
  await expect(
    page.getByText(/4×2 · 4 frames · 1 s · display 32×16/),
  ).toBeVisible();
  await expect(
    page.getByText(/finite source repetition cannot be preserved/),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        page
          .getByLabel("Decoded GIF preview")
          .locator("canvas")
          .evaluate(
            (canvas) =>
              (canvas as HTMLCanvasElement)
                .getContext("2d")!
                .getImageData(3, 3, 1, 1).data[1],
          ),
      { intervals: [25, 50, 100] },
    )
    .toBeGreaterThan(230);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .getByLabel("Decoded GIF preview")
        .locator("canvas")
        .evaluate(
          (canvas) =>
            (canvas as HTMLCanvasElement)
              .getContext("2d")!
              .getImageData(3, 3, 1, 1).data[1],
        ),
    )
    .toBe(0);
  const decoded = await page.evaluate(async (bytes) => {
    const path = "/src/render/gif.ts";
    const { decodeGif } = (await import(
      /* @vite-ignore */ path
    )) as typeof import("../../src/render/gif");
    const gif = await decodeGif(new Blob([new Uint8Array(bytes)]), 4, 2);
    const infiniteBytes = new Uint8Array(bytes);
    infiniteBytes[41] = 0; // NETSCAPE repetition zero means infinite.
    const infinite = await decodeGif(new Blob([infiniteBytes]), 4, 2);
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    const selected = store.getSnapshot().content.gif!;
    const plan = store.controller.plan({
      type: "ShowAnimation",
      sequence: selected.sequence,
    });
    const compilerPath = "/src/drivers/coolledux/content.ts";
    const { compileAnimation } = (await import(
      /* @vite-ignore */ compilerPath
    )) as typeof import("../../src/drivers/coolledux/content");
    const compiled = compileAnimation(selected.sequence);
    const view = new DataView(compiled.programBytes.buffer);
    const tiles = [];
    for (
      let offset = 10;
      offset < view.byteLength;
      offset += view.getUint32(offset)
    ) {
      tiles.push({
        column: view.getUint16(offset + 13),
        width: view.getUint16(offset + 17),
        count: view.getUint16(offset + 22),
        delays: Array.from({ length: 4 }, (_, index) =>
          view.getUint16(offset + 24 + index * 2),
        ),
      });
    }
    const stable =
      selected.sequence === store.getSnapshot().content.gif!.sequence;
    return {
      pixels: gif.sequence.frames.map((frame) => Array.from(frame.data)),
      delays: gif.sequence.timing.map((entry) => entry.milliseconds),
      repetition: gif.repetition,
      infiniteRepetition: infinite.repetition,
      infiniteWarnings: infinite.warnings,
      operation: plan.operation.type,
      validation: plan.validation,
      metadata: plan.metadata,
      stable,
      tiles,
      targetPixels: selected.sequence.frames.map((frame) => [
        frame.getPixel(3, 3),
        frame.getPixel(11, 3),
        frame.getPixel(31, 15),
      ]),
    };
  }, Array.from(fixture));
  const R = [255, 0, 0],
    G = [0, 255, 0],
    B = [0, 0, 255],
    K = [0, 0, 0];
  expect(decoded.pixels).toEqual([
    [R, R, R, R, R, R, R, K].flat(),
    [G, R, R, R, R, R, R, K].flat(),
    [R, B, R, R, R, R, R, K].flat(),
    [R, K, R, R, R, R, R, K].flat(),
  ]);
  expect(decoded.delays).toEqual([100, 200, 300, 400]);
  expect(decoded.repetition).toBe(1);
  expect(decoded.infiniteRepetition).toBe("infinite");
  expect(decoded.infiniteWarnings).toEqual([]);
  expect(decoded.operation).toBe("ShowAnimation");
  expect(decoded.validation).toBe("verified");
  expect(decoded.metadata).toMatchObject({
    contentType: "animation",
    tileCount: 4,
    tileWidth: 8,
    frameCount: 4,
  });
  expect(decoded.stable).toBe(true);
  expect(decoded.tiles).toEqual(
    [0, 8, 16, 24].map((column) => ({
      column,
      width: 8,
      count: 4,
      delays: [100, 200, 300, 400],
    })),
  );
  for (const [index, pixels] of decoded.targetPixels.entries()) {
    expect(pixels[2]).toEqual({ r: 0, g: 0, b: 0 });
    const first = index === 1 ? "g" : "r";
    expect(pixels[0]![first as "r" | "g"]).toBeGreaterThan(230);
    if (index === 2) expect(pixels[1]!.b).toBeGreaterThan(230);
    if (index === 3) expect(pixels[1]!.r).toBeLessThan(25);
  }
  await page
    .getByRole("button", { name: "Send to display", exact: true })
    .click();
  await expect(page.getByText("Upload sent.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const records = await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        matrixsmithStore: import("../../src/presentation/store").PresentationStore;
      }
    ).matrixsmithStore;
    return {
      records: store.controller.contentCompilations,
      bundle: store.controller.exportBundle(),
    };
  });
  expect(records.records.at(-1)).toMatchObject({
    operation: "ShowAnimation",
    contentType: "animation",
    originalContent: "gif",
    deliveryBackend: "local-gif-raster-animation",
    frameDelaysMs: [100, 200, 300, 400],
    sourceRepetition: 1,
    totalDurationMs: 1000,
    tileCount: 4,
  });
  expect(JSON.stringify(records.bundle)).not.toMatch(/gifBytes|GIF89a/);
});
