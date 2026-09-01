import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";

describe("investigation retargeting", () => {
  it("keeps completed tests and evidence when troubleshooting starts mid-investigation", async () => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const controller = new MatrixController(transport, new TraceRecorder());
    await controller.connect();
    transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
    await controller.probe();
    transport.notificationOnWrite = null;
    controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
    ], []);
    const before = controller.investigation!;
    controller.startInvestigation({ kind: "troubleshoot", symptomId: "colors-look-wrong", description: "Colors look wrong" });
    const after = controller.investigation!;
    expect(after.id).toBe(before.id);
    expect(after.completedTests).toHaveLength(1);
    expect(after.claimEvidence.length).toBeGreaterThan(0);
    expect(after.goal.symptomId).toBe("colors-look-wrong");
  });
});
