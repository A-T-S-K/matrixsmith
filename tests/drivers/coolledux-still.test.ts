import { describe, expect, it } from "vitest";
import { stillTests } from "../../src/drivers/coolledux/still-tests";
import {
  diagnosticContent,
  stillGeometryReason,
} from "../../src/drivers/coolledux/diagnostics";
import { evaluateStaticViability } from "../../src/investigation/static-viability";
import { evaluateTestAvailability } from "../../src/investigation/tests";
import type { ClaimEvidence } from "../../src/investigation/claims";
import type { ObservationValue } from "../../src/investigation/observations";
import { coolLedUxCapabilities } from "../../src/drivers/coolledux";
import { iledHat31aeProfile } from "../../src/profiles/iledhat-31ae-32x16";
const profile = {
  ...iledHat31aeProfile,
  id: "provisional:coolledux:16x16",
  width: 16,
  evidence: [],
  validation: "experimental" as const,
  metadata: {},
};
const yes = (fieldId: string): ObservationValue => ({
  fieldId,
  kind: "boolean",
  value: "yes",
});
function bootstrap(hold = 15000): ObservationValue[] {
  return [
    yes("initial"),
    yes("coverage"),
    yes("layout"),
    { fieldId: "moved", kind: "boolean", value: "no" },
    {
      fieldId: "visible",
      kind: "duration",
      milliseconds: 100,
      measuredBy: "matrixsmith-timer",
    },
    {
      fieldId: "end",
      kind: "duration",
      milliseconds: 100 + hold,
      measuredBy: "matrixsmith-timer",
    },
  ];
}
const evidence = (
  updates: ReturnType<
    ReturnType<typeof stillTests>[number]["interpret"]
  >["claimUpdates"],
): ClaimEvidence[] =>
  updates.map((update) => ({
    ...update,
    scope: "current-session",
    provenance: "observed",
  }));
describe("bounded still route", () => {
  it.each([16, 32, 48])(
    "uses actual eight-column tiles at width %i",
    (width) => {
      const regions = diagnosticContent("still-bootstrap").build({
        width,
        height: 16,
      }).regions;
      expect(
        regions.filter((region) => region.groupId === "tiles"),
      ).toHaveLength(width / 8);
      expect(
        regions.filter((region) => region.groupId === "seams"),
      ).toHaveLength(width / 8 - 1);
      expect(
        regions
          .filter((region) => region.groupId === "tiles")
          .every(
            (region) =>
              region.width === 8 &&
              region.description.includes(String(width / 8)),
          ),
      ).toBe(true);
      expect(
        stillTests({ ...profile, width })[0]!.observation[1]!.prompt,
      ).toContain(`${width / 8} eight-column tiles`);
    },
  );
  it("bounds geometry and fixes every operation parameter", () => {
    for (const [width, height] of [
      [8, 16],
      [17, 16],
      [72, 16],
      [32, 8],
      [32, 32],
    ]) {
      expect(stillGeometryReason({ width: width!, height: height! })).toContain(
        "16–64",
      );
      expect(() =>
        diagnosticContent("still-bootstrap").build({
          width: width!,
          height: height!,
        }),
      ).toThrow();
    }
    expect(stillTests({ ...profile, driverId: "coolledx" })).toEqual([]);
    for (const id of ["still-bootstrap", "still-raw-channels", "still-encoder"])
      expect(() => diagnosticContent(id).build(profile, { frames: 2 })).toThrow(
        /no parameters/,
      );
  });
  it("starts without upload, does not infer rendering from no observation, and retains measured threshold", () => {
    const tests = stillTests(profile);
    expect(evaluateTestAvailability(tests[0]!, [], []).available).toBe(true);
    expect(evaluateTestAvailability(tests[1]!, [], []).available).toBe(false);
    expect(tests[0]!.interpret([]).claimUpdates).toEqual([]);
    for (const hold of [0, 14999])
      expect(
        tests[0]!
          .interpret(bootstrap(hold))
          .claimUpdates.some(
            (update) =>
              update.claimId === "animation.static-single-frame" &&
              update.status === "verified",
          ),
      ).toBe(false);
    const guessed = bootstrap().map((value) =>
      value.kind === "duration"
        ? { ...value, measuredBy: "user-estimate" as const }
        : value,
    );
    expect(tests[0]!.interpret(guessed).status).toBe("inconclusive");
    const unsure = bootstrap().map((value) =>
      value.fieldId === "coverage"
        ? {
            fieldId: "coverage",
            kind: "boolean" as const,
            value: "unsure" as const,
          }
        : value,
    );
    expect(tests[0]!.interpret(unsure).claimUpdates).toEqual([]);
  });
  it("contradictory observations close a previously tested route without fabricated replacement evidence", () => {
    const tests = stillTests(profile);
    const colors: ObservationValue[] = ["red", "green", "blue"].map(
      (optionId, index) => ({
        fieldId: `color-${index}`,
        kind: "choice",
        optionId,
      }),
    );
    const pool = [
      ...evidence(tests[0]!.interpret(bootstrap()).claimUpdates),
      ...evidence(tests[1]!.interpret([...colors, yes("black")]).claimUpdates),
      ...evidence(
        tests[2]!.interpret([yes("coverage"), yes("layout"), yes("colors")])
          .claimUpdates,
      ),
    ];
    expect(evaluateStaticViability(pool).selected).toBe(
      "animation-single-frame",
    );
    const contradiction = tests[2]!.interpret([
      yes("coverage"),
      yes("layout"),
      { fieldId: "colors", kind: "boolean", value: "no" },
    ]);
    expect(contradiction.resolution).toBe("settled");
    expect(
      evaluateStaticViability([
        ...pool,
        ...evidence(contradiction.claimUpdates),
      ]).selected,
    ).toBeNull();
    const wrongRaw = tests[1]!.interpret([
      { fieldId: "color-0", kind: "choice", optionId: "blue" },
      ...colors.slice(1),
      yes("black"),
    ]);
    expect(
      evaluateStaticViability([...pool, ...evidence(wrongRaw.claimUpdates)])
        .selected,
    ).toBeNull();
  });
  it("separates raw mapping from encoder verification and selects only the tested route", () => {
    const tests = stillTests(profile);
    let pool = evidence(tests[0]!.interpret(bootstrap()).claimUpdates);
    const colors: ObservationValue[] = ["red", "green", "blue"].map(
      (optionId, index) => ({
        fieldId: `color-${index}`,
        kind: "choice",
        optionId,
      }),
    );
    const raw = tests[1]!.interpret([...colors, yes("black")]);
    expect(raw.claimUpdates.map((update) => update.claimId)).not.toContain(
      "pixel.encoder-correctness",
    );
    pool = [...pool, ...evidence(raw.claimUpdates)];
    expect(evaluateStaticViability(pool).selected).toBeNull();
    expect(
      tests[2]!.interpret([yes("coverage"), yes("layout")]).claimUpdates,
    ).toEqual([]);
    pool.push(
      ...evidence(
        tests[2]!.interpret([yes("coverage"), yes("layout"), yes("colors")])
          .claimUpdates,
      ),
    );
    expect(evaluateStaticViability(pool).selected).toBe(
      "animation-single-frame",
    );
    expect(
      evaluateStaticViability(pool)
        .strategies.filter((strategy) => strategy.verdict === "viable")
        .map((strategy) => strategy.strategy),
    ).toEqual(["animation-single-frame"]);
    expect(pool.map((entry) => entry.claimId)).not.toEqual(
      expect.arrayContaining([
        "animation.timing",
        "gif.playback",
        "brightness.control",
        "power.control",
      ]),
    );
    const caps = coolLedUxCapabilities(profile);
    expect(caps.find((cap) => cap.id === "static-frame")).toMatchObject({
      live: true,
      validation: "experimental",
    });
    expect(caps.find((cap) => cap.id === "animation")).toMatchObject({
      live: false,
    });
  });
});
