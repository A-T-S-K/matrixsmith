import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { aggregateAttemptDurations, approximateSeconds, describeAttempt, type ObservationAttempt } from "../../src/investigation/timing";

/**
 * Human-timed observation is forgiving by design: a person watching a physical
 * panel will sometimes tap late, tap early, or miss the event entirely. None
 * of that may become evidence about the hardware.
 */
async function timingStore(): Promise<MatrixStore> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
  await store.connect();
  await store.identify();
  store.startGuidedTest("coolledux-graffiti-timing");
  await store.confirmGuidedTransfer();
  return store;
}

const flow = (store: MatrixStore) => store.getSnapshot().guidedFlow!;

describe("observation attempts", () => {
  it("opens an attempt at transfer, carrying the exact experiment parameters", async () => {
    const store = await timingStore();
    const current = flow(store);
    expect(current.attemptNumber).toBe(1);
    expect(current.attempts[0]?.parameters).toEqual({ stayTime: 3 });
    expect(current.observeStage).toBe("timing");
  }, 30000);

  it("records a human mark and lets it be taken back before the next event", async () => {
    const store = await timingStore();
    store.recordGuidedTimeline("event");
    expect(flow(store).values["image-visible"]).toMatchObject({ measuredBy: "matrixsmith-timer" });
    expect(flow(store).canUndoMark).toBe(true);
    store.undoLastMark();
    // Undo removes the mark AND the boolean the mark implied.
    expect(flow(store).values["image-visible"]).toBeUndefined();
    expect(flow(store).values["initial-correct"]).toBeUndefined();
    expect(flow(store).canUndoMark).toBe(false);
  }, 30000);

  it("treats \"I missed it\" as an invalid measurement, never as hardware evidence", async () => {
    const store = await timingStore();
    store.recordGuidedTimeline("event");
    store.markObservationMissed("missed-t2");
    const current = flow(store);
    expect(current.attempts[0]?.validity).toBe("missed-t2");
    expect(current.attempts[0]?.invalidationReason).toContain("missed");
    // Crucially: nothing survives that could be read as "it did not move".
    expect(current.values["moved"]).toBeUndefined();
    expect(current.values["image-visible"]).toBeUndefined();
    expect(Object.keys(current.values)).toHaveLength(0);
    // And the user is offered the recovery path rather than a dead end.
    expect(current.awaitingRetryConfirmation).toBe(true);
  }, 30000);

  it("retries the identical experiment as a new attempt, keeping the failed one", async () => {
    const store = await timingStore();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    const current = flow(store);
    expect(current.attemptNumber).toBe(2);
    expect(current.attempts).toHaveLength(2);
    expect(current.attempts[0]?.validity).toBe("missed-t1");
    // A retry repeats a measurement; it must not become a different experiment.
    expect(current.attempts[1]?.parameters).toEqual(current.attempts[0]?.parameters);
    expect(current.observeStage).toBe("timing");
    expect(current.timerStopped).toBe(false);
  }, 30000);

  it("only a valid attempt's observations reach the recorded result", async () => {
    const store = await timingStore();
    store.markObservationMissed("missed-t1");
    await store.retryTimingAttempt();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    for (const step of flow(store).steps) {
      if (step.spec.kind === "boolean") store.setGuidedObservation({ kind: "boolean", fieldId: step.spec.id, value: "yes" });
      if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.options[0]!.id });
    }
    store.submitGuidedObservations();
    const result = flow(store).result!;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.filter((attempt) => attempt.validity === "valid")).toHaveLength(1);
    // The invalid attempt is retained as investigation metadata but supplied
    // no observations of its own.
    expect(result.attempts?.[0]?.values).toEqual([]);
    expect(result.attempts?.[1]?.values.length).toBeGreaterThan(0);
  }, 30000);

  it("keeps an abandoned run's open attempt as incomplete rather than losing the timeline", async () => {
    const store = await timingStore();
    store.recordGuidedTimeline("event");
    store.abandonGuidedTest();
    const completed = store.getSnapshot().investigation?.completedTests.at(-1);
    expect(completed?.status).toBe("abandoned");
    expect(completed?.attempts?.[0]?.validity).toBe("incomplete");
  }, 30000);
});

describe("human timing provenance", () => {
  const attempt = (overrides: Partial<ObservationAttempt> = {}): ObservationAttempt => ({
    attemptNumber: 1, parameters: { stayTime: 3 }, t0: "2026-08-31T20:31:10.000Z",
    marks: [{ event: "visible", timestamp: "2026-08-31T20:31:11.400Z", source: "human-observed", elapsedMs: 1400, fieldId: "image-visible" }],
    values: [], validity: "valid", invalidationReason: null, note: null,
    startedAt: "2026-08-31T20:31:10.000Z", endedAt: null, ...overrides,
  });

  it("reports human-observed durations approximately, not to the millisecond", () => {
    expect(approximateSeconds(3237)).toBe("~3.2 s");
    expect(approximateSeconds(15_240)).toBe("~15.2 s");
  });

  it("labels the transport mark as automatic and the taps as human observations", () => {
    const lines = describeAttempt(attempt()).join("\n");
    expect(lines).toContain("automatically measured");
    expect(lines).toContain("human observed");
    expect(lines).toContain("Parameters: stayTime=3");
  });

  it("states why an invalid attempt is excluded", () => {
    const lines = describeAttempt(attempt({ validity: "missed-t2", invalidationReason: "The moment movement began was missed" })).join("\n");
    expect(lines).toContain("INVALID");
    expect(lines).toContain("Excluded from conclusions.");
  });

  it("summarises repeated human observations as a range and median, not statistics", () => {
    expect(aggregateAttemptDurations([])).toBeNull();
    expect(aggregateAttemptDurations([3400])).toMatchObject({ count: 1, representativeMs: 3400 });
    const three = aggregateAttemptDurations([3400, 3100, 3300])!;
    expect(three.minMs).toBe(3100);
    expect(three.maxMs).toBe(3400);
    expect(three.representativeMs).toBe(3300);
  });
});
