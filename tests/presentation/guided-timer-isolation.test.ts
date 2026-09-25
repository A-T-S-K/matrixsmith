import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string): string =>
  readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

describe("guided timer presentation isolation", () => {
  it("does not drive the application snapshot from a polling interval", () => {
    for (const file of [
      "presentation/state/snapshot-store.ts",
      "presentation/state/guided-controller.ts",
      "presentation/state/guided-projection-store.ts",
    ]) {
      expect(source(file), file).not.toContain("setInterval(");
      expect(source(file), file).not.toContain("_timerInterval");
    }
  });

  it("keeps the 100 ms display clock inside TimedObservation", () => {
    const component = source("ui/components/observation/TimedObservation.tsx");
    expect(component).toContain("useState");
    expect(component).toContain("setInterval");
    expect(component).toContain("clearInterval");
    expect(component).not.toContain("store._emit");
  });

  it("renders a modeled failed transfer with retry gated by retryability", () => {
    const dialog = source("ui/components/GuidedTestDialog.tsx");
    expect(dialog).toContain('flow.stage === "failed"');
    expect(dialog).toContain("flow.failure?.retryable");
    expect(dialog).toContain("retryFailedGuidedTransfer");
  });
});
