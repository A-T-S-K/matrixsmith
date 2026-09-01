import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { uncharacterizedController } from "../helpers/uncharacterized-device";
import type { ObservationValue } from "../../src/investigation/observations";
import { MINIMUM_STATIC_HOLD_MS } from "../../src/investigation/static-viability";

/**
 * Finishability.
 *
 * Guided mode must reach a support decision in a bounded number of DISTINCT
 * experiments, on every plausible branch. The user who reported an endless
 * static-image loop was not wrong about the experience: nothing in the system
 * promised the work would end. These simulate the branches and hold the line.
 *
 * Retries are deliberately not counted — a human missing a timing event says
 * nothing about whether the plan converges.
 */
const MAX_DISTINCT_CORE_EXPERIMENTS = 7;

async function controller(): Promise<MatrixController> {
  // Finishability is a property of characterizing an UNKNOWN device. Run
  // against the productionized iLedHat these would pass without walking
  // anywhere, because its plan is already complete on connect.
  const { controller: instance } = await uncharacterizedController();
  await instance.runDiagnostic("coolledux-identify");
  instance.ensureInvestigation();
  return instance;
}

const timer = (fieldId: string, milliseconds: number): ObservationValue =>
  ({ kind: "duration", fieldId, milliseconds, measuredBy: "matrixsmith-timer" });

/** A timing run that stayed still past the stability threshold. */
function heldStill(): ObservationValue[] {
  return [
    { kind: "boolean", fieldId: "initial-correct", value: "yes" },
    timer("image-visible", 1200),
    { kind: "boolean", fieldId: "moved", value: "no" },
    timer("observation-end", 1200 + MINIMUM_STATIC_HOLD_MS + 500),
  ];
}

/**
 * The sub-threshold case: the person watched, saw nothing move, and stopped
 * after seven seconds of a fifteen-second requirement.
 */
function heldStillTooBriefly(): ObservationValue[] {
  return [
    { kind: "boolean", fieldId: "initial-correct", value: "yes" },
    timer("image-visible", 1200),
    { kind: "boolean", fieldId: "moved", value: "no" },
    timer("observation-end", 1200 + 7000),
  ];
}

/** A timing run that rendered and then began moving. */
function moved(): ObservationValue[] {
  return [
    { kind: "boolean", fieldId: "initial-correct", value: "yes" },
    timer("image-visible", 1200),
    { kind: "boolean", fieldId: "moved", value: "yes" },
    timer("movement-start", 4400),
  ];
}

function channelsMapped(): ObservationValue[] {
  const answers: Record<number, string> = {
    0x0000: "off", 0x0f00: "red", 0x00f0: "green", 0x000f: "blue", 0x0fff: "neutral-white",
    0x1000: "off", 0x2000: "off", 0x4000: "off", 0x8000: "off", 0xf000: "off", 0xffff: "neutral-white",
  };
  return Object.entries(answers).map(([word, optionId]) => ({
    kind: "choice" as const,
    fieldId: `patch-0x${Number(word).toString(16).padStart(4, "0")}`,
    optionId,
  }));
}

const blackIsOff = (): ObservationValue[] => [
  { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
  { kind: "choice", fieldId: "workaround-appearance", optionId: "dim-blue" },
];

const animationStatic = (still: boolean): ObservationValue[] => [
  { kind: "boolean", fieldId: "initial-correct", value: "yes" },
  timer("image-visible", 1100),
  { kind: "boolean", fieldId: "moved", value: still ? "no" : "yes" },
  ...(still ? [timer("observation-end", 1100 + MINIMUM_STATIC_HOLD_MS + 400)] : [timer("movement-start", 3000)]),
  { kind: "boolean", fieldId: "background-off", value: "yes" },
  { kind: "boolean", fieldId: "tiles-aligned", value: "yes" },
];

/**
 * Walk the plan by always taking the engine's next recommendation, feeding it
 * the scripted outcome, and counting distinct experiments until the core plan
 * says it is done.
 */
async function walk(outcomes: Readonly<Record<string, () => ObservationValue[]>>): Promise<{ distinct: string[]; complete: boolean }> {
  const instance = await controller();
  const distinct: string[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const progress = instance.corePlanProgress();
    if (progress?.complete) return { distinct, complete: true };
    const next = instance.recommendations()[0];
    if (!next) break;
    const outcome = outcomes[next.testId];
    // An unscripted branch means the walk left the modelled paths.
    if (!outcome) break;
    distinct.push(next.testId);
    await instance.runGuidedTestTransfer(next.testId, { confirmedConsequence: true, reason: "initial-experiment", attemptId: `attempt:${guard}` });
    instance.recordGuidedTestObservations(next.testId, outcome(), []);
  }
  const progress = instance.corePlanProgress();
  return { distinct, complete: progress?.complete ?? false };
}

describe("core plan finishability", () => {
  it("PATH A — the native still image holds steady", async () => {
    const { distinct, complete } = await walk({
      "coolledux-graffiti-timing": heldStill,
      "coolledux-graffiti-black": blackIsOff,
      "coolledux-pixel-channels": channelsMapped,
    });
    expect(complete).toBe(true);
    // A plan that was already complete would satisfy everything below without
    // walking anywhere; these paths must actually run experiments.
    expect(distinct.length).toBeGreaterThan(0);
    expect(distinct.length).toBeLessThanOrEqual(MAX_DISTINCT_CORE_EXPERIMENTS);
    expect(new Set(distinct).size).toBe(distinct.length);
  }, 60000);

  it("PATH B — the baseline moves but the alternative setting holds", async () => {
    const { distinct, complete } = await walk({
      "coolledux-graffiti-timing": moved,
      "coolledux-graffiti-staytime": heldStill,
      "coolledux-graffiti-black": blackIsOff,
      "coolledux-pixel-channels": channelsMapped,
    });
    expect(complete).toBe(true);
    // A plan that was already complete would satisfy everything below without
    // walking anywhere; these paths must actually run experiments.
    expect(distinct.length).toBeGreaterThan(0);
    expect(distinct.length).toBeLessThanOrEqual(MAX_DISTINCT_CORE_EXPERIMENTS);
    expect(new Set(distinct).size).toBe(distinct.length);
  }, 60000);

  it("PATH C — both native settings move, the animation fallback holds", async () => {
    const { distinct, complete } = await walk({
      "coolledux-graffiti-timing": moved,
      "coolledux-graffiti-staytime": moved,
      "coolledux-animation-static": () => animationStatic(true),
      "coolledux-graffiti-black": blackIsOff,
      "coolledux-pixel-channels": channelsMapped,
    });
    expect(complete).toBe(true);
    // A plan that was already complete would satisfy everything below without
    // walking anywhere; these paths must actually run experiments.
    expect(distinct.length).toBeGreaterThan(0);
    expect(distinct.length).toBeLessThanOrEqual(MAX_DISTINCT_CORE_EXPERIMENTS);
    expect(new Set(distinct).size).toBe(distinct.length);
  }, 60000);

  it("PATH D — nothing holds a still image: core still reaches a decision", async () => {
    const { distinct, complete } = await walk({
      "coolledux-graffiti-timing": moved,
      "coolledux-graffiti-staytime": moved,
      "coolledux-animation-static": () => animationStatic(false),
      "coolledux-animation-static-pair": () => animationStatic(false),
      "coolledux-graffiti-black": blackIsOff,
      "coolledux-pixel-channels": channelsMapped,
    });
    expect(complete).toBe(true);
    // A plan that was already complete would satisfy everything below without
    // walking anywhere; these paths must actually run experiments.
    expect(distinct.length).toBeGreaterThan(0);
    expect(distinct.length).toBeLessThanOrEqual(MAX_DISTINCT_CORE_EXPERIMENTS);
    expect(new Set(distinct).size).toBe(distinct.length);
  }, 60000);

  it("PATH E — a short measurement offers to measure again and does not advance", async () => {
    const instance = await controller();
    const before = instance.corePlanProgress()!;

    // The user watches for seven seconds and stops. Nothing is concluded.
    await instance.runGuidedTestTransfer("coolledux-graffiti-timing", { confirmedConsequence: true, reason: "initial-experiment", attemptId: "attempt:1" });
    instance.recordGuidedTestObservations("coolledux-graffiti-timing", heldStillTooBriefly(), []);

    expect(instance.retryableExperimentIds()).toContain("coolledux-graffiti-timing");
    const stability = instance.claims().find((claim) => claim.id === "graffiti.playback-stability");
    expect(stability?.status).not.toBe("verified");
    expect(stability?.status).not.toBe("rejected");
    // The stability milestone has NOT advanced past its question.
    const after = instance.corePlanProgress()!;
    expect(after.total).toBe(before.total);
    expect(after.steps.find((entry) => entry.step.id === "playback-discriminator")!.state).not.toBe("complete");
    expect(after.complete).toBe(false);

    // Measuring the same experiment again, properly, continues the plan.
    await instance.runGuidedTestTransfer("coolledux-graffiti-timing", { confirmedConsequence: true, reason: "explicit-measure-again", attemptId: "attempt:2" });
    instance.recordGuidedTestObservations("coolledux-graffiti-timing", heldStill(), []);
    expect(instance.retryableExperimentIds()).not.toContain("coolledux-graffiti-timing");
    expect(instance.corePlanProgress()!.steps.find((entry) => entry.step.id === "playback-discriminator")!.state).toBe("complete");

    // And from there the plan still terminates in the bounded number of
    // distinct experiments — the incomplete measurement cost nothing but time.
    for (let guard = 0; guard < 10 && !instance.corePlanProgress()!.complete; guard += 1) {
      const next = instance.recommendations()[0];
      if (!next) break;
      const outcome = ({
        "coolledux-graffiti-black": blackIsOff,
        "coolledux-pixel-channels": channelsMapped,
      } as Record<string, () => ObservationValue[]>)[next.testId];
      if (!outcome) break;
      await instance.runGuidedTestTransfer(next.testId, { confirmedConsequence: true, reason: "initial-experiment", attemptId: `attempt:e${guard}` });
      instance.recordGuidedTestObservations(next.testId, outcome(), []);
    }
    const final = instance.corePlanProgress()!;
    expect(final.complete).toBe(true);
    expect(final.total).toBe(6);
    expect(final.resolved).toBe(6);
  }, 60000);

  it("keeps the denominator at six on every modelled path", async () => {
    const paths: Readonly<Record<string, () => ObservationValue[]>>[] = [
      { "coolledux-graffiti-timing": heldStill, "coolledux-graffiti-black": blackIsOff, "coolledux-pixel-channels": channelsMapped },
      { "coolledux-graffiti-timing": moved, "coolledux-graffiti-staytime": heldStill, "coolledux-graffiti-black": blackIsOff, "coolledux-pixel-channels": channelsMapped },
      { "coolledux-graffiti-timing": moved, "coolledux-graffiti-staytime": moved, "coolledux-animation-static": () => animationStatic(true), "coolledux-graffiti-black": blackIsOff, "coolledux-pixel-channels": channelsMapped },
    ];
    for (const outcomes of paths) {
      const instance = await controller();
      const total = instance.corePlanProgress()!.total;
      expect(total).toBe(6);
      for (let guard = 0; guard < 20; guard += 1) {
        const progress = instance.corePlanProgress()!;
        // The invariant under test: the denominator never moves, whatever
        // the branch does to the milestones themselves.
        expect(progress.total).toBe(6);
        expect(progress.resolved).toBe(progress.completed + progress.skipped);
        if (progress.complete) break;
        const next = instance.recommendations()[0];
        const outcome = next ? outcomes[next.testId] : undefined;
        if (!next || !outcome) break;
        await instance.runGuidedTestTransfer(next.testId, { confirmedConsequence: true, reason: "initial-experiment", attemptId: `attempt:${guard}` });
        instance.recordGuidedTestObservations(next.testId, outcome(), []);
      }
      expect(instance.corePlanProgress()!.total).toBe(6);
    }
  }, 60000);

  it("never repeats an experiment on any modelled path", async () => {
    const paths: Readonly<Record<string, () => ObservationValue[]>>[] = [
      { "coolledux-graffiti-timing": heldStill, "coolledux-graffiti-black": blackIsOff, "coolledux-pixel-channels": channelsMapped },
      { "coolledux-graffiti-timing": moved, "coolledux-graffiti-staytime": heldStill, "coolledux-graffiti-black": blackIsOff, "coolledux-pixel-channels": channelsMapped },
    ];
    for (const outcomes of paths) {
      const { distinct } = await walk(outcomes);
      expect(new Set(distinct).size, distinct.join(" → ")).toBe(distinct.length);
    }
  }, 60000);
});
