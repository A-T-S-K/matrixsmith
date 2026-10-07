import { test as base, expect } from "@playwright/test";
import { writeQualificationCoverage } from "../helpers/qualification-paths";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    if (process.env.VITE_COVERAGE === "true" && testInfo.status !== "skipped") {
      const coverage = await page.evaluate(
        () =>
          (globalThis as unknown as { __coverage__?: unknown }).__coverage__,
      );
      expect(coverage, "Missing instrumented browser coverage").toBeTruthy();
      if (coverage) writeQualificationCoverage("browser", coverage);
    }
    expect(errors, "Unexpected browser errors or unhandled rejections").toEqual(
      [],
    );
  },
});
export { expect };
