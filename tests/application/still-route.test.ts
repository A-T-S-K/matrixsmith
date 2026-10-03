import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { FakeTransport } from "../../src/transport/fake";
import { parseHexBytes } from "../../src/discovery/advertisement";
import info from "../fixtures/iledhat/coolledux-device-info-cc.json";
import { COOLLED_ENDPOINT } from "../../src/drivers/coolled/common/gatt";
import type { ObservationValue } from "../../src/investigation/observations";
import { Framebuffer } from "../../src/render/framebuffer";
import {
  createShareableBundle,
  parseDiagnosticBundle,
  serializeDiagnosticBundle,
} from "../../src/diagnostics/bundle";
import {
  DEFAULT_REPORT_OPTIONS,
  generateMarkdownReport,
  reportDataFromBundle,
} from "../../src/diagnostics/report";
import { projectReportPrivacy } from "../../src/diagnostics/report-privacy";
import {
  setupStill as setup,
  observed,
  yes,
  bootstrapValues,
} from "../helpers/still-runtime";

describe("unfamiliar static route authority", () => {
  it("protects completed visual provenance in shareable exports and default reports while archives retain it without restoring authority", async () => {
    const sentinel = "still-private-device-sentinel-9842";
    const { runtime } = await setup(32, 16, true, sentinel);
    const imported = new ApplicationRuntime(new FakeTransport());
    try {
      const result = await observed(
        runtime,
        "coolledux-still-bootstrap",
        bootstrapValues,
      );
      result.record();
      const evidence = runtime.investigation!.claimEvidence.filter(
        (entry) => entry.testId === "coolledux-still-bootstrap",
      );
      expect(evidence.length).toBeGreaterThan(0);
      for (const entry of evidence)
        expect(entry.details).toMatchObject({
          physicalDeviceKey: sentinel,
          profileId: runtime.session.profile!.id,
          width: 32,
          height: 16,
          attemptId: result.attempt.attemptId,
          transactionIds: result.transfer.transactionIds.join(","),
          finalWriteAcceptedAt: result.transfer.finalWriteAcceptedAt,
        });
      const before = JSON.stringify(runtime.investigation);
      const archiveJson = runtime.exportBundle("full-local-archive");
      const shareableJson = runtime.exportBundle("shareable");
      expect(archiveJson).toContain(sentinel);
      expect(shareableJson).not.toContain(sentinel);
      const archive = parseDiagnosticBundle(archiveJson);
      const shareable = parseDiagnosticBundle(shareableJson);
      expect(
        archive
          .investigation!.claimEvidence.filter(
            (entry) => entry.testId === "coolledux-still-bootstrap",
          )
          .map((entry) => entry.details),
      ).toEqual(evidence.map((entry) => entry.details));
      const sharedEvidence = shareable.investigation!.claimEvidence.filter(
        (entry) => entry.testId === "coolledux-still-bootstrap",
      );
      expect(sharedEvidence).toHaveLength(evidence.length);
      sharedEvidence.forEach((entry, index) => {
        const { physicalDeviceKey: _binding, ...relationships } =
          evidence[index]!.details!;
        expect(entry.details).toEqual(relationships);
        expect(entry.details!.definitionIdentity).toBeTruthy();
        expect(entry.transactionIds).toEqual(result.transfer.transactionIds);
        expect(entry.metrics).toEqual(evidence[index]!.metrics);
      });
      expect(shareable.investigation!.completedTests[0]!.observations).toEqual(
        bootstrapValues,
      );
      expect(shareable.investigation!.completedTests[0]!.attempts).toEqual(
        archive.investigation!.completedTests[0]!.attempts,
      );
      for (const report of [
        runtime.testReportMarkdown("coolledux-still-bootstrap"),
        runtime.investigationReportMarkdown(),
        runtime.forensicReportMarkdown(),
        generateMarkdownReport(reportDataFromBundle(archive), {
          ...DEFAULT_REPORT_OPTIONS,
          includeRawTrace: true,
        }),
      ])
        expect(report).not.toContain(sentinel);
      expect(JSON.stringify(runtime.investigation)).toBe(before);

      // Previously generated provenance must be protected even when the original
      // device binding no longer appears in the bundle's current fingerprint.
      const legacy = structuredClone(archive);
      const legacySentinel = "historical-still-device-sentinel-5137";
      for (const entry of legacy.investigation!.claimEvidence) {
        if (entry.testId !== "coolledux-still-bootstrap") continue;
        const details = entry.details as Record<
          string,
          string | number | boolean
        >;
        delete details.physicalDeviceKey;
        details.target = legacySentinel;
      }
      const legacyBefore = serializeDiagnosticBundle(legacy);
      const legacyShareable = serializeDiagnosticBundle(
        createShareableBundle(legacy),
      );
      expect(legacyShareable).not.toContain(legacySentinel);
      expect(JSON.stringify(projectReportPrivacy(legacy))).not.toContain(
        legacySentinel,
      );
      expect(
        generateMarkdownReport(reportDataFromBundle(legacy)),
      ).not.toContain(legacySentinel);
      expect(serializeDiagnosticBundle(legacy)).toBe(legacyBefore);
      expect(projectReportPrivacy(legacy, true)).toBe(legacy);
      for (const json of [
        archiveJson,
        shareableJson,
        legacyBefore,
        legacyShareable,
      ]) {
        expect(parseDiagnosticBundle(json).investigation).not.toBeNull();
        imported.importBundle(json);
        expect(
          imported.investigation!.claimEvidence.every(
            (entry) => entry.scope !== "current-session",
          ),
        ).toBe(true);
        expect(imported.staticViability().selected).toBeNull();
        expect(imported.session.experimentalTxEnabled).toBe(false);
        expect(imported.session.confirmedPlanDigest).toBeNull();
        expect(imported.guidedTests().every((entry) => !entry.available)).toBe(
          true,
        );
        expect(
          imported.assessment().capabilities["static-frame"].availability,
        ).toBe("blocked");
      }
    } finally {
      await runtime.dispose();
      await imported.dispose();
    }
  });
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
    const { runtime, transport } = await setup();
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
      transport.notificationOnWriteEndpoint = COOLLED_ENDPOINT;
      transport.notificationOnWrite = parseHexBytes(info.rxHex);
      await runtime.probe();
      runtime.confirmProvisionalGeometry(32, 16);
      expect(runtime.executedTests()).toEqual([]);
      expect(runtime.recommendations()[0]?.testId).toBe(
        "coolledux-still-bootstrap",
      );
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
