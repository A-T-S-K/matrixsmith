import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { compileAnimationStaticFrame } from "../../src/drivers/coolledux/content";
import { orientationPattern } from "../../src/render/patterns";
import type { ObservationValue } from "../../src/investigation/observations";
import { MINIMUM_STATIC_HOLD_MS } from "../../src/investigation/static-viability";

/**
 * The profile-maintenance smoke test exercises the PRODUCTION path.
 *
 * Every other guided test sends a fixed diagnostic program, so none of them
 * can catch a regression in how Create compiles an ordinary picture. This one
 * sends a plain ShowFrame and is judged on what the panel does with it.
 */

async function connected(): Promise<ApplicationRuntime> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new ApplicationRuntime(transport, new TraceRecorder());
  await controller.connect();
  return controller;
}

const timer = (fieldId: string, milliseconds: number): ObservationValue => ({
  kind: "duration",
  fieldId,
  milliseconds,
  measuredBy: "matrixsmith-timer",
});

function clean(heldMs = MINIMUM_STATIC_HOLD_MS + 1000): ObservationValue[] {
  return [
    { kind: "boolean", fieldId: "initial-correct", value: "yes" },
    timer("image-visible", 900),
    { kind: "boolean", fieldId: "moved", value: "no" },
    timer("observation-end", 900 + heldMs),
    { kind: "boolean", fieldId: "background-off", value: "yes" },
    { kind: "boolean", fieldId: "layout-correct", value: "yes" },
  ];
}

describe("the normal-image smoke test uses the production path", () => {
  it("plans a plain ShowFrame through the profile's own strategy", async () => {
    const controller = await connected();
    const plan = controller.planGuidedTest("coolledux-normal-image-smoke");
    expect(plan.operation.type).toBe("ShowFrame");
    expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
    expect(plan.metadata.contentType).toBe("animation");
    expect(plan.metadata.frameCount).toBe(1);
    // Byte-identical to what Create would compile for the same frame.
    const expected = compileAnimationStaticFrame(
      orientationPattern(32, 16),
      "single",
    );
    expect(plan.metadata.crc32).toBe(
      `0x${expected.crc32.toString(16).padStart(8, "0").toUpperCase()}`,
    );
    const createPlan = controller.plan({
      type: "ShowFrame",
      frame: orientationPattern(32, 16),
    });
    expect(plan.metadata.crc32).toBe(createPlan.metadata.crc32);
  }, 30000);

  it("is optional and never the automatic next step", async () => {
    const controller = await connected();
    const availability = controller
      .guidedTests()
      .find((entry) => entry.test.id === "coolledux-normal-image-smoke")!;
    expect(availability.test.category).toBe("optional");
    // Available — the substrate it depends on is trusted — but the engine
    // does not send anyone here on a characterized profile.
    expect(availability.available).toBe(true);
  }, 30000);

  it("promotes image.rendering only on a clean, sufficiently long observation", async () => {
    const controller = await connected();
    expect(
      controller.claims().find((claim) => claim.id === "image.rendering")
        ?.status,
    ).toBe("unknown");
    const completed = controller.recordGuidedTestObservations(
      "coolledux-normal-image-smoke",
      clean(),
      [],
    );
    expect(completed.status).toBe("passed");
    const state = controller
      .claims()
      .find((claim) => claim.id === "image.rendering");
    expect(state?.status).toBe("verified");
    expect(state?.decidedBy?.scope).toBe("current-session");
  }, 30000);

  it("stays retryable when the observation was too short to judge", async () => {
    const controller = await connected();
    const completed = controller.recordGuidedTestObservations(
      "coolledux-normal-image-smoke",
      clean(7000),
      [],
    );
    expect(completed.status).toBe("inconclusive");
    expect(completed.resolution).toBe("retryable-incomplete");
    // Nothing was concluded about the image path in either direction.
    expect(
      controller.claims().find((claim) => claim.id === "image.rendering")
        ?.status,
    ).toBe("unknown");
  }, 30000);

  it("rejects the image path when a normal image does not hold still", async () => {
    const controller = await connected();
    const completed = controller.recordGuidedTestObservations(
      "coolledux-normal-image-smoke",
      [
        { kind: "boolean", fieldId: "initial-correct", value: "yes" },
        timer("image-visible", 900),
        { kind: "boolean", fieldId: "moved", value: "yes" },
        timer("movement-start", 4000),
        { kind: "boolean", fieldId: "background-off", value: "yes" },
        { kind: "boolean", fieldId: "layout-correct", value: "yes" },
      ],
      [],
    );
    expect(completed.status).toBe("partial");
    expect(
      controller.claims().find((claim) => claim.id === "image.rendering")
        ?.status,
    ).toBe("rejected");
  }, 30000);

  it("does not judge colour quality", async () => {
    const controller = await connected();
    controller.recordGuidedTestObservations(
      "coolledux-normal-image-smoke",
      clean(),
      [],
    );
    // Calibration was unresolved before and stays unresolved: a smoke test
    // that started grading colour would be another characterization flow.
    expect(
      controller
        .claims()
        .find((claim) => claim.id === "pixel.color-calibration")?.status,
    ).toBe("unresolved");
  }, 30000);
});
