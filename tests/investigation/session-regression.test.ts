import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { MatrixStore } from "../../src/ui/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";

/**
 * A synthetic reconstruction of the real retry-heavy physical session.
 *
 * That session produced 35 transactions, one Graffiti payload transmitted 21
 * times and one Animation payload 10 times. Some repeats were the user
 * deliberately asking to measure again after missing a timing event; the
 * report could not say which, showed "Observations: None recorded", and ended
 * with a stale generic recommendation.
 *
 * The shape reproduced here is what mattered: repeated identical payloads
 * mixed with a genuine controlled variant, several observations, and a valid
 * completion. Identical bytes must not be reported as a workflow problem, and
 * the semantic structure must survive into the report.
 */
async function session(): Promise<MatrixStore> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const store = new MatrixStore(new MatrixController(transport, new TraceRecorder()), transport);
  await store.connect();
  await store.identify();
  return store;
}

const flow = (store: MatrixStore) => store.getSnapshot().guidedFlow!;

function answerRemaining(store: MatrixStore): void {
  for (const step of flow(store).steps) {
    if (step.spec.kind === "boolean") store.setGuidedObservation({ kind: "boolean", fieldId: step.spec.id, value: "yes" });
    if (step.spec.kind === "choice") store.setGuidedObservation({ kind: "choice", fieldId: step.spec.id, optionId: step.spec.options[0]!.id });
  }
}

/** Baseline timing with two missed observations before a good one. */
async function retryHeavyBaseline(store: MatrixStore): Promise<void> {
  store.startGuidedTest("coolledux-graffiti-timing");
  await store.confirmGuidedTransfer();
  store.markObservationMissed("missed-t1");
  await store.retryTimingAttempt();
  store.recordGuidedTimeline("event");
  store.markObservationMissed("missed-t2");
  await store.retryTimingAttempt();
  store.recordGuidedTimeline("event");
  store.recordGuidedTimeline("event");
  answerRemaining(store);
  store.submitGuidedObservations();
}

describe("retry-heavy session regression", () => {
  it("keeps three attempts as one experiment on one milestone", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    const runs = store.controller.experiments.filter((run) => run.definitionId === "coolledux-graffiti-timing");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.attempts).toHaveLength(3);
    expect(runs[0]!.attempts.filter((attempt) => attempt.validity === "invalid")).toHaveLength(2);
    // Three transmissions of identical bytes, and every one is accounted for.
    const transfers = store.controller.transfers;
    expect(transfers).toHaveLength(3);
    expect(new Set(transfers.map((transfer) => transfer.fingerprint.key)).size).toBe(1);
    expect(store.controller.transferSummary().unclassifiedDuplicates).toBe(0);
  }, 60000);

  it("does not call legitimate retries a workflow problem", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("## Diagnostic transfer summary");
    expect(report).toContain("Unclassified duplicate transfers: 0");
    expect(report).not.toContain("POSSIBLE WORKFLOW ISSUE");
    // Identical payloads are explained rather than flagged.
    expect(report).toContain("Repeated payloads:");
    expect(report).toContain("explicit retry after a missed observation");
  }, 60000);

  it("reports attempts, their reasons, and why invalid ones were excluded", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("## Experiments and attempts");
    expect(report).toContain("Attempt 1");
    expect(report).toContain("Attempt 3");
    expect(report).toContain("INVALID");
    expect(report).toContain("excluded from conclusions");
    expect(report).toContain("transfer reason:");
  }, 60000);

  it("reports the core plan, including what was skipped and why", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("## Investigation progress");
    // The denominator is every slot in the plan and never moves; completion
    // counts skipped slots as resolved.
    expect(report).toMatch(/Core plan: \d+ \/ 6 slots resolved \(\d+ completed, \d+ skipped\)/u);
    expect(report).toContain("Still image baseline");
  }, 60000);

  it("distinguishes a controlled variant from a retry", async () => {
    const store = await session();
    // Baseline moves, then the genuinely different stayTime=0 experiment.
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.recordGuidedTimeline("event");
    store.recordGuidedTimeline("event");
    answerRemaining(store);
    store.submitGuidedObservations();
    store.continueToNextTest();
    expect(flow(store).testId).toBe("coolledux-graffiti-staytime");
    await store.confirmGuidedTransfer();

    const fingerprints = store.controller.transfers.map((transfer) => transfer.fingerprint);
    // Different experiments, different identities — not a duplicate.
    expect(new Set(fingerprints.map((entry) => entry.key)).size).toBe(2);
    expect(fingerprints[0]!.parameterKey).toBe("stayTime=3");
    expect(fingerprints[1]!.parameterKey).toBe("stayTime=0");
    expect(store.controller.transferSummary().unclassifiedDuplicates).toBe(0);
  }, 60000);

  it("carries physical observations into the report instead of 'none recorded'", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("## Structured physical observations");
    expect(report).not.toMatch(/Structured physical observations\s*\n\s*\nNone recorded/u);
  }, 60000);

  it("ends with the current engine's next step, not a stale generic suggestion", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("## Next step");
    expect(report).not.toContain("Validate static framebuffer with the guided orientation/color diagnostic");
  }, 60000);

  it("defaults the share dialog to the investigation report during an investigation", async () => {
    const store = await session();
    await retryHeavyBaseline(store);
    store.openReport();
    expect(store.getSnapshot().reportKind).toBe("investigation");
    expect(store.getSnapshot().reportMarkdown).toContain("# MatrixSmith Hardware Investigation Report");
    // The legacy view stays reachable and says plainly what it does not include.
    store.setReportKind("device");
    const legacy = store.getSnapshot().reportMarkdown;
    expect(legacy).toContain("# MatrixSmith Low-Level Device Report");
    expect(legacy).toContain("## Scope of this report");
    expect(legacy).toContain("Use the Investigation report");
  }, 60000);
});
