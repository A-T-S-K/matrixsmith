import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Independent boundary vectors: red first pixel, green last pixel of block 1.
const firstBlock = `BC 0F 01 FF 00 00 ${"00 ".repeat(90)}00 FF 00 55`;
const lastBlock = `BC 0F 08 ${"00 ".repeat(93)}11 22 33 55`;
for (const width of [390, 1280]) {
  test(`RGB reference uses the shared explorer at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/?offline=1");
    await page
      .getByRole("combobox", { name: "Implementation" })
      .selectOption("merkury");
    await page
      .getByRole("combobox", { name: "Example", exact: true })
      .selectOption("asymmetric");
    await expect(
      page.getByRole("img", {
        name: "asymmetric logical pixels, 16 columns and 16 rows",
      }),
    ).toBeVisible();
    await expect(page.locator("canvas")).toHaveAttribute("width", "16");
    await expect(page.locator("canvas")).toHaveAttribute("height", "16");
    expect(
      await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d")!;
        return [
          [0, 0],
          [15, 1],
          [0, 2],
          [15, 15],
        ].map(([x, y]) => [...ctx.getImageData(x!, y!, 1, 1).data]);
      }),
    ).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [17, 34, 51, 255],
    ]);
    const packets = page.getByRole("combobox", {
      name: "Packet index",
      exact: true,
    });
    await expect(packets.locator("option")).toHaveCount(8);
    await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
      firstBlock,
    );
    await packets.selectOption("7");
    await expect(page.getByLabel("Exact planned packet 7")).toHaveText(
      lastBlock,
    );
    await page.getByRole("button", { name: "Copy all planned bytes" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Exact planned bytes copied.",
    );
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.split("\n")).toHaveLength(8);
    expect(copied.split("\n")[0]).toBe(firstBlock);
    expect(copied.split("\n")[7]).toBe(lastBlock);
    expect(copied.replace(/\s/g, "")).toHaveLength(1600);
    expect(
      requests.some((url) => /application-bootstrap|knowledge/.test(url)),
    ).toBe(false);
    await page
      .getByText("Reference, sources and firmware limitations", { exact: true })
      .click();
    await expect(
      page.getByText(/Only the eight frame blocks are modeled/),
    ).toBeVisible();
    await expect(page.getByText(/offline placeholder/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "merkury-draw-file", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "merkury-show-image", exact: true }),
    ).toBeVisible();
    expect(
      await page.getByRole("button", { name: /send|connect/i }).count(),
    ).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    writeFileSync(
      `/tmp/matrixsmith-wave-merkury-${width}.aria.yml`,
      await page.locator("main").ariaSnapshot(),
    );
    await page.screenshot({
      path: `/tmp/matrixsmith-wave-merkury-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Implementation" })
      .selectOption("microbit");
    await expect(packets.locator("option")).toHaveCount(1);
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(page.getByLabel("Exact planned packet 0")).toHaveText(
      "00 00 00 00 00",
    );
  });
}
