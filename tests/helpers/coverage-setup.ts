import { afterAll } from "vitest";
import { writeQualificationCoverage } from "./qualification-paths";

afterAll(() => {
  if (process.env.VITE_COVERAGE !== "true") return;
  const coverage = (globalThis as unknown as { __coverage__?: unknown })
    .__coverage__;
  if (coverage) writeQualificationCoverage("unit", coverage);
});
