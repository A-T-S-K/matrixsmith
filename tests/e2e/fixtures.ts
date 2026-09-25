import { test as base, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    if (process.env.VITE_COVERAGE === "true") {
      const coverage = await page.evaluate(
        () =>
          (globalThis as unknown as { __coverage__?: unknown }).__coverage__,
      );
      if (coverage) {
        mkdirSync("coverage/browser", { recursive: true });
        writeFileSync(
          `coverage/browser/${randomUUID()}.json`,
          JSON.stringify(coverage),
        );
      }
    }
    expect(errors, "Unexpected browser errors or unhandled rejections").toEqual(
      [],
    );
  },
});
export { expect };
