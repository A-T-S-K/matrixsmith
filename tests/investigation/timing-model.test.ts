import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import type { ObservationValue } from "../../src/investigation/observations";

async function connectedController(): Promise<MatrixController> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  return controller;
}

function timer(fieldId: string, milliseconds: number): ObservationValue {
  return { kind: "duration", fieldId, milliseconds, measuredBy: "matrixsmith-timer" };
}

function claimEvidence(controller: MatrixController, claimId: string) {
  return controller.investigation?.claimEvidence.filter((entry) => entry.claimId === claimId) ?? [];
}

describe("T0/T1/T2 static timing model", () => {
  it("derives render latency and visible static hold from measured T1/T2", async () => {
    const controller = await connectedController();
    const completed = controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1420),
      { kind: "boolean", fieldId: "moved", value: "yes" },
      timer("movement-start", 4650),
    ], []);
    expect(completed.status).toBe("partial");
    const render = claimEvidence(controller, "graffiti.initial-render")[0];
    expect(render?.metrics?.renderLatencyMs).toBe(1420);
    const stability = claimEvidence(controller, "graffiti.playback-stability")[0];
    // Undecided, not contradicted: the other justified configuration is untested.
    expect(stability?.status).toBe("unknown");
    expect(stability?.metrics?.movementOnsetFromUploadMs).toBe(4650);
    // Hold is measured from T1, never from T0.
    expect(stability?.metrics?.visibleStaticHoldMs).toBe(4650 - 1420);
  });

  it("verifies stability only with a measured hold of at least 15 seconds from T1", async () => {
    const controller = await connectedController();
    controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1000),
      { kind: "boolean", fieldId: "moved", value: "no" },
      timer("observation-end", 16200),
    ], []);
    const stability = claimEvidence(controller, "graffiti.playback-stability")[0];
    expect(stability?.status).toBe("verified");
    expect(stability?.metrics?.visibleStaticHoldMs).toBe(15200);
  });

  it("records an early stop as unresolved with the exact measured duration", async () => {
    const controller = await connectedController();
    const completed = controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1000),
      { kind: "boolean", fieldId: "moved", value: "no" },
      timer("observation-end", 9000),
    ], []);
    expect(completed.status).toBe("inconclusive");
    const stability = claimEvidence(controller, "graffiti.playback-stability")[0];
    expect(stability?.status).toBe("unresolved");
    expect(stability?.metrics?.visibleStaticHoldMs).toBe(8000);
  });

  it("never verifies stability from a bare didn't-move answer", async () => {
    const controller = await connectedController();
    const completed = controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "boolean", fieldId: "moved", value: "no" },
    ], []);
    expect(completed.status).toBe("inconclusive");
    expect(claimEvidence(controller, "graffiti.playback-stability")[0]?.status).toBe("unresolved");
  });

  it("never verifies stability from a user-estimated duration", async () => {
    const controller = await connectedController();
    controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "duration", fieldId: "image-visible", milliseconds: 1000, measuredBy: "user-estimate" },
      { kind: "boolean", fieldId: "moved", value: "no" },
      { kind: "duration", fieldId: "observation-end", milliseconds: 60000, measuredBy: "user-estimate" },
    ], []);
    expect(claimEvidence(controller, "graffiti.playback-stability")[0]?.status).toBe("unresolved");
  });

  it("rejects stability only at the stayTime=0 discriminator", async () => {
    const controller = await connectedController();
    // Baseline (stayTime=3) movement: unresolved, not rejected.
    controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1400), { kind: "boolean", fieldId: "moved", value: "yes" }, timer("movement-start", 4600),
    ], []);
    // Baseline movement leaves the claim UNDECIDED rather than contradicted:
    // one justified configuration moved, the other is untested. Recording it
    // as contradicted would outrank a later verification and stop the
    // discriminator from settling the question it exists to settle.
    expect(controller.claims().find((claim) => claim.id === "graffiti.playback-stability")?.status).toBe("unknown");
    // stayTime=0 also moves: both justified configurations exhausted.
    controller.recordGuidedTestObservations("coolledux-graffiti-staytime", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1400), { kind: "boolean", fieldId: "moved", value: "yes" }, timer("movement-start", 2400),
    ], []);
    expect(controller.claims().find((claim) => claim.id === "graffiti.playback-stability")?.status).toBe("rejected");
  });
});

describe("domain-layer observation validation", () => {
  it("rejects a submission with an unknown field", async () => {
    const controller = await connectedController();
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "boolean", fieldId: "made-up-field", value: "yes" },
    ], [])).toThrow(/unknown observation field/i);
  });

  it("rejects a missing required field", async () => {
    const controller = await connectedController();
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
    ], [])).toThrow(/required observation "workaround-appearance"/i);
  });

  it("rejects a kind mismatch and invalid choice options", async () => {
    const controller = await connectedController();
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "boolean", fieldId: "zero-appearance", value: "yes" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "off-black" },
    ], [])).toThrow(/expects kind "choice"/i);
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "nonexistent-option" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "off-black" },
    ], [])).toThrow(/no option/i);
  });

  it('rejects "other" without a description', async () => {
    const controller = await connectedController();
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "other" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "off-black" },
    ], [])).toThrow(/without describing/i);
  });

  it("rejects negative durations and incoherent timelines", async () => {
    const controller = await connectedController();
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "duration", fieldId: "image-visible", milliseconds: -5, measuredBy: "matrixsmith-timer" },
    ], [])).toThrow(/invalid duration/i);
    expect(() => controller.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 5000),
      { kind: "boolean", fieldId: "moved", value: "yes" },
      timer("movement-start", 3000),
    ], [])).toThrow(/cannot begin before/i);
  });

  it("rejects observation recording on a non-live session", async () => {
    const live = await connectedController();
    const json = live.exportBundle();
    const offline = new MatrixController(new ScriptedCoolLedUxDevice(null), new TraceRecorder());
    offline.importBundle(json);
    expect(() => offline.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "off-black" },
    ], [])).toThrow(/live physical device session/i);
  });
});
