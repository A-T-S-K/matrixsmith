import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseDiagnosticBundle } from "../../src/diagnostics/bundle";
import { chooseTestBrightness } from "../../src/diagnostics/workflows";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";

async function connectedController(): Promise<{ transport: ScriptedCoolLedUxDevice; controller: MatrixController }> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  return { transport, controller };
}

describe("diagnostic workflows", () => {
  it("chooses a test brightness sufficiently different from the baseline", () => {
    expect(chooseTestBrightness(0xcc)).toBe(0x40);
    expect(chooseTestBrightness(0x10)).toBe(0xc0);
    expect(() => chooseTestBrightness(300)).toThrow();
  });

  it("passes safe identification and resolves the protocol", async () => {
    const { controller } = await connectedController();
    const run = await controller.runDiagnostic("coolledux-identify");
    expect(run.status).toBe("passed");
    expect(run.safety.risk).toBe("read-only");
    expect(controller.session.selection?.selected?.id).toBe("coolledux");
    expect(run.steps.every((step) => step.transactionIds.length > 0)).toBe(true);
  });

  it("runs the complete brightness round-trip: baseline, test, verify, restore, verify", async () => {
    const { transport, controller } = await connectedController();
    await controller.probe();
    const run = await controller.runDiagnostic("coolledux-brightness-round-trip");
    expect(run.status).toBe("passed");
    expect(run.steps.map((step) => step.id)).toEqual(["baseline", "set-test", "verify-test", "restore", "verify-restore"]);
    expect(run.steps.every((step) => step.status === "passed")).toBe(true);
    expect(run.restorationAttempted).toBe(true);
    expect(run.restorationVerified).toBe(true);
    expect(transport.brightness).toBe(0xcc);
  });

  it("still attempts restoration after a test verification failure", async () => {
    const { transport, controller } = await connectedController();
    await controller.probe();
    transport.ignoreBrightnessState = true;
    const run = await controller.runDiagnostic("coolledux-brightness-round-trip");
    expect(run.status).toBe("failed");
    expect(run.steps.find((step) => step.id === "verify-test")?.status).toBe("failed");
    expect(run.restorationAttempted).toBe(true);
    expect(run.steps.some((step) => step.id === "restore")).toBe(true);
  });

  it("surfaces a restore failure prominently", async () => {
    const { transport, controller } = await connectedController();
    await controller.probe();
    transport.stickAfterFirstBrightnessWrite = true;
    const run = await controller.runDiagnostic("coolledux-brightness-round-trip");
    expect(run.status).toBe("restore-failed");
    expect(run.restorationAttempted).toBe(true);
    expect(run.restorationVerified).toBe(false);
    expect(run.error).toMatch(/RESTORE FAILED/);
  });

  it("serializes diagnostic runs into the exported bundle", async () => {
    const { controller } = await connectedController();
    await controller.runDiagnostic("coolledux-identify");
    const bundle = parseDiagnosticBundle(controller.exportBundle());
    expect(bundle.diagnosticRuns?.length).toBe(1);
    expect(bundle.diagnosticRuns?.[0]?.toolId).toBe("coolledux-identify");
    expect(bundle.diagnosticRuns?.[0]?.steps.length).toBeGreaterThan(0);
  });

  it("offers no live tools for imported sessions and explains why", async () => {
    const { controller } = await connectedController();
    await controller.runDiagnostic("coolledux-identify");
    const imported = new MatrixController(new ScriptedCoolLedUxDevice(), new TraceRecorder());
    imported.importBundle(controller.exportBundle());
    const tools = imported.diagnosticTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => !tool.available)).toBe(true);
    expect(tools[0]?.unavailableReason).toMatch(/read-only/i);
    await expect(imported.runDiagnostic("coolledux-identify")).rejects.toThrow(/read-only/i);
  });
});
