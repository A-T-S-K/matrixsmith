import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { MatrixStore } from "../../src/ui/store";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { ILEDHAT_GUIDED_TESTS } from "../../src/drivers/coolledux/guided-tests";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";

async function identified(): Promise<{ transport: ScriptedCoolLedUxDevice; controller: MatrixController }> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  return { transport, controller };
}

describe("guided-test safety invariants", () => {
  it("never enables automatic retry on persistent guided-test plans", async () => {
    const { controller } = await identified();
    for (const test of ILEDHAT_GUIDED_TESTS) {
      const plan = controller.planGuidedTest(test.id);
      expect(plan.retryPolicy.maxAttempts).toBe(1);
      expect(plan.retryPolicy.retryOn).toHaveLength(0);
      expect(plan.risk).toBe("persistent");
    }
  });

  it("keeps the experimental unlock session-only around guided transfers", async () => {
    const { controller } = await identified();
    await controller.runGuidedTestTransfer("coolledux-graffiti-black", { confirmedConsequence: true, reason: "initial-experiment", attemptId: "attempt:test" });
    expect(controller.session.experimentalTxEnabled).toBe(false);
    expect(controller.session.confirmedPersistentPlanId).toBeNull();
  }, 30000);

  it("blocks guided transfers whose prerequisites are unmet", async () => {
    const { controller } = await identified();
    await expect(controller.runGuidedTestTransfer("coolledux-color-white", { confirmedConsequence: true, reason: "initial-experiment", attemptId: "attempt:test" })).rejects.toThrow(/pixel\.channel-map/);
  });

  it("defines every guided test against real declared claims and observations", () => {
    for (const test of ILEDHAT_GUIDED_TESTS) {
      expect(test.targetClaims.length).toBeGreaterThan(0);
      expect(test.observation.length).toBeGreaterThan(0);
      expect(test.consequence).toContain("replaces");
      expect(test.about.possibleOutcomes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("exposes no password, OTA, or firmware operations", () => {
    const source = JSON.stringify(ILEDHAT_GUIDED_TESTS.map((test) => test.operation));
    expect(source).not.toMatch(/password|ota|firmware/i);
  });
});

describe("report goal wiring", () => {
  it("populates the shareable report question from the active investigation", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new MatrixController(transport, new TraceRecorder());
    const store = new MatrixStore(controller, transport);
    await store.connect();
    transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
    await store.identify();
    transport.notificationOnWrite = null;
    store.startTroubleshoot("colors-look-wrong");
    expect(store.markdown()).toContain("The colors look wrong");
  });
});

describe("profile immutability", () => {
  it("guided outcomes never mutate the built-in profile", async () => {
    const before = JSON.stringify(iledHat31aeProfile);
    const { controller } = await identified();
    controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "dim-blue" },
    ], []);
    controller.recordGuidedTestObservations("coolledux-animation-static", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "duration", fieldId: "image-visible", milliseconds: 1400, measuredBy: "matrixsmith-timer" },
      { kind: "boolean", fieldId: "moved", value: "no" },
      { kind: "duration", fieldId: "observation-end", milliseconds: 17000, measuredBy: "matrixsmith-timer" },
      { kind: "boolean", fieldId: "background-off", value: "yes" },
      { kind: "boolean", fieldId: "tiles-aligned", value: "yes" },
    ], []);
    expect(JSON.stringify(iledHat31aeProfile)).toBe(before);
    expect(iledHat31aeProfile.quirks?.preferredRasterStrategy).toBe("unresolved");
    // No strategy is selected either: viability still requires channel and
    // encoder characterization, and profile facts never mutate regardless.
    expect(controller.session.validatedRasterStrategy).toBeNull();
  });
});
