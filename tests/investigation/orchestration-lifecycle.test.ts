import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import type { DeviceFingerprint } from "../../src/core/device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { buildExecutionFingerprint } from "../../src/investigation/orchestration";
import { Framebuffer } from "../../src/render/framebuffer";

/**
 * Lifecycle invariants for guided orchestration.
 *
 * Every case here is a hole that a real session fell into: one panel's
 * execution history speaking for another's, a duplicate guard convinced a
 * diagnostic was still showing after an unrelated image was sent, and an
 * attempt left in progress forever because the radio dropped mid-transfer.
 */

function secondPhysicalDevice(): DeviceFingerprint {
  // Same model, same profile, same GATT shape — a genuinely different unit.
  return { ...knownIledHatFingerprint(), browserDeviceId: "fixture-device-2" };
}

async function connectedStore(fingerprint = knownIledHatFingerprint()): Promise<{ store: MatrixStore; transport: ScriptedCoolLedUxDevice }> {
  const transport = new ScriptedCoolLedUxDevice(fingerprint);
  const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
  await store.connect();
  await store.identify();
  return { store, transport };
}

const flow = (store: MatrixStore) => store.getSnapshot().guidedFlow!;

function answerRemaining(store: MatrixStore): void {
  for (const step of flow(store).steps) {
    if (step.spec.kind === "boolean") store.setGuidedObservation({ kind: "boolean", fieldId: step.spec.id, value: "yes" });
    if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.options[0]!.id });
  }
}

/** Run the baseline timing test through to a "rendered then moved" result. */
async function runBaselineMoved(store: MatrixStore): Promise<void> {
  store.startGuidedTest("coolledux-graffiti-timing");
  await store.confirmGuidedTransfer();
  store.recordGuidedTimeline("event");
  store.recordGuidedTimeline("event");
  answerRemaining(store);
  store.submitGuidedObservations();
}

describe("orchestration belongs to the investigation, not the controller", () => {
  it("does not let a different physical device inherit orchestration from the same profile", async () => {
    const { store, transport } = await connectedStore();
    await runBaselineMoved(store);
    const before = store.getSnapshot().orchestration;
    expect(before.experiments.length).toBeGreaterThan(0);
    expect(before.transfers.length).toBeGreaterThan(0);
    expect(before.recommendationTrail.length).toBeGreaterThan(0);

    // A DIFFERENT physical unit of the same model connects. Same profileId,
    // same fingerprint shape, different browser authorization.
    transport.fingerprint = secondPhysicalDevice();
    store.controller.applyFingerprint(secondPhysicalDevice(), "live");

    const after = store.getSnapshot().orchestration;
    expect(store.controller.investigation).toBeNull();
    expect(after.experiments).toHaveLength(0);
    expect(after.transfers).toHaveLength(0);
    expect(after.recommendationTrail).toHaveLength(0);
    expect(after.panelProgram.certainty).toBe("unknown");
    expect(store.controller.reopenedTestIds()).toHaveLength(0);
    expect(store.controller.recommendationCycle.cycling).toBe(false);
  }, 30000);

  it("keeps the detached investigation's orchestration with that investigation", async () => {
    const { store, transport } = await connectedStore();
    await runBaselineMoved(store);
    const experimentCount = store.getSnapshot().orchestration.experiments.length;

    transport.fingerprint = secondPhysicalDevice();
    store.controller.applyFingerprint(secondPhysicalDevice(), "live");

    const detached = store.controller.takeDetachedInvestigation();
    expect(detached).not.toBeNull();
    // The history is not destroyed — it travels with the investigation that
    // produced it, so its report is still complete.
    expect(detached!.orchestration.experiments).toHaveLength(experimentCount);
    expect(detached!.orchestration.transfers.length).toBeGreaterThan(0);
    // What it may NOT carry across is any operational claim about a panel.
    expect(detached!.orchestration.panelProgram.certainty).toBe("unknown");
  }, 30000);

  it("preserves orchestration when the same authorized device reconnects", async () => {
    const { store } = await connectedStore();
    await runBaselineMoved(store);
    const before = store.getSnapshot().orchestration;
    const investigationId = store.controller.investigation!.id;

    // The SAME browser-authorized physical device reconnects.
    store.controller.applyFingerprint(knownIledHatFingerprint(), "live");

    const after = store.getSnapshot().orchestration;
    expect(store.controller.investigation?.id).toBe(investigationId);
    expect(after.experiments.map((run) => run.experimentRunId)).toEqual(before.experiments.map((run) => run.experimentRunId));
    expect(after.transfers).toHaveLength(before.transfers.length);
    expect(after.recommendationTrail).toHaveLength(before.recommendationTrail.length);
    // Continuity of history is not continuity of the panel: nothing observed
    // the display across the disconnect.
    expect(after.panelProgram.certainty).toBe("unknown");
  }, 30000);
});

describe("execution fingerprints identify a physical device", () => {
  it("separates two browser device ids that share a profile", () => {
    const shared = { testId: "t", diagnosticId: "d", parameters: { stayTime: 3 }, profileId: "iledhat-31ae-32x16" };
    const a = buildExecutionFingerprint({ ...shared, physicalDeviceKey: "device-a" });
    const b = buildExecutionFingerprint({ ...shared, physicalDeviceKey: "device-b" });
    expect(a.key).not.toBe(b.key);
    expect(a.deviceIdentityBasis).toBe("browser-authorized-device");
    // The profile is recorded, but it is not what makes the identity.
    expect(a.profileId).toBe(b.profileId);
  });

  it("never derives physical identity from the profile alone", () => {
    const bare = buildExecutionFingerprint({ testId: "t", diagnosticId: "d", profileId: "iledhat-31ae-32x16" });
    expect(bare.physicalDeviceKey).toBeNull();
    expect(bare.deviceIdentityBasis).toBe("unidentified");
    expect(bare.key).not.toContain("iledhat-31ae-32x16");
  });

  it("labels a fingerprint-shape identity as the weaker thing it is", () => {
    const shape = buildExecutionFingerprint({ testId: "t", diagnosticId: "d", fingerprintShapeKey: "shape-key" });
    expect(shape.deviceIdentityBasis).toBe("fingerprint-shape");
    expect(shape.physicalDeviceKey).toBeNull();
  });

  it("uses the browser-authorized device id in a live session", async () => {
    const { store } = await connectedStore();
    const fingerprint = store.controller.guidedExecutionFingerprint("coolledux-graffiti-timing");
    expect(fingerprint.physicalDeviceKey).toBe("fixture-device");
    expect(fingerprint.deviceIdentityBasis).toBe("browser-authorized-device");
  }, 30000);

  it("gives two identical-model devices different execution identities", async () => {
    const { store: storeA } = await connectedStore();
    const { store: storeB } = await connectedStore(secondPhysicalDevice());
    const a = storeA.controller.guidedExecutionFingerprint("coolledux-graffiti-timing");
    const b = storeB.controller.guidedExecutionFingerprint("coolledux-graffiti-timing");
    expect(a.profileId).toBe(b.profileId);
    expect(a.key).not.toBe(b.key);
  }, 30000);
});

describe("panel program identity tracks every persistent write", () => {
  it("marks the guided diagnostic active after its transfer", async () => {
    const { store } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const panel = store.controller.panelProgram();
    expect(panel.certainty).toBe("known-active");
    expect(panel.kind).toBe("guided-diagnostic");
    expect(panel.fingerprint?.testId).toBe("coolledux-graffiti-timing");
  }, 30000);

  it("blocks a second initial transfer of a diagnostic already on the panel", async () => {
    const { store } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const run = store.controller.experiments.at(-1)!;
    const attempt = store.controller.beginAttempt(run.experimentRunId, "initial-experiment");
    await expect(store.controller.runGuidedTestTransfer("coolledux-graffiti-timing", {
      confirmedConsequence: true, reason: "initial-experiment", attemptId: attempt.attemptId,
    })).rejects.toThrow(/already showing/u);
  }, 30000);

  it("allows the initial transfer again once ordinary content replaced it", async () => {
    const { store } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    expect(store.controller.panelProgram().kind).toBe("guided-diagnostic");

    // The user sends an image from Create. The diagnostic is gone from the
    // panel, so re-running it is a legitimate initial experiment again.
    const imagePlan = store.controller.plan({ type: "ShowFrame", frame: framebuffer(store) });
    await store.controller.sendPersistentContent(imagePlan, { confirmedConsequence: true });
    const replaced = store.controller.panelProgram();
    expect(replaced.certainty).toBe("known-replaced");
    expect(replaced.kind).toBe("ordinary-content");
    expect(replaced.fingerprint).toBeNull();

    const run = store.controller.experiments.at(-1)!;
    const attempt = store.controller.beginAttempt(run.experimentRunId, "initial-experiment");
    await expect(store.controller.runGuidedTestTransfer("coolledux-graffiti-timing", {
      confirmedConsequence: true, reason: "initial-experiment", attemptId: attempt.attemptId,
    })).resolves.toBeTruthy();
  }, 30000);

  it("treats a legacy validation send as replacing the guided diagnostic", async () => {
    const { store } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    await store.controller.runContentValidation("coolledux-validate-static-frame", { confirmedConsequence: true });
    const panel = store.controller.panelProgram();
    expect(panel.kind).toBe("validation");
    expect(panel.certainty).toBe("known-replaced");
    expect(panel.fingerprint).toBeNull();
  }, 30000);

  it("loses panel certainty when a persistent write fails part-way", async () => {
    const { store, transport } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    transport.failWriteAt = transport.writes.length + 1;
    await store.confirmGuidedTransfer();
    transport.failWriteAt = null;
    expect(store.getSnapshot().error).not.toBeNull();
    expect(store.controller.panelProgram().certainty).toBe("unknown");
  }, 30000);

  it("clears panel certainty when a different physical device connects", async () => {
    const { store, transport } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    transport.fingerprint = secondPhysicalDevice();
    store.controller.applyFingerprint(secondPhysicalDevice(), "live");
    expect(store.controller.panelProgram().certainty).toBe("unknown");
  }, 30000);
});

describe("attempt lifecycle", () => {
  it("settles the attempt when the transfer throws and leaves nothing in progress", async () => {
    const { store, transport } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    transport.failWriteAt = transport.writes.length + 1;
    await store.confirmGuidedTransfer();
    transport.failWriteAt = null;

    const run = store.controller.experiments.at(-1)!;
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({ attemptNumber: 1, validity: "invalid", failureKind: "transfer-failed" });
    expect(store.controller.inProgressAttempts()).toHaveLength(0);
    // The failed transmission is preserved with whatever it managed to send,
    // so a report can say the display may have been partly written.
    const failed = store.controller.transfers.at(-1)!;
    expect(failed.failureReason).not.toBeNull();
    expect(failed.attemptId).toBe(run.attempts[0]!.attemptId);
  }, 30000);

  it("makes the retry after a failed transfer attempt 2, not attempt 1 again", async () => {
    const { store, transport } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    transport.failWriteAt = transport.writes.length + 1;
    await store.confirmGuidedTransfer();
    transport.failWriteAt = null;
    await store.confirmGuidedTransfer();

    const run = store.controller.experiments.at(-1)!;
    expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(run.attempts[1]!.validity).toBe("in-progress");
    expect(flow(store).attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(flow(store).attempts[0]!.validity).toBe("transfer-failed");
  }, 30000);

  it("preserves transfer-failed, human-missed and valid as attempts 1, 2 and 3", async () => {
    const { store, transport } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");

    // Attempt 1: the transfer fails.
    transport.failWriteAt = transport.writes.length + 1;
    await store.confirmGuidedTransfer();
    transport.failWriteAt = null;

    // Attempt 2: the transfer lands, the human misses T1.
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();

    // Attempt 3: a clean measurement.
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    answerRemaining(store);
    store.submitGuidedObservations();

    const run = store.controller.experiments.at(-1)!;
    expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
    expect(run.attempts.map((attempt) => attempt.failureKind)).toEqual(["transfer-failed", "human-missed", null]);
    expect(run.attempts.map((attempt) => attempt.validity)).toEqual(["invalid", "invalid", "valid"]);

    const completed = store.controller.investigation!.completedTests.at(-1)!;
    expect(completed.attempts).toHaveLength(3);
    expect(completed.attempts!.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
    expect(completed.attempts![0]!.validity).toBe("transfer-failed");
    expect(completed.attempts![1]!.validity).toBe("missed-t1");
    expect(completed.attempts![2]!.validity).toBe("valid");
    // Invalid attempts contribute nothing to the conclusion.
    expect(completed.attempts![0]!.values).toEqual([]);
    expect(completed.attempts![1]!.values).toEqual([]);
  }, 30000);

  it("keeps one authoritative attempt identity: timing detail never numbers itself", async () => {
    const { store, transport } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    transport.failWriteAt = transport.writes.length + 1;
    await store.confirmGuidedTransfer();
    transport.failWriteAt = null;
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t2");
    await store.retryTimingAttempt();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    answerRemaining(store);
    store.submitGuidedObservations();

    for (const run of store.controller.experiments) {
      // Monotonic, 1-based, never recycled.
      expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual(run.attempts.map((_, index) => index + 1));
      for (const attempt of run.attempts) {
        // A nested timing record is the SAME attempt, not a parallel one.
        if (attempt.timing) expect(attempt.timing.attemptNumber).toBe(attempt.attemptNumber);
      }
    }
    // The completed test's timing attempts line up 1:1 with the semantic ones.
    const run = store.controller.experiments.at(-1)!;
    const completed = store.controller.investigation!.completedTests.at(-1)!;
    expect(completed.attempts!.map((attempt) => attempt.attemptNumber))
      .toEqual(run.attempts.map((attempt) => attempt.attemptNumber));
  }, 30000);

  it("records a stopped observation without leaving an attempt in progress", async () => {
    const { store } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.abandonGuidedTest();
    expect(store.controller.inProgressAttempts()).toHaveLength(0);
    const run = store.controller.experiments.at(-1)!;
    expect(run.resolution).toBe("abandoned");
    // Abandonment preserves the evidence that something WAS transmitted.
    expect(store.controller.investigation!.completedTests.at(-1)!.transactionIds.length).toBeGreaterThan(0);
  }, 30000);
});

/** A minimal frame for an ordinary persistent content send. */
function framebuffer(store: MatrixStore): Framebuffer {
  const profile = store.controller.session.profile!;
  const frame = new Framebuffer(profile.width, profile.height);
  frame.setPixel(0, 0, 255, 255, 255);
  return frame;
}
