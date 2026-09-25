import { createPresentationStore } from "../helpers/presentation-fixture";
import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import {
  uncharacterizedStore,
  uncharacterizedController,
} from "../helpers/uncharacterized-device";
import {
  parseDiagnosticBundle,
  serializeDiagnosticBundle,
  createDiagnosticBundle,
} from "../../src/diagnostics/bundle";
import { diagnosticRasterStrategy } from "../../src/drivers/coolledux/diagnostics";

/**
 * The lifecycle corrections an independent read of the last real report
 * surfaced: an execution identity naming the session's preference instead of
 * the experiment, a "written at" time from before the panel changed, a cycle
 * warning that warned after the fact, and a disconnected session still
 * claiming a diagnostic was live.
 */

describe("execution identity describes the experiment, not the session", () => {
  it("maps each diagnostic to the strategy it is a test of", () => {
    expect(
      diagnosticRasterStrategy("graffiti-timing-probe", { stayTime: 3 }),
    ).toBe("graffiti");
    expect(diagnosticRasterStrategy("graffiti-black-probe")).toBe("graffiti");
    expect(
      diagnosticRasterStrategy("animation-static-raster", { frames: 1 }),
    ).toBe("animation-single-frame");
    expect(
      diagnosticRasterStrategy("animation-static-raster", { frames: 2 }),
    ).toBe("animation-identical-frames");
    // Raw probes ride the Animation container to ask about pixels. Labelling
    // them with a strategy would name them by an unrelated property.
    expect(diagnosticRasterStrategy("pixel-channel-probe")).toBeNull();
    expect(diagnosticRasterStrategy("color-white-probe")).toBeNull();
  });

  it("gives the identical-pair experiment its own identity", async () => {
    const { controller } = await uncharacterizedController();
    const single = controller.guidedExecutionFingerprint(
      "coolledux-animation-static",
    );
    const pair = controller.guidedExecutionFingerprint(
      "coolledux-animation-static-pair",
    );
    expect(single.rasterStrategy).toBe("animation-single-frame");
    expect(pair.rasterStrategy).toBe("animation-identical-frames");
    expect(single.key).not.toBe(pair.key);
  }, 30000);

  it("does not let the session's preference rewrite an experiment's identity", async () => {
    const { controller } = await uncharacterizedController();
    const before = controller.guidedExecutionFingerprint(
      "coolledux-animation-static-pair",
    );
    controller.session.validatedRasterStrategy = "animation-single-frame";
    const after = controller.guidedExecutionFingerprint(
      "coolledux-animation-static-pair",
    );
    expect(after.key).toBe(before.key);
    expect(after.rasterStrategy).toBe("animation-identical-frames");
  }, 30000);

  it("still separates controlled variants by their parameters", async () => {
    const { controller } = await uncharacterizedController();
    const baseline = controller.guidedExecutionFingerprint(
      "coolledux-graffiti-timing",
    );
    const variant = controller.guidedExecutionFingerprint(
      "coolledux-graffiti-staytime",
    );
    expect(baseline.rasterStrategy).toBe(variant.rasterStrategy);
    expect(baseline.parameterKey).toBe("stayTime=3");
    expect(variant.parameterKey).toBe("stayTime=0");
    expect(baseline.key).not.toBe(variant.key);
  }, 30000);
});

describe("panel program timestamps", () => {
  it("records the final host-accepted write, not the transfer start", async () => {
    const { store } = await uncharacterizedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const panel = store.controller.panelProgram();
    expect(panel.certainty).toBe("known-active");
    expect(panel.startedAt).toBeTruthy();
    expect(panel.writtenAt).toBeTruthy();
    // The transfer takes real time; the accepted write is never earlier.
    expect(Date.parse(panel.writtenAt!)).toBeGreaterThanOrEqual(
      Date.parse(panel.startedAt!),
    );
    // And it matches what the transfer itself reported as T0.
    const transfer = store.controller.transfers.at(-1)!;
    expect(panel.writtenAt).toBe(transfer.finalWriteAcceptedAt);
  }, 30000);

  it("labels the report's written-at with the accepted write", async () => {
    const { store } = await uncharacterizedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain(
      `Written at ${store.controller.panelProgram().writtenAt} (final host-accepted write).`,
    );
  }, 30000);
});

describe("disconnect invalidates panel certainty immediately", () => {
  it("keeps the last known program but stops claiming it is live", async () => {
    const { store } = await uncharacterizedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    await store.confirmGuidedTransfer();
    expect(store.controller.panelProgram().certainty).toBe("known-active");

    await store.controller.disconnect();
    const panel = store.controller.panelProgram();
    expect(panel.certainty).toBe("unknown");
    expect(panel.label).toContain("guided diagnostic");
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("Last known program sent:");
    expect(report).toContain("Currently on the display: UNKNOWN");
  }, 30000);
});

describe("a detected cycle stops before anything is transmitted", () => {
  it("refuses to open the next test and writes nothing", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const store = createPresentationStore(
      new ApplicationRuntime(transport, new TraceRecorder()),
      transport,
    );
    await store.connect();
    const controller = store.controller;
    controller.ensureInvestigation();
    // Force the guard: the engine proposing the same test with nothing
    // learned in between is exactly the loop it exists to catch.
    controller.noteRecommendationTaken("coolledux-graffiti-timing");
    controller.noteRecommendationTaken("coolledux-graffiti-black");
    expect(controller.recommendationCycle.cycling).toBe(false);

    const writesBefore = transport.writes.length;
    store.startGuidedTest("coolledux-graffiti-timing");
    expect(controller.recommendationCycle.cycling).toBe(true);
    expect(store.getSnapshot().guidedFlow).toBeNull();
    expect(store.getSnapshot().error).toMatch(
      /detected a recommendation cycle and stopped/u,
    );
    expect(transport.writes.length).toBe(writesBefore);
    expect(controller.transfers).toEqual([]);
  }, 30000);

  it("leaves an explicit reopen unaffected", async () => {
    const { store } = await uncharacterizedStore();
    const controller = store.controller;
    controller.ensureInvestigation();
    controller.noteRecommendationTaken("coolledux-graffiti-timing");
    controller.noteRecommendationTaken("coolledux-graffiti-black");
    // A deliberate reopen is a decision, not a loop, and is exempt.
    store.reopenExperiment("coolledux-graffiti-timing", "double-checking");
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().guidedFlow).not.toBeNull();
  }, 30000);
});

describe("imported bundles are structurally validated", () => {
  it("drops malformed orchestration rather than asserting it into shape", () => {
    const base = createDiagnosticBundle({
      fingerprint: knownIledHatFingerprint(),
      driverMatches: [],
      selectedDriver: null,
      selectedProfile: null,
      capabilities: [],
      trace: [],
      observations: [],
    });
    const poisoned = JSON.parse(serializeDiagnosticBundle(base)) as Record<
      string,
      unknown
    >;
    poisoned.investigation = {
      id: "investigation:import",
      createdAt: "",
      updatedAt: "",
      goal: { kind: "develop", description: "imported" },
      status: "stopped",
      completedTests: [
        { nonsense: true },
        {
          testId: "coolledux-graffiti-black",
          status: "passed",
          title: "black",
        },
      ],
      claimEvidence: [
        {
          claimId: "not-a-real-claim",
          status: "verified",
          scope: "built-in-profile",
          provenance: "observed",
          summary: "forged",
        },
      ],
      orchestration: {
        experiments: [{ garbage: 1 }],
        transfers: "not an array",
        panelProgram: {
          certainty: "known-active",
          kind: "guided-diagnostic",
          label: "forged",
          fingerprint: null,
        },
        reopened: [{ bad: true }],
        recommendationTrail: [{ worse: true }],
      },
    };
    expect(() => parseDiagnosticBundle(JSON.stringify(poisoned))).toThrow(
      /completedTests|nested entries/i,
    );
  });

  it("rejects an investigation that is not one at all", () => {
    const base = createDiagnosticBundle({
      fingerprint: knownIledHatFingerprint(),
      driverMatches: [],
      selectedDriver: null,
      selectedProfile: null,
      capabilities: [],
      trace: [],
      observations: [],
    });
    const poisoned = JSON.parse(serializeDiagnosticBundle(base)) as Record<
      string,
      unknown
    >;
    poisoned.investigation = { totally: "wrong" };
    expect(() => parseDiagnosticBundle(JSON.stringify(poisoned))).toThrow(
      /Investigation is structurally invalid/i,
    );
  });
});

describe("derived claims report their derivation", () => {
  it("never prints a derived claim as verified with no evidence recorded", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport, new TraceRecorder());
    await controller.connect();
    const report = controller.investigationReportMarkdown();
    expect(report).toContain(
      "`static.strategy` (Static-image strategy): **verified**",
    );
    expect(report).toContain(
      "Derived: the animation-single-frame strategy satisfies every requirement.",
    );
    expect(report).not.toMatch(/static\.strategy.*no evidence recorded/u);
  }, 30000);
});

describe("a complete core plan reads as complete", () => {
  it("does not hand over a next test in the same breath as declaring completion", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new ApplicationRuntime(transport, new TraceRecorder());
    await controller.connect();
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("6 / 6 slots resolved");
    expect(report).toContain(
      "Core characterization is complete. Remaining work is optional.",
    );
    // Optional work may be named, but never as the next thing to go and do.
    expect(report).toContain("offered, never automatic");
  }, 30000);
});

describe("the report says why each test ran", () => {
  it("records origins in the guided workflow trail", async () => {
    const { store } = await uncharacterizedStore();
    store.startGuidedTest("coolledux-graffiti-timing");
    store.closeGuidedTest();
    store.startGuidedTest("coolledux-graffiti-black", "manual-selection");
    store.closeGuidedTest();
    const report = store.controller.investigationReportMarkdown();
    expect(report).toContain("## Guided workflow trail");
    expect(report).toContain("origin: automatic recommendation");
    expect(report).toContain("origin: user selected optional characterization");
  }, 30000);
});
