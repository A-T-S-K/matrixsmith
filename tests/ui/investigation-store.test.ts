import { createPresentationStore } from "../helpers/presentation-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { PresentationStore } from "../../src/presentation/store";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";

async function identifiedStore(): Promise<{
  transport: ScriptedCoolLedUxDevice;
  store: PresentationStore;
  controller: ApplicationRuntime;
}> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new ApplicationRuntime(transport, new TraceRecorder());
  const store = createPresentationStore(controller, transport);
  await store.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await store.identify();
  transport.notificationOnWrite = null;
  return { transport, store, controller };
}

describe("workspace routing", () => {
  it("opens a known display straight into the control view", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const store = createPresentationStore(
      new ApplicationRuntime(transport, new TraceRecorder()),
      transport,
    );
    await store.connect();
    expect(store.getSnapshot().page).toBe("workspace");
    // Recognized from its own profile: no identification detour.
    expect(store.getSnapshot().view).toBe("control");
    expect(store.getSnapshot().recommended.action).not.toBe("identify");
  });

  it("keeps the protocol workbench as an explicit secondary view", async () => {
    const { store } = await identifiedStore();
    expect(store.getSnapshot().view).not.toBe("develop");
    store.setView("develop");
    expect(store.getSnapshot().view).toBe("develop");
  });
});

describe("claims-derived support map", () => {
  it("groups claims into core/content/optional with honest statuses", async () => {
    const { store } = await identifiedStore();
    const groups = store.getSnapshot().claimGroups;
    expect(groups.map((group) => group.category)).toEqual([
      "core",
      "content",
      "optional",
    ]);
    const content = groups.find((group) => group.category === "content")!;
    // Both were physically settled on this panel — negatively, which is a
    // real answer and must read as one rather than as an open question.
    const stability = content.claims.find(
      (claim) => claim.id === "graffiti.playback-stability",
    );
    expect(stability?.status).toBe("rejected");
    const whiteChannel = content.claims.find(
      (claim) => claim.id === "pixel.white-channel",
    );
    expect(whiteChannel?.status).toBe("rejected");
    // Still genuinely open, and shown as such.
    const calibration =
      groups
        .find((group) => group.category === "optional")!
        .claims.find((claim) => claim.id === "pixel.color-calibration") ??
      content.claims.find((claim) => claim.id === "pixel.color-calibration");
    expect(calibration?.status).toBe("unresolved");
  });
});

describe("path-specific content gating in the store", () => {
  it("opens image, text and animation from this profile's shipped evidence", async () => {
    const { store } = await identifiedStore();
    const gates = store.getSnapshot().contentGates;
    expect(gates.animation.allowed).toBe(true);
    expect(gates.image.allowed).toBe(true);
    expect(gates.text.allowed).toBe(true);
    // GIF depends on a claim this panel has never demonstrated.
    expect(gates.gif.allowed).toBe(false);
    // A verified routine text send is direct and target-bound.
    store.updateContentSettings({ text: "HI" });
    store.requestSendText();
    await vi.waitFor(() => expect(store.getSnapshot().busy).toBeNull(), {
      timeout: 8_000,
    });
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().pendingSend).toBeNull();
    expect(store.getSnapshot().info).toBe("Display updated.");
  });

  it("still refuses a GIF send behind its own gate", async () => {
    const { store } = await identifiedStore();
    store.requestSendGif();
    expect(store.getSnapshot().pendingSend).toBeNull();
    expect(store.getSnapshot().error).toMatch(/GIF/i);
  });

  it("allows an animation send request through its own gate", async () => {
    const { store } = await identifiedStore();
    store.requestSendAnimation();
    await vi.waitFor(() => expect(store.getSnapshot().busy).toBeNull(), {
      timeout: 8_000,
    });
    expect(store.getSnapshot().pendingSend).toBeNull();
    expect(store.getSnapshot().error).toBeNull();
  });
});

describe("guided flow state machine", () => {
  it("walks ABOUT → RUN → OBSERVE → RESULT with a generic recommendation", async () => {
    const { store } = await identifiedStore();
    const next = store.getSnapshot().nextTest;
    expect(next).not.toBeNull();
    store.startGuidedTest("coolledux-graffiti-black");
    let flow = store.getSnapshot().guidedFlow!;
    expect(flow.stage).toBe("about");
    expect(flow.about.question).toContain("workaround");
    expect(flow.regions.length).toBeGreaterThan(0);
    await store.confirmGuidedTransfer();
    flow = store.getSnapshot().guidedFlow!;
    expect(flow.stage).toBe("observe");
    expect(flow.transactionIds.length).toBeGreaterThan(0);
    store.setGuidedObservation({
      kind: "choice",
      fieldId: "zero-appearance",
      optionId: "off-black",
    });
    store.setGuidedObservation({
      kind: "choice",
      fieldId: "workaround-appearance",
      optionId: "dim-blue",
    });
    expect(store.getSnapshot().guidedFlow!.observationsReady).toBe(true);
    store.submitGuidedObservations();
    flow = store.getSnapshot().guidedFlow!;
    expect(flow.stage).toBe("result");
    expect(flow.result?.status).toBe("passed");
    expect(flow.nextTest).not.toBeNull();
    // The result carries the claim change into the support map.
    const contentClaims = store
      .getSnapshot()
      .claimGroups.find((group) => group.category === "content")!.claims;
    expect(
      contentClaims.find((claim) => claim.id === "graffiti.black-semantics")
        ?.status,
    ).toBe("verified");
  }, 30000);

  it("records the T0/T1/T2 timeline as measured duration observations", async () => {
    const { store } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    let flow = store.getSnapshot().guidedFlow!;
    expect(flow.timerSpec).not.toBeNull();
    expect(flow.currentPhase?.id).toBe("visible");
    // T1: the complete image became visible.
    store.recordGuidedTimeline("event");
    flow = store.getSnapshot().guidedFlow!;
    const t1 = flow.values["image-visible"];
    expect(t1?.kind).toBe("duration");
    expect((t1 as { measuredBy: string }).measuredBy).toBe("matrixsmith-timer");
    expect(flow.values["initial-correct"]).toEqual({
      kind: "boolean",
      fieldId: "initial-correct",
      value: "yes",
    });
    expect(flow.currentPhase?.id).toBe("movement");
    // T2: movement began.
    store.recordGuidedTimeline("event");
    flow = store.getSnapshot().guidedFlow!;
    const t2 = flow.values["movement-start"];
    expect(t2?.kind).toBe("duration");
    expect((t2 as { measuredBy: string }).measuredBy).toBe("matrixsmith-timer");
    expect(flow.values.moved).toEqual({
      kind: "boolean",
      fieldId: "moved",
      value: "yes",
    });
    expect(flow.timerStopped).toBe(true);
    store.closeGuidedTest();
  }, 30000);

  it("does not rebuild or publish the application snapshot for timer ticks", async () => {
    const { store } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    let publications = 0;
    const unsubscribe = store.subscribe(() => publications++);

    await new Promise((resolve) => setTimeout(resolve, 250));

    unsubscribe();
    expect(publications).toBe(0);
    store.abandonGuidedTest();
  }, 30000);

  it("records a still stop with the exact measured observation window", async () => {
    const { store } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.recordGuidedTimeline("event"); // T1
    store.recordGuidedTimeline("still"); // stopped while still static
    const flow = store.getSnapshot().guidedFlow!;
    expect(flow.values["observation-end"]?.kind).toBe("duration");
    expect(flow.values.moved).toEqual({
      kind: "boolean",
      fieldId: "moved",
      value: "no",
    });
    expect(flow.values["movement-start"]).toBeUndefined();
    store.closeGuidedTest();
  }, 30000);

  it("records a failed initial render from the timeline", async () => {
    const { store } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    store.recordGuidedTimeline("fail");
    const flow = store.getSnapshot().guidedFlow!;
    expect(flow.values["initial-correct"]).toEqual({
      kind: "boolean",
      fieldId: "initial-correct",
      value: "no",
    });
    expect(flow.values["image-visible"]).toBeUndefined();
    expect(flow.timerStopped).toBe(true);
    store.closeGuidedTest();
  }, 30000);

  it("starts a troubleshooting investigation from a symptom", async () => {
    const { store, controller } = await identifiedStore();
    store.startTroubleshoot("content-moves-unexpectedly");
    expect(controller.investigation?.goal.kind).toBe("troubleshoot");
    expect(store.getSnapshot().view).toBe("diagnose");
    // The symptom's primary focus claim (playback stability) selects the
    // movement measurement as the first discriminator.
    expect(store.getSnapshot().nextTest?.testId).toBe(
      "coolledux-graffiti-timing",
    );
  });
});

describe("transfer protection and abandonment", () => {
  it("projects a failed transfer as an explicit retryable machine state", async () => {
    const { store, transport } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    transport.failWriteAt = transport.writes.length + 1;
    await store.confirmGuidedTransfer();

    const failed = store.getSnapshot().guidedFlow!;
    expect(failed.stage).toBe("failed");
    expect(failed.failure).toMatchObject({ retryable: true });
    expect(failed.failure?.message).toMatch(/write failure/i);
    expect(failed.attempts).toMatchObject([
      { attemptNumber: 1, validity: "transfer-failed" },
    ]);

    transport.failWriteAt = null;
    await store.retryFailedGuidedTransfer();
    expect(store.getSnapshot().guidedFlow?.stage).toBe("observe");
  }, 30000);

  it("cannot dismiss the dialog while a transfer is running", async () => {
    const { store } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-black");
    const flow = store.getSnapshot().guidedFlow!;
    expect(flow.stage).toBe("about");
    // Simulate the running stage by starting the transfer without awaiting.
    const transfer = store.confirmGuidedTransfer();
    if (store.getSnapshot().guidedFlow?.stage === "running") {
      store.closeGuidedTest();
      expect(store.getSnapshot().guidedFlow).not.toBeNull();
    }
    await transfer;
    store.closeGuidedTest();
  }, 30000);

  it("records an abandoned post-transfer test as incomplete evidence with a report", async () => {
    const { store, controller } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    expect(store.getSnapshot().guidedFlow?.stage).toBe("observe");
    store.recordGuidedTimeline("event"); // T1 partial observation
    store.abandonGuidedTest();
    expect(store.getSnapshot().guidedFlow).toBeNull();
    const completed = controller.investigation?.completedTests.at(-1);
    expect(completed?.status).toBe("abandoned");
    expect(completed?.transactionIds.length).toBeGreaterThan(0);
    // No claim conclusions beyond automatic capture.
    expect(
      controller.investigation?.claimEvidence.filter(
        (entry) => entry.testId === "coolledux-graffiti-timing",
      ),
    ).toHaveLength(0);
    // A partial test report is available.
    const report = controller.testReportMarkdown("coolledux-graffiti-timing");
    expect(report).toContain("ABANDONED");
    expect(report).toContain("observation was abandoned");
  }, 30000);

  it("close during observe records incomplete evidence instead of silently discarding", async () => {
    const { store, controller } = await identifiedStore();
    store.startGuidedTest("coolledux-graffiti-black");
    await store.confirmGuidedTransfer();
    store.closeGuidedTest();
    expect(controller.investigation?.completedTests.at(-1)?.status).toBe(
      "abandoned",
    );
  }, 30000);
});
