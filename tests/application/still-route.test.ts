import { DriverRegistry } from "../../src/drivers/registry";
import { coolLedUxDriver } from "../../src/drivers/coolledux";
import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { parseHexBytes } from "../../src/discovery/advertisement";
import info from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { COOLLED_ENDPOINT } from "../../src/drivers/coolled/common/gatt";
import type { ObservationValue } from "../../src/investigation/observations";
import { Framebuffer } from "../../src/render/framebuffer";
async function setup(width = 32, height = 16, codec = true) {
  const fingerprint = {
    ...knownIledHatFingerprint(),
    name: "Unfamiliar display",
    manufacturerDataHex: undefined,
    rawAdvertisementHex: undefined,
    manuallyConfirmedGeometry: undefined,
  };
  const transport = new FakeTransport(fingerprint);
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry([
      {
        ...coolLedUxDriver,
        contentCodecId: codec ? "coolledux-reviewed-v1" : undefined,
      },
    ]),
  );
  await runtime.connect();
  transport.notificationOnWriteEndpoint = COOLLED_ENDPOINT;
  transport.notificationOnWrite = parseHexBytes(info.rxHex);
  await runtime.probe();
  runtime.confirmProvisionalGeometry(width, height);
  transport.notificationOnWrite = null;
  return { runtime, transport };
}

const yes = (fieldId: string): ObservationValue => ({
  fieldId,
  kind: "boolean",
  value: "yes",
});
const bootstrapValues: readonly ObservationValue[] = [
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
    milliseconds: 15100,
    measuredBy: "matrixsmith-timer",
  },
];
async function observed(
  runtime: ApplicationRuntime,
  testId: string,
  values: readonly ObservationValue[],
) {
  const run = runtime.beginExperiment(testId);
  const attempt = runtime.beginAttempt(
    run.experimentRunId,
    "initial-experiment",
  );
  const transfer = await runtime.runGuidedTestTransfer(testId, {
    attemptId: attempt.attemptId,
    reason: "initial-experiment",
    confirmedConsequence: true,
  });
  const timing = testId.endsWith("bootstrap")
    ? {
        attemptNumber: 1,
        parameters: {},
        t0: transfer.finalWriteAcceptedAt,
        marks: [],
        values,
        validity: "valid" as const,
        invalidationReason: null,
        note: null,
        startedAt: attempt.startedAt,
        endedAt: new Date().toISOString(),
      }
    : null;
  runtime.settleAttempt(attempt.attemptId, {
    validity: "valid",
    observations: values,
    timing,
  });
  return {
    transfer,
    attempt,
    record: () =>
      runtime.recordGuidedTestObservations(
        testId,
        values,
        transfer.transactionIds,
        attempt.startedAt,
        timing ? [timing] : [],
      ),
  };
}

describe("unfamiliar static route authority", () => {
  it("starts with no inherited upload evidence, and sends only a reviewed bootstrap without acquiring physical claims", async () => {
    const { runtime } = await setup();
    try {
      expect(
        runtime
          .guidedTests()
          .find((entry) => entry.test.id === "coolledux-still-bootstrap")
          ?.available,
      ).toBe(true);
      expect(
        runtime
          .allClaimEvidence()
          .some(
            (entry) =>
              entry.claimId === "stored-program.upload" &&
              entry.status === "verified",
          ),
      ).toBe(false);
      const ordinary = runtime.plan({
        type: "ShowFrame",
        frame: new Framebuffer(32, 16),
      });
      expect(runtime.evaluate(ordinary).allowed).toBe(false);
      const run = runtime.beginExperiment("coolledux-still-bootstrap");
      const attempt = runtime.beginAttempt(
        run.experimentRunId,
        "initial-experiment",
      );
      const plan = runtime.planGuidedTest("coolledux-still-bootstrap");
      await expect(
        runtime.runGuidedTestTransfer("coolledux-still-bootstrap", {
          attemptId: attempt.attemptId,
          reason: "initial-experiment",
          confirmedConsequence: false,
        }),
      ).rejects.toThrow(/confirmation/);
      const retry = runtime.beginAttempt(
        run.experimentRunId,
        "initial-experiment",
      );
      await runtime.runGuidedTestTransfer("coolledux-still-bootstrap", {
        attemptId: retry.attemptId,
        reason: "initial-experiment",
        confirmedConsequence: true,
        confirmedPlanDigest: "digest" in plan ? String(plan.digest) : undefined,
      });
      expect(runtime.staticViability().selected).toBeNull();
      expect(
        runtime
          .allClaimEvidence()
          .some(
            (entry) =>
              entry.claimId === "stored-program.upload" &&
              entry.status === "verified",
          ),
      ).toBe(false);
      expect(() =>
        runtime.recordGuidedTestObservations("coolledux-still-bootstrap", []),
      ).toThrow(/valid current-target/);
      expect(runtime.evaluate(ordinary).allowed).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
  it("only opens ordinary image/text experimentally after all three physical observations; reconnect retires authority", async () => {
    const { runtime } = await setup();
    try {
      (
        await observed(runtime, "coolledux-still-bootstrap", bootstrapValues)
      ).record();
      expect(
        runtime.assessment().capabilities["static-frame"].availability,
      ).toBe("blocked");
      const colors: ObservationValue[] = ["red", "green", "blue"].map(
        (optionId, index) => ({
          fieldId: `color-${index}`,
          kind: "choice",
          optionId,
        }),
      );
      (
        await observed(runtime, "coolledux-still-channels", [
          ...colors,
          yes("black"),
        ])
      ).record();
      expect(runtime.staticViability().selected).toBeNull();
      (
        await observed(runtime, "coolledux-still-encoder", [
          yes("coverage"),
          yes("layout"),
          yes("colors"),
        ])
      ).record();
      expect(runtime.corePlanProgress()?.complete).toBe(true);
      expect(runtime.recommendations()).toEqual([]);
      expect(runtime.assessment().capabilities.text).toMatchObject({
        availability: "available",
        confidence: "experimental",
      });
      expect(runtime.assessment().capabilities["static-frame"]).toMatchObject({
        availability: "available",
        confidence: "experimental",
      });
      for (const id of ["animation", "gif", "brightness", "power"] as const)
        expect(runtime.assessment().capabilities[id].availability).not.toBe(
          "available",
        );
      const plan = runtime.plan({
        type: "ShowFrame",
        frame: new Framebuffer(32, 16),
      });
      expect(plan.metadata.rasterStrategy).toBe("animation-single-frame");
      expect(plan.validation).toBe("experimental");
      expect(runtime.evaluate(plan).allowed).toBe(false);
      await runtime.sendPersistentContent(plan, { confirmedConsequence: true });
      const archive = runtime.exportBundle();
      await runtime.disconnect();
      await runtime.connect();
      expect(runtime.staticViability().selected).toBeNull();
      expect(
        runtime
          .allClaimEvidence()
          .filter((entry) => entry.testId?.startsWith("coolledux-still-"))
          .every((entry) => entry.scope !== "current-session"),
      ).toBe(true);
      runtime.importBundle(archive);
      expect(runtime.staticViability().selected).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });
  it("definition or geometry changes reject a pending observation and its prepared plan", async () => {
    for (const change of ["definition", "geometry"] as const) {
      const { runtime } = await setup();
      try {
        const result = await observed(
          runtime,
          "coolledux-still-bootstrap",
          bootstrapValues,
        );
        const oldPlan = runtime.planGuidedTest("coolledux-still-bootstrap");
        if (change === "definition")
          vi.spyOn(runtime.registry, "definitionIdentity").mockReturnValue(
            "replaced-definition",
          );
        else runtime.confirmProvisionalGeometry(48, 16);
        expect(() => result.record()).toThrow(/valid current-target/);
        expect(runtime.evaluate(oldPlan).allowed).toBe(false);
        expect(runtime.staticViability().selected).toBeNull();
      } finally {
        await runtime.dispose();
      }
    }
  });
  it("refuses family assertions and unregistered codec identity", async () => {
    const { runtime } = await setup();
    try {
      runtime.session.protocolResolution = null;
      expect(runtime.guidedTests().every((entry) => !entry.available)).toBe(
        true,
      );
      runtime.session.source = "imported";
      expect(runtime.guidedTests().every((entry) => !entry.available)).toBe(
        true,
      );
    } finally {
      await runtime.dispose();
    }
  });
  it("missing registered codec, Stop and partial writes cannot acquire or adopt physical authority", async () => {
    const unregistered = await setup(32, 16, false);
    try {
      expect(
        unregistered.runtime.guidedTests().every((entry) => !entry.available),
      ).toBe(true);
    } finally {
      await unregistered.runtime.dispose();
    }
    const { runtime, transport } = await setup();
    try {
      const observedResult = await observed(
        runtime,
        "coolledux-still-bootstrap",
        bootstrapValues,
      );
      runtime.stopActiveInvestigation();
      expect(() => observedResult.record()).toThrow(/valid current-target/);
      expect(runtime.staticViability().selected).toBeNull();
      runtime.ensureInvestigation();
      const run = runtime.beginExperiment("coolledux-still-bootstrap");
      const attempt = runtime.beginAttempt(
        run.experimentRunId,
        "explicit-measure-again",
      );
      transport.failWriteAt = transport.writes.length + 1;
      await expect(
        runtime.runGuidedTestTransfer("coolledux-still-bootstrap", {
          attemptId: attempt.attemptId,
          reason: "explicit-measure-again",
          confirmedConsequence: true,
        }),
      ).rejects.toThrow(/Injected write failure/);
      expect(runtime.panelProgram().certainty).toBe("unknown");
      expect(runtime.staticViability().selected).toBeNull();
      expect(runtime.inProgressAttempts()).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });
  it("unsupported geometry has a terminal reason and no suite; reconnect/import cannot restore visual authority", async () => {
    const { runtime } = await setup(48, 8);
    try {
      expect(runtime.guidedTests()).toHaveLength(0);
      expect(() =>
        runtime.plan({
          type: "ShowDiagnostic",
          diagnosticId: "still-bootstrap",
        }),
      ).toThrow(/height 16/);
      const exported = runtime.exportBundle();
      await runtime.disconnect();
      runtime.importBundle(exported);
      expect(runtime.guidedTests().every((entry) => !entry.available)).toBe(
        true,
      );
      expect(runtime.staticViability().selected).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });
});
