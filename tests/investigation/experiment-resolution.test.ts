import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { uncharacterizedStore } from "../helpers/uncharacterized-device";
import { completedTestResolution } from "../../src/investigation/investigation";
import { detectRecommendationCycle, isConcludedTest } from "../../src/investigation/recommendations";

/**
 * Settled is not the same as finished with.
 *
 * The original bug was an endless loop, and the fix — "everything except
 * abandoned is concluded" — traded it for the opposite failure: a person who
 * watched for seven of the fifteen seconds a stability verdict requires had
 * the only test that could answer the question permanently retired, and was
 * told no further test was recommended.
 */

async function connectedStore(): Promise<MatrixStore> {
  // Resolution semantics are a property of the guided journey, so these run
  // against a device whose static substrate is still open.
  return (await uncharacterizedStore()).store;
}

const flow = (store: MatrixStore) => store.getSnapshot().guidedFlow!;

function answerRemaining(store: MatrixStore): void {
  for (const step of flow(store).steps) {
    if (step.spec.kind === "boolean") store.setGuidedObservation({ kind: "boolean", fieldId: step.spec.id, value: "yes" });
    if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.options[0]!.id });
  }
}

/**
 * The user watches, sees nothing move, and stops well before the required
 * window — the sub-15-second case. T1 is marked, then "still".
 */
async function runShortStillObservation(store: MatrixStore, testId = "coolledux-graffiti-timing"): Promise<void> {
  store.startGuidedTest(testId);
  await store.confirmGuidedTransfer();
  store.recordGuidedTimeline("event");
  store.recordGuidedTimeline("still");
  answerRemaining(store);
  store.submitGuidedObservations();
}

/** Rendered, then moved: a real answer, positive or negative. */
async function runMovedObservation(store: MatrixStore, testId = "coolledux-graffiti-timing"): Promise<void> {
  store.startGuidedTest(testId);
  await store.confirmGuidedTransfer();
  store.recordGuidedTimeline("event");
  store.recordGuidedTimeline("event");
  answerRemaining(store);
  store.submitGuidedObservations();
}

describe("sub-15-second observation is retryable, not a dead end", () => {
  it("resolves a short still observation as retryable-incomplete", async () => {
    const store = await connectedStore();
    await runShortStillObservation(store);
    const completed = store.controller.investigation!.completedTests.at(-1)!;
    expect(completed.status).toBe("inconclusive");
    expect(completedTestResolution(completed)).toBe("retryable-incomplete");
    expect(isConcludedTest(completed)).toBe(true);
    // The experiment stays open for a repeat rather than being retired.
    expect(store.controller.retryableExperimentIds()).toContain("coolledux-graffiti-timing");
  }, 30000);

  it("neither verifies nor rejects stability from an insufficient window", async () => {
    const store = await connectedStore();
    await runShortStillObservation(store);
    const stability = store.controller.claims().find((claim) => claim.id === "graffiti.playback-stability");
    expect(stability?.status).not.toBe("verified");
    expect(stability?.status).not.toBe("rejected");
  }, 30000);

  it("offers to measure again instead of saying no test is recommended", async () => {
    const store = await connectedStore();
    await runShortStillObservation(store);
    expect(flow(store).stage).toBe("result");
    store.continueToNextTest();
    const snapshot = store.getSnapshot();
    expect(snapshot.error).toBeNull();
    expect(snapshot.info).toMatch(/did not run long enough/u);
    expect(snapshot.info).not.toMatch(/No further test is recommended/u);
    expect(snapshot.coreProgress!.retryableTestId).toBe("coolledux-graffiti-timing");
    expect(snapshot.coreProgress!.complete).toBe(false);
  }, 30000);

  it("keeps the same numbered milestone when measured again", async () => {
    const store = await connectedStore();
    await runShortStillObservation(store);
    const position = flow(store).corePosition;
    store.measureAgain("coolledux-graffiti-timing");
    expect(store.getSnapshot().error).toBeNull();
    expect(flow(store).testId).toBe("coolledux-graffiti-timing");
    expect(flow(store).corePosition).toEqual(position);
  }, 30000);

  it("continues the plan once the repeat measurement is valid", async () => {
    const store = await connectedStore();
    await runShortStillObservation(store);
    const attemptsBefore = store.controller.experiments.at(-1)!.attempts.length;

    store.measureAgain("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    answerRemaining(store);
    store.submitGuidedObservations();

    const completed = store.controller.investigation!.completedTests.at(-1)!;
    expect(completedTestResolution(completed)).toBe("settled");
    expect(store.controller.retryableExperimentIds()).not.toContain("coolledux-graffiti-timing");
    // The repeat continued the SAME experiment: its attempts kept counting up
    // rather than starting a parallel run of the identical measurement.
    const run = store.controller.experiments.at(-1)!;
    expect(run.attempts.length).toBeGreaterThan(attemptsBefore);
    expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual(run.attempts.map((_, index) => index + 1));
  }, 30000);
});

describe("settled experiments leave automatic rotation", () => {
  it("does not automatically recommend a settled experiment again", async () => {
    const store = await connectedStore();
    await runMovedObservation(store);
    const completed = store.controller.investigation!.completedTests.at(-1)!;
    expect(completedTestResolution(completed)).toBe("settled");
    expect(store.controller.recommendations().some((entry) => entry.testId === "coolledux-graffiti-timing")).toBe(false);
  }, 30000);

  it("requires an explicit reopen to run a settled experiment again", async () => {
    const store = await connectedStore();
    await runMovedObservation(store);
    store.closeGuidedTest();
    store.reopenExperiment("coolledux-graffiti-timing", "Confirming the movement onset.");
    expect(store.getSnapshot().error).toBeNull();
    expect(flow(store).testId).toBe("coolledux-graffiti-timing");
    expect(store.controller.experiments.at(-1)!.reopenReason).toBe("Confirming the movement onset.");
  }, 30000);
});

describe("the cycle guard distinguishes engine loops from user decisions", () => {
  it("does not flag repeated user-initiated retries", () => {
    const at = "2026-09-01T00:00:00.000Z";
    const verdict = detectRecommendationCycle([
      { testId: "a", at, evidenceCount: 2, origin: "automatic-recommendation" },
      { testId: "a", at, evidenceCount: 2, origin: "explicit-retry" },
      { testId: "a", at, evidenceCount: 2, origin: "explicit-retry" },
      { testId: "a", at, evidenceCount: 2, origin: "explicit-retry" },
    ]);
    expect(verdict.cycling).toBe(false);
  });

  it("still flags the engine proposing the same experiment with nothing learned", () => {
    const at = "2026-09-01T00:00:00.000Z";
    const verdict = detectRecommendationCycle([
      { testId: "a", at, evidenceCount: 2, origin: "automatic-recommendation" },
      { testId: "b", at, evidenceCount: 2, origin: "automatic-recommendation" },
      { testId: "a", at, evidenceCount: 2, origin: "automatic-recommendation" },
    ]);
    expect(verdict.cycling).toBe(true);
  });

  it("treats a trail entry with no recorded origin as automatic", () => {
    const at = "2026-09-01T00:00:00.000Z";
    const verdict = detectRecommendationCycle([
      { testId: "a", at, evidenceCount: 2 },
      { testId: "b", at, evidenceCount: 2 },
      { testId: "a", at, evidenceCount: 2 },
    ]);
    expect(verdict.cycling).toBe(true);
  });

  it("does not trip when a user measures the same incomplete experiment again", async () => {
    const store = await connectedStore();
    await runShortStillObservation(store);
    store.measureAgain("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("still");
    answerRemaining(store);
    store.submitGuidedObservations();
    expect(store.controller.recommendationCycle.cycling).toBe(false);
    expect(store.getSnapshot().cycleWarning).toBeNull();
  }, 30000);
});

describe("controlled variants stay distinct experiments", () => {
  it("gives stayTime=3 and stayTime=0 different execution identities", async () => {
    const store = await connectedStore();
    const baseline = store.controller.guidedExecutionFingerprint("coolledux-graffiti-timing");
    const variant = store.controller.guidedExecutionFingerprint("coolledux-graffiti-staytime");
    expect(baseline.parameterKey).toBe("stayTime=3");
    expect(variant.parameterKey).toBe("stayTime=0");
    expect(baseline.key).not.toBe(variant.key);
    // Same diagnostic program id; the resolved parameters are what separate
    // a controlled variant from a repeat of the baseline.
    expect(baseline.diagnosticId).toBe(variant.diagnosticId);
  }, 30000);

  it("does not collapse the variant into the baseline's experiment run", async () => {
    const store = await connectedStore();
    await runMovedObservation(store);
    store.continueToNextTest();
    expect(flow(store).testId).toBe("coolledux-graffiti-staytime");
    await store.confirmGuidedTransfer();
    const runs = store.controller.experiments;
    expect(runs).toHaveLength(2);
    expect(runs[0]!.experimentRunId).not.toBe(runs[1]!.experimentRunId);
    expect(runs[0]!.parameters).toEqual({ stayTime: 3 });
    expect(runs[1]!.parameters).toEqual({ stayTime: 0 });
    expect(store.controller.transferSummary().unclassifiedDuplicates).toBe(0);
  }, 30000);

  it("keeps a retry of one variant inside that variant's own run", async () => {
    const store = await connectedStore();
    await runMovedObservation(store);
    store.continueToNextTest();
    await store.confirmGuidedTransfer();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    const variantRun = store.controller.experiments.at(-1)!;
    expect(variantRun.definitionId).toBe("coolledux-graffiti-staytime");
    expect(variantRun.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(store.controller.experiments).toHaveLength(2);
  }, 30000);
});

describe("optional characterization is never the automatic next step", () => {
  /** Drive the plan to a complete core through the shortest branch. */
  async function completeCore(store: MatrixStore): Promise<void> {
    const c = store.controller;
    const timer = (fieldId: string, milliseconds: number) => ({ kind: "duration" as const, fieldId, milliseconds, measuredBy: "matrixsmith-timer" as const });
    const MIN = 15_000;
    c.recordGuidedTestObservations("coolledux-graffiti-timing", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1200),
      { kind: "boolean", fieldId: "moved", value: "yes" },
      timer("movement-start", 4400),
    ], []);
    c.recordGuidedTestObservations("coolledux-graffiti-staytime", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1200),
      { kind: "boolean", fieldId: "moved", value: "yes" },
      timer("movement-start", 2000),
    ], []);
    c.recordGuidedTestObservations("coolledux-animation-static", [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      timer("image-visible", 1100),
      { kind: "boolean", fieldId: "moved", value: "no" },
      timer("observation-end", 1100 + MIN + 400),
      { kind: "boolean", fieldId: "background-off", value: "yes" },
      { kind: "boolean", fieldId: "tiles-aligned", value: "yes" },
      { kind: "boolean", fieldId: "flicker", value: "no" },
    ], []);
    const patch = (word: number, optionId: string) => ({ kind: "choice" as const, fieldId: `patch-0x${word.toString(16).padStart(4, "0")}`, optionId });
    c.recordGuidedTestObservations("coolledux-pixel-channels", [
      patch(0x0000, "off"), patch(0x0f00, "red"), patch(0x00f0, "green"), patch(0x000f, "blue"), patch(0x0fff, "tinted-white"),
      patch(0x1000, "off"), patch(0x2000, "off"), patch(0x4000, "off"), patch(0x8000, "off"), patch(0xf000, "off"), patch(0xffff, "tinted-white"),
    ], []);
  }

  it("stops instead of opening colour work once every core slot is resolved", async () => {
    const store = await connectedStore();
    await completeCore(store);
    expect(store.getSnapshot().coreProgress!.complete).toBe(true);
    // There ARE further tests the engine could rank — colour quality, the
    // second fallback variant. Continuing must not pick one on its own.
    expect(store.controller.recommendations().length).toBeGreaterThan(0);
    store.continueToNextTest();
    expect(store.getSnapshot().guidedFlow).toBeNull();
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().info).toMatch(/Core characterization is complete/u);
  }, 60000);

  it("opens optional work only when the user explicitly asks for it", async () => {
    const store = await connectedStore();
    await completeCore(store);
    store.continueToNextTest({ includeOptional: true });
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().guidedFlow).not.toBeNull();
  }, 60000);
});
