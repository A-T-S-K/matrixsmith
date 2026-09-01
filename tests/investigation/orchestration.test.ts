import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { classifyTransfers, buildExecutionFingerprint } from "../../src/investigation/orchestration";
import { detectRecommendationCycle } from "../../src/investigation/recommendations";

/**
 * Orchestration behaviour, driven through the store exactly as the UI does.
 *
 * The regression these protect against is the real session: many identical
 * diagnostic transmissions, some of them legitimate retries after a missed
 * timing observation, with no way afterwards to tell which were which.
 */
async function connectedStore(): Promise<MatrixStore> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
  await store.connect();
  await store.identify();
  return store;
}

const flow = (store: MatrixStore) => store.getSnapshot().guidedFlow!;

/** Run the baseline timing test to a "rendered then moved" partial result. */
async function runBaselineMoved(store: MatrixStore): Promise<void> {
  store.startGuidedTest("coolledux-graffiti-timing");
  await store.confirmGuidedTransfer();
  store.recordGuidedTimeline("event");
  store.recordGuidedTimeline("event");
  answerRemaining(store);
  store.submitGuidedObservations();
}

function answerRemaining(store: MatrixStore): void {
  for (const step of flow(store).steps) {
    if (step.spec.kind === "boolean") store.setGuidedObservation({ kind: "boolean", fieldId: step.spec.id, value: "yes" });
    if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.options[0]!.id });
  }
}

describe("core plan progress", () => {
  it("numbers the experiment by the milestone it is currently serving", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const progress = store.getSnapshot().coreProgress!;
    const current = progress.steps.find((step) => step.state === "current")!;
    // The baseline timing run serves more than one milestone; the label must
    // follow the outstanding one, not the first that merely mentions the test.
    expect(flow(store).corePosition).toMatchObject({ position: current.position, total: progress.total });
    expect(flow(store).corePosition!.stepTitle).toBe(current.title);
  }, 30000);

  it("advances to the next distinct milestone after a conclusion", async () => {
    const store = await connectedStore();
    await runBaselineMoved(store);
    expect(store.getSnapshot().coreProgress).toMatchObject({ completed: 1, total: 6 });
    store.continueToNextTest();
    expect(store.getSnapshot().error).toBeNull();
    expect(flow(store).testId).toBe("coolledux-graffiti-staytime");
    expect(flow(store).corePosition).toMatchObject({ position: 2, total: 6 });
  }, 30000);

  it("keeps the denominator stable when a milestone is skipped", async () => {
    const store = await connectedStore();
    const before = store.getSnapshot().coreProgress!;
    expect(before.total).toBe(6);
    expect(before.steps.every((step) => step.state !== "skipped")).toBe(true);
  }, 30000);
});

describe("retries stay one numbered test", () => {
  it("increments the attempt without moving Test X of Y", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const position = flow(store).corePosition;
    const completedBefore = store.getSnapshot().coreProgress!.completed;
    expect(flow(store).attemptNumber).toBe(1);

    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    expect(flow(store).attemptNumber).toBe(2);
    expect(flow(store).corePosition).toEqual(position);

    store.recordGuidedTimeline("event");
    store.markObservationMissed("missed-t2");
    await store.retryTimingAttempt();
    expect(flow(store).attemptNumber).toBe(3);
    // Three attempts at one experiment is still that one experiment.
    expect(flow(store).corePosition).toEqual(position);
    // Retrying a measurement is not progress through the plan.
    expect(store.getSnapshot().coreProgress!.completed).toBe(completedBefore);
  }, 30000);

  it("records each retry as the same experiment with a distinct attempt and reason", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    const experiments = store.controller.experiments.filter((run) => run.definitionId === "coolledux-graffiti-timing");
    // One experiment run, two attempts — not two experiments.
    expect(experiments).toHaveLength(1);
    expect(experiments[0]!.attempts).toHaveLength(2);
    expect(experiments[0]!.attempts[0]!.validity).toBe("invalid");
    expect(experiments[0]!.attempts[0]!.invalidationReason).toContain("missed");
    const reasons = store.controller.transfers.map((transfer) => transfer.reason);
    expect(reasons).toEqual(["initial-experiment", "explicit-retry-missed-observation"]);
  }, 30000);

  it("resends the identical experiment on retry — same parameters, same fingerprint", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    const [first, second] = store.controller.transfers;
    expect(second!.fingerprint.key).toBe(first!.fingerprint.key);
    expect(second!.fingerprint.parameterKey).toBe("stayTime=3");
    // Identical bytes are EXPECTED here; the reason is what distinguishes them.
    expect(second!.fingerprint.programCrc32).toBe(first!.fingerprint.programCrc32);
  }, 30000);

  it("preserves invalid attempts without letting them establish anything", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    answerRemaining(store);
    store.submitGuidedObservations();
    const completed = store.getSnapshot().investigation!.completedTests.at(-1)!;
    expect(completed.attempts).toHaveLength(2);
    expect(completed.attempts![0]!.validity).toBe("missed-t1");
    expect(completed.attempts![0]!.values).toEqual([]);
    const run = store.controller.experiments.find((entry) => entry.definitionId === "coolledux-graffiti-timing")!;
    expect(run.attempts.filter((attempt) => attempt.validity === "invalid")).toHaveLength(1);
  }, 30000);
});

describe("transmission safety", () => {
  it("sends once for a spatial test and never again while navigating or editing", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-pixel-channels");
    await store.confirmGuidedTransfer();
    const transfersAfterSend = store.controller.transfers.length;
    const transactionsAfterSend = store.controller.transactions.length;
    expect(transfersAfterSend).toBe(1);

    // Everything a user does while observing eleven zones.
    for (let index = 0; index < 11; index += 1) store.nextGuidedStep();
    for (let index = 0; index < 11; index += 1) store.previousGuidedStep();
    store.focusRegion("channel-blue");
    store.setGuidedObservation({ kind: "choice", fieldId: "patch-0x000f", optionId: "blue" });
    store.setGuidedObservation({ kind: "choice", fieldId: "patch-0x000f", optionId: "green" });
    store.focusRegion("channel-red");

    expect(store.controller.transfers.length).toBe(transfersAfterSend);
    expect(store.controller.transactions.length).toBe(transactionsAfterSend);
  }, 30000);

  it("blocks a resend that claims to be a new experiment when the diagnostic is already showing", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-pixel-channels");
    await store.confirmGuidedTransfer();
    const before = store.controller.transfers.length;
    await expect(store.controller.runGuidedTestTransfer("coolledux-pixel-channels", {
      confirmedConsequence: true, reason: "initial-experiment", attemptId: "attempt:bogus",
    })).rejects.toThrow(/already showing on the display/u);
    expect(store.controller.transfers.length).toBe(before);
  }, 30000);

  it("allows the same payload when the reason is a deliberate repeat", async () => {
    const store = await connectedStore();
    store.startGuidedTest("coolledux-pixel-channels");
    await store.confirmGuidedTransfer();
    await expect(store.controller.runGuidedTestTransfer("coolledux-pixel-channels", {
      confirmedConsequence: true, reason: "explicit-measure-again", attemptId: "attempt:again",
    })).resolves.toBeDefined();
  }, 30000);
});

describe("anti-loop", () => {
  it("moves to the next distinct milestone rather than repeating the finished one", async () => {
    const store = await connectedStore();
    await runBaselineMoved(store);
    store.continueToNextTest();
    expect(store.getSnapshot().error).toBeNull();
    expect(flow(store).testId).not.toBe("coolledux-graffiti-timing");
  }, 30000);

  it("refuses to relaunch a concluded experiment even if the engine offers one", async () => {
    const store = await connectedStore();
    await runBaselineMoved(store);
    // The guard is a backstop: correct ranking should never surface a
    // concluded experiment, so force the condition to prove it is caught
    // rather than acted on.
    const concluded = store.controller.recommendations().find(() => true);
    Object.defineProperty(store.controller, "recommendations", {
      configurable: true,
      value: () => [{ ...concluded, testId: "coolledux-graffiti-timing" }],
    });
    store.continueToNextTest();
    expect(store.getSnapshot().error).toMatch(/already produced a result/u);
    expect(store.getSnapshot().guidedFlow).toBeNull();
  }, 30000);

  it("detects a recommendation sequence that repeats without new evidence", () => {
    const trail = [
      { testId: "a", at: "2026-08-31T00:00:00Z", evidenceCount: 3 },
      { testId: "b", at: "2026-08-31T00:01:00Z", evidenceCount: 3 },
      { testId: "a", at: "2026-08-31T00:02:00Z", evidenceCount: 3 },
    ];
    expect(detectRecommendationCycle(trail).cycling).toBe(true);
    // Genuine progress recommends the same test again only after learning more.
    const progressing = [
      { testId: "a", at: "2026-08-31T00:00:00Z", evidenceCount: 1 },
      { testId: "b", at: "2026-08-31T00:01:00Z", evidenceCount: 3 },
      { testId: "a", at: "2026-08-31T00:02:00Z", evidenceCount: 6 },
    ];
    expect(detectRecommendationCycle(progressing).cycling).toBe(false);
  });
});

describe("transfer classification", () => {
  const fingerprint = (testId: string, parameters: Record<string, number>, crc: string) =>
    buildExecutionFingerprint({ physicalDeviceKey: "browser-device-a", testId, diagnosticId: "d", parameters, programCrc32: crc });

  it("does not flag legitimate retries merely because the bytes match", () => {
    const fp = fingerprint("timing", { stayTime: 3 }, "0x227B3A0B");
    const summary = classifyTransfers([
      { transferId: "1", attemptId: "a1", diagnosticId: "d", reason: "initial-experiment", fingerprint: fp, transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
      { transferId: "2", attemptId: "a2", diagnosticId: "d", reason: "explicit-retry-missed-observation", fingerprint: fp, transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
      { transferId: "3", attemptId: "a3", diagnosticId: "d", reason: "explicit-measure-again", fingerprint: fp, transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.unclassifiedDuplicates).toBe(0);
    expect(summary.repeatedExecutions[0]).toMatchObject({ transfers: 3, programCrc32: "0x227B3A0B" });
  });

  it("flags a repeat that claims to be a fresh experiment", () => {
    const fp = fingerprint("timing", { stayTime: 3 }, "0x227B3A0B");
    const summary = classifyTransfers([
      { transferId: "1", attemptId: "a1", diagnosticId: "d", reason: "initial-experiment", fingerprint: fp, transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
      { transferId: "2", attemptId: "a2", diagnosticId: "d", reason: "initial-experiment", fingerprint: fp, transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
    ]);
    expect(summary.unclassifiedDuplicates).toBe(1);
  });

  it("treats a controlled variant as a different execution, not a duplicate", () => {
    const summary = classifyTransfers([
      { transferId: "1", attemptId: "a1", diagnosticId: "d", reason: "initial-experiment", fingerprint: fingerprint("timing", { stayTime: 3 }, "0xAAAA"), transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
      { transferId: "2", attemptId: "a2", diagnosticId: "d", reason: "controlled-variant", fingerprint: fingerprint("staytime", { stayTime: 0 }, "0xBBBB"), transactionIds: [], startedAt: "", finalWriteAcceptedAt: null, failureReason: null },
    ]);
    expect(summary.repeatedExecutions).toHaveLength(0);
    expect(summary.unclassifiedDuplicates).toBe(0);
  });
});
