import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
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
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const instance = new MatrixController(transport, new TraceRecorder());
  await instance.connect();
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
    expect(distinct.length).toBeLessThanOrEqual(MAX_DISTINCT_CORE_EXPERIMENTS);
    expect(new Set(distinct).size).toBe(distinct.length);
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
