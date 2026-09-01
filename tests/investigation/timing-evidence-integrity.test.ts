import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { MINIMUM_STATIC_HOLD_MS } from "../../src/investigation/static-viability";
import type { ObservationValue } from "../../src/investigation/observations";

/**
 * The hardened evidence rules must survive the forgiving timing UX. A missed
 * human measurement is an absent measurement — it may not verify stability,
 * and it may not reject it either.
 */
async function connectedController(): Promise<MatrixController> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  await controller.runDiagnostic("coolledux-identify");
  return controller;
}

function timer(fieldId: string, milliseconds: number): ObservationValue {
  return { kind: "duration", fieldId, milliseconds, measuredBy: "matrixsmith-timer" };
}

const evidenceFor = (controller: MatrixController, claimId: string) =>
  (controller.investigation?.claimEvidence ?? []).filter((entry) => entry.claimId === claimId);

describe("timing evidence integrity", () => {
  it("verifies stability only from a valid attempt that reached the 15s window", async () => {
    const controller = await connectedController();
    controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1200),
      { kind: "boolean", fieldId: "moved", value: "no" },
      timer("observation-end", 1200 + MINIMUM_STATIC_HOLD_MS + 200),
    ], []);
    expect(evidenceFor(controller, "graffiti.playback-stability")[0]?.status).toBe("verified");
  }, 30000);

  it("does not verify stability when the observation stopped short of the window", async () => {
    const controller = await connectedController();
    controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1200),
      { kind: "boolean", fieldId: "moved", value: "no" },
      timer("observation-end", 5200),
    ], []);
    expect(evidenceFor(controller, "graffiti.playback-stability")[0]?.status).toBe("unresolved");
  }, 30000);

  it("a discarded attempt contributes no observations, so it can neither verify nor reject", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
    await store.connect();
    await store.identify();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.recordGuidedTimeline("event");
    store.markObservationMissed("missed-t2");
    // Everything the attempt wrote is gone: "I missed movement" must not read
    // as "movement did not occur", nor as "the image was never correct".
    const values = store.getSnapshot().guidedFlow!.values;
    expect(values["moved"]).toBeUndefined();
    expect(values["initial-correct"]).toBeUndefined();
    expect(values["image-visible"]).toBeUndefined();
  }, 30000);

  it("keeps invalid attempts in the report while excluding them from the conclusion", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
    await store.connect();
    await store.identify();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    for (const step of store.getSnapshot().guidedFlow!.steps) {
      if (step.spec.kind === "boolean") store.setGuidedObservation({ kind: "boolean", fieldId: step.spec.id, value: "yes" });
      if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.options[0]!.id });
    }
    store.submitGuidedObservations();
    const report = store.controller.testReportMarkdown("coolledux-graffiti-timing");
    expect(report).toContain("Attempts (2; 1 valid)");
    expect(report).toContain("INVALID");
    expect(report).toContain("Excluded from conclusions.");
    expect(report).toContain("the measurement failed, not that the display behaved differently");
  }, 30000);
});

describe("report labelling of spatial observations", () => {
  it("names the human zone in physical observations while keeping the raw word in technical evidence", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
    await store.connect();
    await store.identify();
    store.startGuidedTest("coolledux-pixel-channels");
    await store.confirmGuidedTransfer();
    for (const step of store.getSnapshot().guidedFlow!.steps) {
      if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.id === "patch-0x0000" ? "off" : "red" });
    }
    store.submitGuidedObservations();
    const report = store.controller.testReportMarkdown("coolledux-pixel-channels");
    // Without the zone name every one of the eleven answers would read alike.
    expect(report).toContain("Zone 2 · Red test — What color is this zone");
    expect(report).toContain("Zone 6 · Extra channel A");
    // The exact protocol values remain in the report as evidence.
    expect(report).toContain("0x1000");
  }, 30000);
});
