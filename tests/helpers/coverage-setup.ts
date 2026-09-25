import { afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

afterAll(() => {
  if (process.env.VITE_COVERAGE !== "true") return;
  const coverage = (globalThis as unknown as { __coverage__?: unknown })
    .__coverage__;
  if (coverage) {
    mkdirSync("coverage/unit", { recursive: true });
    writeFileSync(
      `coverage/unit/${randomUUID()}.json`,
      JSON.stringify(coverage),
    );
  }
});
