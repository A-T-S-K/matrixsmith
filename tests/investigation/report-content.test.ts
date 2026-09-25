import { describe, expect, it } from "vitest";
import { emptyOrchestration } from "../../src/investigation/orchestration";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import type { DeviceFingerprint } from "../../src/core/device";
import type { ObservationValue } from "../../src/investigation/observations";

async function connectedController(
  fingerprint: DeviceFingerprint = knownIledHatFingerprint(),
): Promise<ApplicationRuntime> {
  const transport = new ScriptedCoolLedUxDevice(fingerprint);
  const controller = new ApplicationRuntime(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  return controller;
}

const timer = (fieldId: string, milliseconds: number): ObservationValue => ({
  kind: "duration",
  fieldId,
  milliseconds,
  measuredBy: "matrixsmith-timer",
});

describe("investigation report content", () => {
  it("includes the structured live advertisement observation labeled by source", async () => {
    const fingerprint: DeviceFingerprint = {
      ...knownIledHatFingerprint(),
      advertisementObservation: {
        capturedAt: "2026-08-31T10:00:00.000Z",
        source: "web-bluetooth-watch",
        name: "iLedHat",
        rssi: -52,
        txPower: 4,
        advertisedServiceUuids: ["0000fff0-0000-1000-8000-00805f9b34fb"],
        manufacturerData: [
          { companyId: 0x31ae, dataHex: "5EEA07000001100020031E" },
        ],
        serviceData: [],
      },
    };
    const controller = await connectedController(fingerprint);
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("web-bluetooth-watch");
    expect(report).toContain("RSSI: -52 dBm");
    expect(report).toContain("company id 0x31AE");
    expect(report).toContain("TX power: 4 dBm");
  });

  it("never fabricates a structured observation when none was captured", async () => {
    const controller = await connectedController();
    const report = controller.investigationReportMarkdown();
    expect(report).toContain(
      "Structured advertisement observation: not captured",
    );
    expect(report).toContain("never fabricated");
  });

  it("distinguishes trusted basis from historical conflict per claim", async () => {
    const controller = await connectedController();
    controller.adoptInvestigation({
      id: "investigation:old",
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
      profileId: "iledhat-31ae-32x16",
      deviceName: "iLedHat",
      deviceBinding: null,
      goal: { kind: "develop", description: "old" },
      status: "stopped",
      completedTests: [],
      notes: [],
      orchestration: emptyOrchestration(),
      claimEvidence: [
        {
          claimId: "animation.frames",
          status: "rejected",
          scope: "previous-local-session",
          provenance: "observed",
          summary: "rejected in an old session",
        },
      ],
    });
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("Evidence trust and conflicts");
    expect(report).toContain("CONFLICT");
    expect(report).toMatch(
      /animation\.frames[\s\S]*previous local session: REJECTED/,
    );
    expect(report).toMatch(
      /animation\.frames[\s\S]*Operational basis: built-in profile evidence \(trusted\)/,
    );
  });

  it("reports the static strategy as a derived per-requirement assessment", async () => {
    const controller = await connectedController();
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("## Static image strategy assessment");
    expect(report).toContain("### graffiti");
    expect(report).toContain("### animation-single-frame");
    // Graffiti was physically rejected on this panel and Animation carries
    // it, so the assessment reads as a decision rather than an open question.
    expect(report).toContain("NOT VIABLE");
    expect(report).toContain("VIABLE");
    expect(report).toContain(
      "Selected usable strategy: animation-single-frame",
    );
  });

  it("includes the measured T0/T1/T2 timeline in the scoped test report", async () => {
    const controller = await connectedController();
    await controller.runGuidedTestTransfer("coolledux-graffiti-timing", {
      confirmedConsequence: true,
      reason: "initial-experiment",
      attemptId: "attempt:test",
    });
    const transactionIds = controller.transactions
      .slice(-1)
      .map((transaction) => transaction.id);
    controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      [
        { kind: "boolean", fieldId: "initial-correct", value: "yes" },
        timer("image-visible", 1420),
        { kind: "boolean", fieldId: "moved", value: "yes" },
        timer("movement-start", 4650),
      ],
      transactionIds,
    );
    const report = controller.testReportMarkdown("coolledux-graffiti-timing");
    expect(report).toContain("## Physical timing");
    expect(report).toContain("Full raster visible (T1): +00:01.4");
    expect(report).toContain("Movement began (T2): +00:04.7");
    expect(report).toContain(
      "Render latency (T1 − T0): ~1.4 s (exact 00:01.4)",
    );
    expect(report).toContain(
      "Visible static hold (T2 − T1): ~3.2 s (exact 00:03.2)",
    );
    // T0 is automatic; T1/T2 are human taps and must be reported as such.
    expect(report).toContain("Transport event (automatically measured)");
    expect(report).toContain("Physical observation (human observed)");
    expect(report).toContain("human reaction delay");
  }, 30000);

  it("compares stayTime runs side by side once both exist", async () => {
    const controller = await connectedController();
    controller.recordGuidedTestObservations(
      "coolledux-graffiti-timing",
      [
        { kind: "boolean", fieldId: "initial-correct", value: "yes" },
        timer("image-visible", 1400),
        { kind: "boolean", fieldId: "moved", value: "yes" },
        timer("movement-start", 4600),
      ],
      [],
    );
    controller.recordGuidedTestObservations(
      "coolledux-graffiti-staytime",
      [
        { kind: "boolean", fieldId: "initial-correct", value: "yes" },
        timer("image-visible", 1300),
        { kind: "boolean", fieldId: "moved", value: "no" },
        timer("observation-end", 17300),
      ],
      [],
    );
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("Measured Graffiti timing runs");
    expect(report).toContain("stayTime=3");
    expect(report).toContain("stayTime=0");
  });

  it("makes an encoder permutation exceptionally clear for AI-driven repair", async () => {
    const controller = await connectedController();
    const patch = (word: number, optionId: string): ObservationValue => ({
      kind: "choice",
      fieldId: `patch-0x${word.toString(16).padStart(4, "0")}`,
      optionId,
    });
    controller.recordGuidedTestObservations(
      "coolledux-pixel-channels",
      [
        patch(0x0000, "off"),
        patch(0x0f00, "green"),
        patch(0x00f0, "red"),
        patch(0x000f, "blue"),
        patch(0x0fff, "tinted-white"),
        patch(0x1000, "off"),
        patch(0x2000, "off"),
        patch(0x4000, "off"),
        patch(0x8000, "off"),
        patch(0xf000, "off"),
        patch(0xffff, "tinted-white"),
      ],
      [],
    );
    // Raw map characterized; encoder rejected; content stays gated.
    expect(
      controller.claims().find((claim) => claim.id === "pixel.channel-map")
        ?.status,
    ).toBe("verified");
    expect(
      controller
        .claims()
        .find((claim) => claim.id === "pixel.encoder-correctness")?.status,
    ).toBe("rejected");
    expect(controller.contentGate("image").allowed).toBe(false);
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("ENCODER CORRECTION REQUIRED");
    expect(report).toContain("0x0F00→green");
  });
});
