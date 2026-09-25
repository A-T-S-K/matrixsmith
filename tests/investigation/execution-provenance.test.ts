import { describe, expect, it } from "vitest";
import {
  saveInvestigation,
  loadInvestigationHistory,
  toHistoricalInvestigation,
} from "../../src/storage/investigations";
import type { KeyValueStorage } from "../../src/storage/repository";
import type { DeviceFingerprint } from "../../src/core/device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import {
  uncharacterizedController,
  uncharacterizedRegistry,
} from "../helpers/uncharacterized-device";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import type { ObservationValue } from "../../src/investigation/observations";

/**
 * A completed test is report evidence forever. It is not proof that anything
 * ran on the display in front of you.
 *
 * An audit found historical results from device A still counting as
 * current-device execution on device B: satisfying `requiresCompletedTests`
 * and suppressing recommendations, so one panel's work stood in for
 * another's. The link between a result and the run that produced it is what
 * tells those apart.
 */

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function secondPhysicalDevice(): DeviceFingerprint {
  return { ...knownIledHatFingerprint(), browserDeviceId: "fixture-device-2" };
}

async function deviceWith(
  fingerprint: DeviceFingerprint,
): Promise<ApplicationRuntime> {
  const transport = new ScriptedCoolLedUxDevice(fingerprint);
  const controller = new ApplicationRuntime(
    transport,
    new TraceRecorder(),
    uncharacterizedRegistry(),
  );
  await controller.connect();
  return controller;
}

const timer = (fieldId: string, milliseconds: number): ObservationValue => ({
  kind: "duration",
  fieldId,
  milliseconds,
  measuredBy: "matrixsmith-timer",
});

const baselineMoved: ObservationValue[] = [
  { kind: "boolean", fieldId: "initial-correct", value: "yes" },
  timer("image-visible", 1200),
  { kind: "boolean", fieldId: "moved", value: "yes" },
  timer("movement-start", 4400),
];

describe("results link to the run that produced them", () => {
  it("stamps every new result with a real experiment run", async () => {
    const { controller } = await uncharacterizedController();
    const completed = controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    expect(completed.experimentRunId).toBeTruthy();
    const run = controller.experiments.find(
      (entry) => entry.experimentRunId === completed.experimentRunId,
    );
    expect(run).toBeDefined();
    expect(run!.definitionId).toBe("coolledux-graffiti-timing");
  }, 30000);

  it("keeps the result's resolution identical to its run's after settlement", async () => {
    const { controller } = await uncharacterizedController();
    const completed = controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    const run = controller.experiments.find(
      (entry) => entry.experimentRunId === completed.experimentRunId,
    )!;
    expect(run.resolution).toBe(completed.resolution);
    expect(run.status).toBe(completed.status);
    expect(run.completedAt).not.toBeNull();
  }, 30000);

  it("ties repeated measurements of one experiment to the same run", async () => {
    const { controller } = await uncharacterizedController();
    // A short observation leaves the run repeatable; measuring again produces
    // a second result against the SAME run.
    const short = controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      [
        { kind: "boolean", fieldId: "initial-correct", value: "yes" },
        timer("image-visible", 1200),
        { kind: "boolean", fieldId: "moved", value: "no" },
        timer("observation-end", 1200 + 7000),
      ],
      [],
    );
    expect(short.resolution).toBe("retryable-incomplete");
    const again = controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    expect(again.experimentRunId).toBe(short.experimentRunId);
    expect(
      controller.experiments.filter(
        (run) => run.definitionId === "coolledux-graffiti-timing",
      ),
    ).toHaveLength(1);
  }, 30000);

  it("gives an explicit reopen a new run", async () => {
    const { controller } = await uncharacterizedController();
    const first = controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    controller.reopenExperiment(
      "coolledux-graffiti-timing",
      "double-checking the onset",
    );
    const second = controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    expect(second.experimentRunId).not.toBe(first.experimentRunId);
    expect(
      controller.experiments.filter(
        (run) => run.definitionId === "coolledux-graffiti-timing",
      ),
    ).toHaveLength(2);
  }, 30000);
});

describe("historical results do not count as current-device execution", () => {
  it("still requires device B to run its own baseline", async () => {
    const storage = memoryStorage();
    const deviceA = await deviceWith(knownIledHatFingerprint());
    deviceA.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    // Device A may now run the stayTime variant, which requires the baseline.
    expect(
      deviceA
        .guidedTests()
        .find((entry) => entry.test.id === "coolledux-graffiti-staytime")
        ?.available,
    ).toBe(true);
    saveInvestigation(deviceA.investigation!, storage);

    const deviceB = await deviceWith(secondPhysicalDevice());
    deviceB.adoptInvestigation(
      toHistoricalInvestigation(
        loadInvestigationHistory(storage)[0]!.investigation,
      ),
    );

    // The record came across as evidence…
    expect(deviceB.recordedTests().length).toBeGreaterThan(0);
    // …but nothing ran here, so the prerequisite is not satisfied.
    expect(deviceB.executedTests()).toEqual([]);
    const staytime = deviceB
      .guidedTests()
      .find((entry) => entry.test.id === "coolledux-graffiti-staytime")!;
    expect(staytime.available).toBe(false);
    expect(staytime.missingCompletedTests).toEqual([
      "coolledux-graffiti-timing",
    ]);
  }, 30000);

  it("does not let a historical completion suppress the current device's experiment", async () => {
    const storage = memoryStorage();
    const deviceA = await deviceWith(knownIledHatFingerprint());
    deviceA.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    expect(
      deviceA
        .recommendations()
        .some((entry) => entry.testId === "coolledux-graffiti-timing"),
    ).toBe(false);
    saveInvestigation(deviceA.investigation!, storage);

    const deviceB = await deviceWith(secondPhysicalDevice());
    deviceB.adoptInvestigation(
      toHistoricalInvestigation(
        loadInvestigationHistory(storage)[0]!.investigation,
      ),
    );
    // Device B has measured nothing, so the baseline timing run is still its
    // next step — and is still the top recommendation, not a retired one.
    expect(deviceB.recommendations()[0]?.testId).toBe(
      "coolledux-graffiti-timing",
    );
    expect(deviceB.corePlanProgress()!.current?.step.testIds).toContain(
      "coolledux-graffiti-timing",
    );
  }, 30000);

  it("preserves execution continuity when the same authorized device resumes", async () => {
    const storage = memoryStorage();
    const deviceA = await deviceWith(knownIledHatFingerprint());
    deviceA.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      baselineMoved,
      [],
    );
    saveInvestigation(deviceA.investigation!, storage);

    const resumed = await deviceWith(knownIledHatFingerprint());
    resumed.adoptInvestigation(
      toHistoricalInvestigation(
        loadInvestigationHistory(storage)[0]!.investigation,
      ),
    );
    // Same physical display: the execution record legitimately continues.
    expect(resumed.executedTests().map((test) => test.testId)).toEqual([
      "coolledux-graffiti-timing",
    ]);
    expect(
      resumed
        .guidedTests()
        .find((entry) => entry.test.id === "coolledux-graffiti-staytime")
        ?.available,
    ).toBe(true);
  }, 30000);
});
