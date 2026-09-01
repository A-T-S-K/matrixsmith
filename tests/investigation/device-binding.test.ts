import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import type { DeviceFingerprint } from "../../src/core/device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { bindingAllowsSessionContinuity, compareBindings, deviceIdentityBinding } from "../../src/investigation/device-identity";

function secondIledHatFingerprint(): DeviceFingerprint {
  // A different physical unit of the same model: identical GATT shape and
  // name, different browser authorization id.
  return { ...knownIledHatFingerprint(), browserDeviceId: "fixture-device-2" };
}

async function connectedController(fingerprint = knownIledHatFingerprint()): Promise<{ controller: MatrixController; transport: ScriptedCoolLedUxDevice }> {
  const transport = new ScriptedCoolLedUxDevice(fingerprint);
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  return { controller, transport };
}

function recordBlackPass(controller: MatrixController): void {
  controller.recordGuidedTestObservations("coolledux-graffiti-black", [
    { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
    { kind: "choice", fieldId: "workaround-appearance", optionId: "dim-blue" },
  ], []);
}

describe("device identity binding", () => {
  it("treats matching browser device ids as the same authorized device", () => {
    const a = deviceIdentityBinding(knownIledHatFingerprint(), "profile");
    const b = deviceIdentityBinding(knownIledHatFingerprint(), null);
    expect(compareBindings(a, b)).toBe("same-authorized-device");
    expect(bindingAllowsSessionContinuity(a, b)).toBe(true);
  });

  it("distinguishes two identical units by browser device id", () => {
    const a = deviceIdentityBinding(knownIledHatFingerprint(), "profile");
    const b = deviceIdentityBinding(secondIledHatFingerprint(), "profile");
    expect(compareBindings(a, b)).toBe("different");
    expect(bindingAllowsSessionContinuity(a, b)).toBe(false);
  });

  it("never grants continuity from fingerprint shape alone", () => {
    const bare = { ...knownIledHatFingerprint() };
    delete (bare as { browserDeviceId?: string }).browserDeviceId;
    const a = deviceIdentityBinding(bare, "profile");
    const b = deviceIdentityBinding({ ...bare }, "profile");
    expect(compareBindings(a, b)).toBe("same-fingerprint-shape");
    expect(bindingAllowsSessionContinuity(a, b)).toBe(false);
  });
});

describe("cross-device evidence isolation", () => {
  it("stamps the investigation with the physical device binding", async () => {
    const { controller } = await connectedController();
    recordBlackPass(controller);
    expect(controller.investigation?.deviceBinding?.browserDeviceId).toBe("fixture-device");
  });

  it("detaches the investigation when a different physical device connects", async () => {
    const { controller, transport } = await connectedController();
    recordBlackPass(controller);
    expect(controller.claims().find((claim) => claim.id === "graffiti.black-semantics")?.decidedBy?.scope).toBe("current-session");

    await controller.disconnect();
    transport.fingerprint = secondIledHatFingerprint();
    await controller.connect();

    // Device A's current-session evidence must not affect Device B.
    expect(controller.investigation).toBeNull();
    const state = controller.claims().find((claim) => claim.id === "graffiti.black-semantics");
    expect(state?.evidence.every((entry) => entry.scope !== "current-session")).toBe(true);
    // The detached investigation is available for persistence, demoted and stopped.
    const detached = controller.takeDetachedInvestigation();
    expect(detached?.status).toBe("stopped");
    expect(detached?.claimEvidence.every((entry) => entry.scope === "previous-local-session")).toBe(true);
    expect(controller.takeDetachedInvestigation()).toBeNull();
  });

  it("keeps Device A evidence out of Device B recommendations and gates", async () => {
    const { controller, transport } = await connectedController();
    // Simulate Device A having a verified animation static strategy.
    controller.recordGuidedTestObservations("coolledux-animation-static", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "duration", fieldId: "image-visible", milliseconds: 1400, measuredBy: "matrixsmith-timer" },
      { kind: "boolean", fieldId: "moved", value: "no" },
      { kind: "duration", fieldId: "observation-end", milliseconds: 17000, measuredBy: "matrixsmith-timer" },
      { kind: "boolean", fieldId: "background-off", value: "yes" },
      { kind: "boolean", fieldId: "tiles-aligned", value: "yes" },
      { kind: "boolean", fieldId: "flicker", value: "no" },
    ], []);
    await controller.disconnect();
    transport.fingerprint = secondIledHatFingerprint();
    await controller.connect();
    const staticState = controller.claims().find((claim) => claim.id === "animation.static-single-frame");
    expect(staticState?.evidence.some((entry) => entry.scope === "current-session")).toBe(false);
    expect(controller.contentGate("image").allowed).toBe(false);
  });

  it("resumes the same active investigation when the same authorized device reconnects", async () => {
    const { controller, transport } = await connectedController();
    recordBlackPass(controller);
    const id = controller.investigation?.id;
    await controller.disconnect();
    transport.fingerprint = knownIledHatFingerprint();
    await controller.connect();
    // Intentional: the browser-stable authorized device id proves the same
    // physical unit, so the investigation and its current-session evidence
    // survive the reconnect.
    expect(controller.investigation?.id).toBe(id);
    expect(controller.claims().find((claim) => claim.id === "graffiti.black-semantics")?.decidedBy?.scope).toBe("current-session");
  });

  it("demotes live-recorded legacy validation evidence when the device changes", async () => {
    const { controller, transport } = await connectedController();
    controller.recordValidationAnswers("coolledux-validate-static-frame", [
      { questionId: "corners", answer: "yes" },
      { questionId: "colors", answer: "yes" },
      { questionId: "seams", answer: "yes" },
      { questionId: "canvas", answer: "yes" },
      { questionId: "background", answer: "yes" },
    ], []);
    const before = controller.baselineClaimEvidence().filter((entry) => entry.testId === "coolledux-validate-static-frame");
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((entry) => entry.scope === "current-session")).toBe(true);

    await controller.disconnect();
    transport.fingerprint = secondIledHatFingerprint();
    await controller.connect();
    const after = controller.baselineClaimEvidence().filter((entry) => entry.testId === "coolledux-validate-static-frame");
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((entry) => entry.scope === "previous-local-session")).toBe(true);
  });

  it("marks bundle-imported validations as imported-external evidence", async () => {
    const { controller } = await connectedController();
    controller.recordValidationAnswers("coolledux-validate-static-frame", [
      { questionId: "corners", answer: "yes" },
      { questionId: "colors", answer: "yes" },
      { questionId: "seams", answer: "yes" },
      { questionId: "canvas", answer: "yes" },
      { questionId: "background", answer: "yes" },
    ], []);
    const json = controller.exportBundle();
    const offline = new MatrixController(new ScriptedCoolLedUxDevice(null), new TraceRecorder());
    offline.importBundle(json);
    const bridged = offline.baselineClaimEvidence().filter((entry) => entry.testId === "coolledux-validate-static-frame");
    expect(bridged.length).toBeGreaterThan(0);
    expect(bridged.every((entry) => entry.scope === "imported-external")).toBe(true);
  });
});
