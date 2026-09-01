import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import type { DeviceFingerprint } from "../../src/core/device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { saveInvestigation, toHistoricalInvestigation } from "../../src/storage/investigations";
import type { KeyValueStorage } from "../../src/storage/repository";
import { loadInvestigationHistory } from "../../src/storage/investigations";

/**
 * The full imperfect-human story, across a browser restart.
 *
 * Start test 2, miss the first mark, retry, finish, save, reload, reconnect
 * the same physical display, resume, generate the report. Everything that
 * happened has to still be in it — and nothing that was never observed may
 * have crept in.
 */

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function secondPhysicalDevice(): DeviceFingerprint {
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

/** Attempt 1 misses T1; attempt 2 measures the movement onset cleanly. */
async function runMissedThenValid(store: MatrixStore, testId: string): Promise<void> {
  store.startGuidedTest(testId);
  await store.confirmGuidedTransfer();
  store.markObservationMissed("missed-t1");
  await store.retryTimingAttempt();
  store.recordGuidedTimeline("event");
  store.recordGuidedTimeline("event");
  answerRemaining(store);
  store.submitGuidedObservations();
  store.closeGuidedTest();
}

describe("resuming an investigation after a restart", () => {
  it("keeps every attempt, its validity and its transfer reason", async () => {
    const storage = memoryStorage();
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    saveInvestigation(store.controller.investigation!, storage);

    // A new browser session: fresh controller, fresh store, same display.
    const { store: resumed } = await connectedStore();
    const stored = loadInvestigationHistory(storage)[0]!.investigation;
    resumed.controller.adoptInvestigation(toHistoricalInvestigation(stored));

    const completed = resumed.controller.investigation!.completedTests.at(-1)!;
    expect(completed.attempts).toHaveLength(2);
    expect(completed.attempts![0]).toMatchObject({ attemptNumber: 1, validity: "missed-t1" });
    expect(completed.attempts![1]).toMatchObject({ attemptNumber: 2, validity: "valid" });
    // The invalid attempt still establishes nothing.
    expect(completed.attempts![0]!.values).toEqual([]);

    const run = resumed.controller.experiments.at(-1)!;
    expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(run.attempts.map((attempt) => attempt.reason))
      .toEqual(["initial-experiment", "explicit-retry-missed-observation"]);
    expect(resumed.controller.transfers.map((transfer) => transfer.reason))
      .toEqual(["initial-experiment", "explicit-retry-missed-observation"]);
  }, 60000);

  it("puts the attempts, the transfer reasons and stable numbering in the report", async () => {
    const storage = memoryStorage();
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    saveInvestigation(store.controller.investigation!, storage);

    const { store: resumed } = await connectedStore();
    resumed.controller.adoptInvestigation(toHistoricalInvestigation(loadInvestigationHistory(storage)[0]!.investigation));
    const report = resumed.controller.investigationReportMarkdown();

    expect(report).toContain("## Experiments and attempts");
    expect(report).toContain("Attempt 1");
    expect(report).toContain("Attempt 2");
    expect(report).toContain("INVALID");
    expect(report).toContain("explicit retry after a missed observation");
    // The denominator is stable, so the resumed report numbers the milestone
    // exactly as the user saw it during the session.
    expect(report).toMatch(/Test \d of 6 —/u);
    expect(report).toMatch(/Core plan: \d+ \/ 6 slots resolved/u);
    // Physical timing detail rides along with the attempt it belongs to,
    // so a resumed report can still show what was actually measured.
    expect(report).toContain("T0 upload complete:");
    expect(report).toContain("## Structured physical observations");
  }, 60000);

  it("never claims a diagnostic is currently on the display after a restart", async () => {
    const storage = memoryStorage();
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    saveInvestigation(store.controller.investigation!, storage);

    const { store: resumed } = await connectedStore();
    resumed.controller.adoptInvestigation(toHistoricalInvestigation(loadInvestigationHistory(storage)[0]!.investigation));
    const report = resumed.controller.investigationReportMarkdown();

    expect(report).toContain("## Display program state");
    expect(report).toContain("Last known program sent:");
    expect(report).toContain("Currently on the display: UNKNOWN");
    expect(resumed.controller.panelProgram().certainty).toBe("unknown");
  }, 60000);

  it("still says what is on the display while the session that wrote it is live", async () => {
    const { store } = await connectedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("Currently on the display: guided diagnostic");
    expect(report).not.toContain("Currently on the display: UNKNOWN");
  }, 60000);
});

describe("session reset boundaries", () => {
  it("A. same investigation, same physical device reconnect: continuity", async () => {
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    const id = store.controller.investigation!.id;
    const experiments = store.controller.experiments.length;
    store.controller.applyFingerprint(knownIledHatFingerprint(), "live");
    expect(store.controller.investigation?.id).toBe(id);
    expect(store.controller.experiments).toHaveLength(experiments);
  }, 60000);

  it("B. new physical device, same profile: nothing leaks", async () => {
    const { store, transport } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    transport.fingerprint = secondPhysicalDevice();
    store.controller.applyFingerprint(secondPhysicalDevice(), "live");
    expect(store.controller.investigation).toBeNull();
    expect(store.controller.experiments).toEqual([]);
    expect(store.controller.transfers).toEqual([]);
    expect(store.controller.recommendationTrail).toEqual([]);
    expect(store.controller.reopenedTestIds()).toEqual([]);
    expect(store.controller.panelProgram().certainty).toBe("unknown");
    // A fresh investigation on the new device starts genuinely empty.
    store.controller.startInvestigation({ kind: "develop", description: "second unit" });
    expect(store.controller.investigation!.orchestration.experiments).toEqual([]);
    expect(store.controller.investigation!.completedTests).toEqual([]);
  }, 60000);

  it("C. a new investigation on the same device leaves its orchestration behind as history", async () => {
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    const previous = store.controller.investigation!;
    store.controller.stopActiveInvestigation();
    store.controller.startInvestigation({ kind: "troubleshoot", symptomId: "colors-look-wrong", description: "fresh start" });

    const current = store.controller.investigation!;
    expect(current.id).not.toBe(previous.id);
    // The new investigation is empty; the old one's orchestration went to
    // history with it rather than being inherited or destroyed.
    expect(current.orchestration.experiments).toEqual([]);
    expect(current.orchestration.transfers).toEqual([]);
    expect(current.orchestration.panelProgram.certainty).toBe("unknown");
    const detached = store.controller.takeDetachedInvestigation()!;
    expect(detached.id).toBe(previous.id);
    expect(detached.orchestration.experiments.length).toBeGreaterThan(0);
  }, 60000);

  it("D. an imported bundle carries no live orchestration authority", async () => {
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    const bundle = store.controller.exportBundle();

    const { store: importer } = await connectedStore();
    importer.controller.importBundle(bundle);
    const imported = importer.controller.investigation!;
    // The record survives as evidence…
    expect(imported.orchestration.experiments.length).toBeGreaterThan(0);
    // …with no claim about a physical panel and no current-session evidence.
    expect(imported.orchestration.panelProgram.certainty).toBe("unknown");
    expect(imported.claimEvidence.every((entry) => entry.scope === "imported-external")).toBe(true);
    expect(importer.controller.session.source).toBe("imported");
  }, 60000);

  it("E. a browser restart keeps semantic history and drops panel certainty", async () => {
    const storage = memoryStorage();
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    saveInvestigation(store.controller.investigation!, storage);

    const { store: restarted } = await connectedStore();
    restarted.controller.adoptInvestigation(toHistoricalInvestigation(loadInvestigationHistory(storage)[0]!.investigation));
    expect(restarted.controller.experiments.length).toBeGreaterThan(0);
    expect(restarted.controller.transfers.length).toBeGreaterThan(0);
    expect(restarted.controller.panelProgram().certainty).toBe("unknown");
    expect(restarted.controller.investigation!.claimEvidence.every((entry) => entry.scope === "previous-local-session")).toBe(true);
  }, 60000);

  it("F. forgetting local history removes the orchestration record with it", async () => {
    const storage = memoryStorage();
    const { store } = await connectedStore();
    await runMissedThenValid(store, "coolledux-graffiti-timing");
    saveInvestigation(store.controller.investigation!, storage);
    expect(loadInvestigationHistory(storage)[0]!.investigation.orchestration.experiments.length).toBeGreaterThan(0);
    storage.removeItem("matrixsmith:v1:investigations");
    expect(loadInvestigationHistory(storage)).toEqual([]);
  }, 60000);
});
