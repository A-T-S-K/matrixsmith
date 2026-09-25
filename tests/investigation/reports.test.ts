import { describe, expect, it } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import type { ObservationValue } from "../../src/investigation/observations";

async function controllerWithBlackTest(): Promise<ApplicationRuntime> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new ApplicationRuntime(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  const transfer = await controller.runGuidedTestTransfer(
    "coolledux-graffiti-black",
    {
      confirmedConsequence: true,
      reason: "initial-experiment",
      attemptId: "attempt:test",
    },
  );
  const values: ObservationValue[] = [
    { kind: "choice", fieldId: "zero-appearance", optionId: "bright-white" },
    {
      kind: "choice",
      fieldId: "workaround-appearance",
      optionId: "dim-blue",
      note: "clearly blue-ish",
    },
  ];
  controller.recordGuidedTestObservations(
    "coolledux-graffiti-black",
    values,
    transfer.transactionIds,
  );
  return controller;
}

describe("test report", () => {
  it("generates a scoped AI-ready report with every default section", async () => {
    const controller = await controllerWithBlackTest();
    const report = controller.testReportMarkdown("coolledux-graffiti-black");
    for (const section of [
      "# MatrixSmith Hardware Test Report",
      "## Question",
      "## Device",
      "## Existing relevant evidence",
      "## Why this test was run",
      "## Test performed",
      "## Safety / side effects",
      "## Protocol operation",
      "## Compiler / transmission summary",
      "## Automatic observations",
      "## Physical observations",
      "## Result",
      "## What this establishes",
      "## What this rejects",
      "## What remains unknown",
      "## Recommended next discriminator",
      "## Relevant transactions",
      "## Relevant packet exemplars",
      "## Reproduction information",
      "## Requested AI task",
    ])
      expect(report).toContain(section);
    expect(report).toContain("bright white");
    expect(report).toContain("iledhat-31ae-32x16");
  }, 30000);

  it("stays compact by default: exemplar packets, not the full stream", async () => {
    const controller = await controllerWithBlackTest();
    const report = controller.testReportMarkdown("coolledux-graffiti-black");
    // The upload has many packets; the scoped report must not dump them all.
    const hexBlocks = report.match(/`01 00 02/g) ?? [];
    expect(hexBlocks.length).toBeLessThanOrEqual(8);
    expect(report).toContain("full bytes available in the forensic report");
  }, 30000);

  it("labels evidence scopes so upstream facts are not this-device facts", async () => {
    const controller = await controllerWithBlackTest();
    const report = controller.testReportMarkdown("coolledux-graffiti-black");
    expect(report).toContain("source/reference evidence");
  }, 30000);
});

describe("investigation report", () => {
  it("covers the driver-implementation sections and the AI task", async () => {
    const controller = await controllerWithBlackTest();
    const report = controller.investigationReportMarkdown();
    for (const section of [
      "## Objective",
      "## Device identity",
      "## Advertisement / manufacturer evidence",
      "## Transport / GATT",
      "## Protocol candidates",
      "## Verified operations",
      "## Stored-program behavior",
      "## Geometry / orientation / tiling",
      "## Black / off behavior by content path",
      "## Pixel / channel mapping",
      "## Color observations",
      "## Animation behavior",
      "## Static behavior",
      "## Text / image / GIF support",
      "## Controls",
      "## Persistence / recovery",
      "## Tests performed",
      "## Structured physical observations",
      "## Claims and confidence",
      "## Rejected hypotheses",
      "## Open hypotheses",
      "## Known limitations",
      "## Driver / profile recommendations",
      "## Relevant transactions",
      "## Reproduction environment",
      "## Requested AI task",
    ])
      expect(report).toContain(section);
    expect(report).toContain("colorModeRaw=3 (semantics unknown)");
    expect(report).toContain("Implement or fix MatrixSmith support");
  }, 30000);

  it("keeps autonomous looping distinct from power-cycle persistence", async () => {
    const controller = await controllerWithBlackTest();
    const report = controller.investigationReportMarkdown();
    expect(report).toContain("`animation.autonomous-loop`");
    expect(report).toMatch(/`power-cycle\.persistence`[^\n]*\*\*unknown\*\*/);
  }, 30000);
});

describe("forensic report", () => {
  it("appends every packet with real timestamps and timing analysis", async () => {
    const controller = await controllerWithBlackTest();
    const forensic = controller.forensicReportMarkdown();
    expect(forensic).toContain("# MatrixSmith Forensic Appendix");
    expect(forensic).toContain(
      "| Time | Dir | Gap ms | Host accepted | Bytes |",
    );
    // Every TX packet of the upload appears.
    const rows = forensic.match(/\| TX \|/g) ?? [];
    expect(rows.length).toBeGreaterThan(5);
    expect(forensic).toContain("never planned pacing");
  }, 30000);
});

describe("bundle round-trip", () => {
  it("carries the investigation and demotes ALL its evidence to imported-external on import", async () => {
    const controller = await controllerWithBlackTest();
    const json = controller.exportBundle();
    const bundle = parseDiagnosticBundle(json);
    expect(bundle.investigation?.completedTests).toHaveLength(1);
    const imported = new ApplicationRuntime(
      new ScriptedCoolLedUxDevice(null),
      new TraceRecorder(),
    );
    imported.importBundle(json);
    expect(imported.investigation?.completedTests).toHaveLength(1);
    // Bundle content is external data: every evidence entry is demoted
    // regardless of its serialized scope field.
    for (const entry of imported.investigation?.claimEvidence ?? [])
      expect(entry.scope).toBe("imported-external");
  }, 30000);
});
