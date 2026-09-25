import { createPresentationStore } from "../helpers/presentation-fixture";
import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { PresentationStore } from "../../src/presentation/store";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";

/**
 * The staged spatial-observation interaction. These assert the behaviour the
 * redesign depends on: one region question at a time, an unambiguous active
 * region, and answers that survive navigating back and forth.
 */
async function storeAtObserve(testId: string): Promise<PresentationStore> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const store = createPresentationStore(
    new ApplicationRuntime(transport, new TraceRecorder()),
    transport,
  );
  await store.connect();
  await store.identify();
  store.startGuidedTest(testId);
  await store.confirmGuidedTransfer();
  return store;
}

const flow = (store: PresentationStore) => store.getSnapshot().guidedFlow!;

describe("spatial observation flow", () => {
  it("presents the channel test as one zone at a time, not an eleven-question form", async () => {
    const store = await storeAtObserve("coolledux-pixel-channels");
    const current = flow(store);
    expect(current.presentation).toBe("spatial");
    expect(current.stage).toBe("observe");
    // Eleven zone questions plus the free-text note, asked in sequence.
    expect(current.steps).toHaveLength(12);
    expect(current.stepIndex).toBe(0);
    expect(current.steps[0]?.regionId).toBe("black-reference");
  }, 30000);

  it("advances, goes back, and keeps answers while navigating", async () => {
    const store = await storeAtObserve("coolledux-pixel-channels");
    store.setGuidedObservation({
      kind: "choice",
      fieldId: "patch-0x0000",
      optionId: "off",
    });
    store.nextGuidedStep();
    expect(flow(store).stepIndex).toBe(1);
    store.setGuidedObservation({
      kind: "choice",
      fieldId: "patch-0x0f00",
      optionId: "red",
    });
    store.nextGuidedStep();
    expect(flow(store).stepIndex).toBe(2);
    store.previousGuidedStep();
    store.previousGuidedStep();
    expect(flow(store).stepIndex).toBe(0);
    // Earlier answers survive the round trip and stay marked as answered.
    expect(flow(store).values["patch-0x0000"]).toMatchObject({
      optionId: "off",
    });
    expect(flow(store).steps[0]?.answered).toBe(true);
    expect(flow(store).steps[1]?.answered).toBe(true);
    expect(flow(store).steps[2]?.answered).toBe(false);
  }, 30000);

  it("clamps navigation to the available steps", async () => {
    const store = await storeAtObserve("coolledux-pixel-channels");
    store.previousGuidedStep();
    expect(flow(store).stepIndex).toBe(0);
    store.setGuidedStep(999);
    expect(flow(store).stepIndex).toBe(flow(store).steps.length - 1);
  }, 30000);

  it("jumps to a zone's question when that zone is selected on the map", async () => {
    const store = await storeAtObserve("coolledux-pixel-channels");
    store.focusRegion("channel-blue");
    expect(flow(store).steps[flow(store).stepIndex]?.regionId).toBe(
      "channel-blue",
    );
    // An unknown zone must not move the user somewhere arbitrary.
    const before = flow(store).stepIndex;
    store.focusRegion("not-a-zone");
    expect(flow(store).stepIndex).toBe(before);
  }, 30000);

  it("exposes exactly one active region, with its human label and its raw word kept technical", async () => {
    const store = await storeAtObserve("coolledux-pixel-channels");
    store.focusRegion("channel-green");
    const current = flow(store);
    const activeId = current.steps[current.stepIndex]?.regionId;
    const active = current.regions.find((region) => region.id === activeId);
    expect(active?.displayLabel).toBe("Zone 3 · Green test");
    expect(active?.rawWordHex).toBe("0x00F0");
    // The user-facing name never carries the protocol value.
    expect(active?.displayLabel).not.toContain("0x");
  }, 30000);

  it("compares the black candidate against the workaround as two grouped zones", async () => {
    const store = await storeAtObserve("coolledux-graffiti-black");
    const current = flow(store);
    expect(current.steps.map((step) => step.regionId)).toEqual([
      "black-candidate-0",
      "workaround-1",
      null,
    ]);
    const active = current.regions.find(
      (region) => region.id === "black-candidate-0",
    );
    expect(active?.groupId).toBe("black-candidate");
    // The other black tile is a peer, so the question can highlight both.
    expect(
      current.regions.filter((region) => region.groupId === "black-candidate"),
    ).toHaveLength(2);
  }, 30000);

  it("never asks about a zone that is not part of this run", async () => {
    const store = await storeAtObserve("coolledux-pixel-channels");
    const current = flow(store);
    const present = new Set(current.regions.map((region) => region.id));
    for (const step of current.steps) {
      if (step.regionId) expect(present.has(step.regionId)).toBe(true);
    }
  }, 30000);
});

describe("observation presentation", () => {
  it("gives a measured timeline the timed presentation, with region questions following it", async () => {
    const store = await storeAtObserve("coolledux-graffiti-timing");
    const current = flow(store);
    expect(current.presentation).toBe("timed");
    expect(current.observeStage).toBe("timing");
    // Timer-filled fields are never re-asked as questions.
    const askedIds = current.steps.map((step) => step.spec.id);
    expect(askedIds).not.toContain("image-visible");
    expect(askedIds).not.toContain("movement-start");
    expect(askedIds).not.toContain("moved");
    expect(current.questionPresentation).toBe("spatial");
  }, 30000);
});
