import { describe, expect, it } from "vitest";
import {
  formatDuration,
  isValidObservationValue,
  observationsComplete,
  observationValueSummary,
  type ObservationFieldSpec,
  type ObservationValue,
} from "../../src/investigation/observations";

const specs: ObservationFieldSpec[] = [
  {
    kind: "choice",
    id: "appearance",
    prompt: "What do you see?",
    options: [
      { id: "off-black", label: "Off / black" },
      { id: "bright-white", label: "Bright white" },
    ],
    allowOther: true,
  },
  { kind: "boolean", id: "still", prompt: "Did the image stay still?" },
  {
    kind: "duration",
    id: "movement-start",
    prompt: "When did movement start?",
    required: false,
  },
  {
    kind: "number",
    id: "bands",
    prompt: "How many bands?",
    unit: "bands",
    required: false,
  },
  { kind: "note", id: "note", prompt: "Anything else?" },
];

describe("structured observations", () => {
  it("summarizes each observation kind with its prompt", () => {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    expect(
      observationValueSummary(byId.get("appearance"), {
        kind: "choice",
        fieldId: "appearance",
        optionId: "off-black",
      }),
    ).toBe("What do you see?: Off / black");
    expect(
      observationValueSummary(byId.get("appearance"), {
        kind: "choice",
        fieldId: "appearance",
        optionId: "other",
        otherText: "purple",
      }),
    ).toContain("other — purple");
    expect(
      observationValueSummary(byId.get("still"), {
        kind: "boolean",
        fieldId: "still",
        value: "no",
        note: "drifted",
      }),
    ).toBe("Did the image stay still?: no — drifted");
    expect(
      observationValueSummary(byId.get("movement-start"), {
        kind: "duration",
        fieldId: "movement-start",
        milliseconds: 3200,
        measuredBy: "matrixsmith-timer",
      }),
    ).toContain("00:03.2 (measured by MatrixSmith)");
    expect(
      observationValueSummary(byId.get("bands"), {
        kind: "number",
        fieldId: "bands",
        value: 4,
      }),
    ).toBe("How many bands?: 4 bands");
    expect(
      observationValueSummary(byId.get("note"), {
        kind: "note",
        fieldId: "note",
        text: "flicker",
      }),
    ).toBe("Anything else?: flicker");
  });

  it("formats durations as mm:ss.t", () => {
    expect(formatDuration(0)).toBe("00:00.0");
    expect(formatDuration(3200)).toBe("00:03.2");
    expect(formatDuration(65_432)).toBe("01:05.4");
  });

  it("treats notes and optional fields as non-blocking for completion", () => {
    const values: ObservationValue[] = [
      { kind: "choice", fieldId: "appearance", optionId: "off-black" },
      { kind: "boolean", fieldId: "still", value: "unsure" },
    ];
    expect(observationsComplete(specs, values)).toBe(true);
    expect(observationsComplete(specs, values.slice(0, 1))).toBe(false);
  });

  it("validates serialized observation values structurally", () => {
    const valid: ObservationValue[] = [
      { kind: "boolean", fieldId: "a", value: "yes" },
      { kind: "choice", fieldId: "b", optionId: "x" },
      {
        kind: "duration",
        fieldId: "c",
        milliseconds: 1500,
        measuredBy: "user-estimate",
      },
      { kind: "number", fieldId: "d", value: 2 },
      { kind: "note", fieldId: "e", text: "hi" },
    ];
    for (const value of valid)
      expect(isValidObservationValue(JSON.parse(JSON.stringify(value)))).toBe(
        true,
      );
    expect(
      isValidObservationValue({
        kind: "boolean",
        fieldId: "a",
        value: "maybe",
      }),
    ).toBe(false);
    expect(
      isValidObservationValue({
        kind: "duration",
        fieldId: "c",
        milliseconds: Number.NaN,
        measuredBy: "matrixsmith-timer",
      }),
    ).toBe(false);
    expect(isValidObservationValue({ kind: "mystery", fieldId: "z" })).toBe(
      false,
    );
    expect(isValidObservationValue(null)).toBe(false);
  });
});
