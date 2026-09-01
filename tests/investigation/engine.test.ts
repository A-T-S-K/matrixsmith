import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { claimState } from "../../src/investigation/claims";
import { evaluateStaticViability } from "../../src/investigation/static-viability";
import { uncharacterizedCoolLedUxEvidence } from "../helpers/evidence";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { parseHexBytes } from "../../src/discovery/advertisement";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import infoFixture from "../fixtures/iledhat/coolledux-device-info-cc.json";
import type { ObservationValue } from "../../src/investigation/observations";

async function connectedController(): Promise<MatrixController> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  transport.notificationOnWrite = parseHexBytes(infoFixture.rxHex);
  await controller.probe();
  transport.notificationOnWrite = null;
  return controller;
}

function claimStatus(controller: MatrixController, claimId: string): string {
  return controller.claims().find((claim) => claim.id === claimId)?.status ?? "missing";
}

describe("guided test engine", () => {
  it("lists driver-contributed tests with claim-based availability", async () => {
    const controller = await connectedController();
    const tests = controller.guidedTests();
    const byId = new Map(tests.map((entry) => [entry.test.id, entry]));
    expect(byId.get("coolledux-graffiti-black")?.available).toBe(true);
    expect(byId.get("coolledux-animation-static")?.available).toBe(true);
    // The channel map is a shipped profile fact now, so the optional colour
    // work is available — it is simply never automatic.
    expect(byId.get("coolledux-color-white")?.available).toBe(true);
    // The stayTime comparison requires the baseline measurement first.
    expect(byId.get("coolledux-graffiti-staytime")?.available).toBe(false);
    expect(byId.get("coolledux-graffiti-staytime")?.missingCompletedTests).toEqual(["coolledux-graffiti-timing"]);
    // The identical-pair variant follows the single-frame test and is never automatic.
    expect(byId.get("coolledux-animation-static-pair")?.available).toBe(false);
  });

  it("refuses a guided transfer without explicit consequence confirmation", async () => {
    const controller = await connectedController();
    await expect(controller.runGuidedTestTransfer("coolledux-graffiti-black", { confirmedConsequence: false, reason: "initial-experiment", attemptId: "attempt:test" })).rejects.toThrow(/confirmation required/i);
  });

  it("transfers the diagnostic and reports the final host-accepted write time", async () => {
    const controller = await connectedController();
    const result = await controller.runGuidedTestTransfer("coolledux-graffiti-black", { confirmedConsequence: true, reason: "initial-experiment", attemptId: "attempt:test" });
    expect(result.transactionIds.length).toBeGreaterThan(0);
    expect(result.finalWriteAcceptedAt).not.toBeNull();
    const transaction = controller.transactions.find(({ id }) => id === result.transactionIds[0]);
    expect(transaction?.operation).toBe("ShowDiagnostic");
    expect(transaction?.safety.risk).toBe("persistent");
  }, 30000);

  it("turns black-probe observations into current-session claim evidence", async () => {
    const controller = await connectedController();
    // The shipped profile already establishes this from an earlier physical
    // session; re-running it must produce a fresh CURRENT-SESSION basis
    // rather than silently reusing the built-in one.
    const shipped = controller.claims().find((claim) => claim.id === "graffiti.black-semantics");
    expect(shipped?.decidedBy?.scope).toBe("built-in-profile");
    const values: ObservationValue[] = [
      { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "dim-blue" },
    ];
    const completed = controller.recordGuidedTestObservations("coolledux-graffiti-black", values, ["transaction:x"]);
    expect(completed.status).toBe("passed");
    expect(claimStatus(controller, "graffiti.black-semantics")).toBe("verified");
    const state = controller.claims().find((claim) => claim.id === "graffiti.black-semantics");
    expect(state?.decidedBy?.scope).toBe("current-session");
    expect(controller.investigation?.completedTests[0]?.testId).toBe("coolledux-graffiti-black");
  });

  it("keeps a movement observation as partial evidence with the measured onset", async () => {
    const controller = await connectedController();
    const values: ObservationValue[] = [
      { kind: "boolean", fieldId: "initial-correct", value: "yes" },
      { kind: "boolean", fieldId: "moved", value: "yes" },
      { kind: "duration", fieldId: "movement-start", milliseconds: 3200, measuredBy: "matrixsmith-timer" },
      { kind: "choice", fieldId: "motion-description", optionId: "wraps-repeats" },
    ];
    const completed = controller.recordGuidedTestObservations("coolledux-graffiti-timing", values, []);
    expect(completed.status).toBe("partial");
    expect(completed.established.join(" ")).toContain("full raster appeared correctly");
    expect(completed.rejected.join(" ")).toContain("00:03.2");
    expect(claimStatus(controller, "graffiti.initial-render")).toBe("verified");
    // Baseline movement leaves the broad stability claim UNDECIDED: the
    // stayTime=0 discriminator has not yet been exhausted. Recording it as
    // contradicted would outrank the discriminator's later verification.
    expect(claimStatus(controller, "graffiti.playback-stability")).toBe("unknown");
    expect(completed.parameters?.stayTime).toBe(3);
    // The stayTime discriminator becomes available once the baseline exists.
    const staytime = controller.guidedTests().find((entry) => entry.test.id === "coolledux-graffiti-staytime");
    expect(staytime?.available).toBe(true);
  });

  it("derives the session raster strategy from full viability, not one passing test", () => {
    // A device whose substrate is still open: one passing static test is not
    // enough, because the channel map and encoder are uncharacterized.
    const open = [...uncharacterizedCoolLedUxEvidence(), {
      claimId: "animation.static-single-frame", status: "verified", scope: "current-session", provenance: "observed",
      summary: "held still", metrics: { visibleStaticHoldMs: 17000 },
    } as const];
    const partial = evaluateStaticViability(open);
    expect(partial.selected).toBeNull();
    expect(claimState("static.strategy", open).status).not.toBe("verified");

    // Adding the channel map and encoder correctness completes it.
    const complete = [...open,
      { claimId: "pixel.channel-map", status: "verified", scope: "current-session", provenance: "observed", summary: "RGB444 confirmed" } as const,
      { claimId: "pixel.encoder-correctness", status: "verified", scope: "current-session", provenance: "observed", summary: "encoder matches" } as const,
    ];
    expect(evaluateStaticViability(complete).selected).toBe("animation-single-frame");
  });

  it("derives a usable strategy from the shipped profile with no session work at all", async () => {
    const controller = await connectedController();
    // The shipped profile alone derives a usable strategy — no guided test,
    // no session evidence. This is the productionized path.
    expect(controller.investigation).toBeNull();
    expect(claimStatus(controller, "static.strategy")).toBe("verified");
    expect(controller.staticViability().selected).toBe("animation-single-frame");
  }, 30000);

  it("rejects the white-channel hypothesis when every high-nibble patch is off", async () => {
    const controller = await connectedController();
    const patch = (word: number, optionId: string): ObservationValue => ({ kind: "choice", fieldId: `patch-0x${word.toString(16).padStart(4, "0")}`, optionId });
    const values = [
      patch(0x0000, "off"), patch(0x0f00, "red"), patch(0x00f0, "green"), patch(0x000f, "blue"), patch(0x0fff, "tinted-white"),
      patch(0x1000, "off"), patch(0x2000, "off"), patch(0x4000, "off"), patch(0x8000, "off"), patch(0xf000, "off"), patch(0xffff, "tinted-white"),
    ];
    const completed = controller.recordGuidedTestObservations("coolledux-pixel-channels", values, []);
    expect(completed.status).toBe("passed");
    expect(claimStatus(controller, "pixel.channel-map")).toBe("verified");
    expect(claimStatus(controller, "pixel.encoder-correctness")).toBe("verified");
    expect(claimStatus(controller, "pixel.fourth-channel")).toBe("rejected");
    expect(claimStatus(controller, "pixel.white-channel")).toBe("rejected");
    // Color/white characterization unlocks once the channel map is verified.
    expect(controller.guidedTests().find((entry) => entry.test.id === "coolledux-color-white")?.available).toBe(true);
  });

  it("treats a lit high-nibble patch as fourth-channel evidence without claiming RGBW", async () => {
    const controller = await connectedController();
    const patch = (word: number, optionId: string): ObservationValue => ({ kind: "choice", fieldId: `patch-0x${word.toString(16).padStart(4, "0")}`, optionId });
    const values = [
      patch(0x0000, "off"), patch(0x0f00, "red"), patch(0x00f0, "green"), patch(0x000f, "blue"), patch(0x0fff, "tinted-white"),
      patch(0x1000, "off"), patch(0x2000, "off"), patch(0x4000, "neutral-white"), patch(0x8000, "neutral-white"), patch(0xf000, "neutral-white"), patch(0xffff, "neutral-white"),
    ];
    const completed = controller.recordGuidedTestObservations("coolledux-pixel-channels", values, []);
    expect(completed.status).toBe("passed");
    expect(claimStatus(controller, "pixel.fourth-channel")).toBe("verified");
    expect(claimStatus(controller, "pixel.white-channel")).toBe("verified");
    const evidence = controller.investigation?.claimEvidence.find((entry) => entry.claimId === "pixel.fourth-channel");
    expect(evidence?.summary).toContain("does not by itself make the profile RGBW");
  });

  it("supports symptom-driven troubleshooting investigations", async () => {
    const controller = await connectedController();
    const investigation = controller.startInvestigation({ kind: "troubleshoot", symptomId: "content-moves-unexpectedly", description: "Content moves unexpectedly" });
    expect(investigation.goal.symptomId).toBe("content-moves-unexpectedly");
    expect(controller.investigation?.goal.kind).toBe("troubleshoot");
  });

  it("stops and resumes an investigation without losing completed tests", async () => {
    const controller = await connectedController();
    controller.recordGuidedTestObservations("coolledux-graffiti-black", [
      { kind: "choice", fieldId: "zero-appearance", optionId: "off-black" },
      { kind: "choice", fieldId: "workaround-appearance", optionId: "dim-blue" },
    ], []);
    const stopped = controller.stopActiveInvestigation();
    expect(stopped?.status).toBe("stopped");
    const resumed = controller.ensureInvestigation();
    expect(resumed.status).toBe("active");
    expect(resumed.completedTests).toHaveLength(1);
  });
});

describe("evidence-aware guided operations", () => {
  it("omits high-nibble bands until a fourth channel is established", async () => {
    const controller = await connectedController();
    const patch = (word: number, optionId: string): ObservationValue => ({ kind: "choice", fieldId: `patch-0x${word.toString(16).padStart(4, "0")}`, optionId });
    // Channel map verified with every high-nibble patch off: no fourth channel.
    controller.recordGuidedTestObservations("coolledux-pixel-channels", [
      patch(0x0000, "off"), patch(0x0f00, "red"), patch(0x00f0, "green"), patch(0x000f, "blue"), patch(0x0fff, "tinted-white"),
      patch(0x1000, "off"), patch(0x2000, "off"), patch(0x4000, "off"), patch(0x8000, "off"), patch(0xf000, "off"), patch(0xffff, "tinted-white"),
    ], []);
    const operation = controller.guidedTestOperation("coolledux-color-white");
    expect(operation.type).toBe("ShowDiagnostic");
    expect((operation as { parameters?: Record<string, number> }).parameters?.includeHighNibble).toBe(0);
  });

  it("includes the 0xF000/0xFFFF comparison once the fourth channel is trusted", async () => {
    const controller = await connectedController();
    const patch = (word: number, optionId: string): ObservationValue => ({ kind: "choice", fieldId: `patch-0x${word.toString(16).padStart(4, "0")}`, optionId });
    controller.recordGuidedTestObservations("coolledux-pixel-channels", [
      patch(0x0000, "off"), patch(0x0f00, "red"), patch(0x00f0, "green"), patch(0x000f, "blue"), patch(0x0fff, "tinted-white"),
      patch(0x1000, "off"), patch(0x2000, "off"), patch(0x4000, "neutral-white"), patch(0x8000, "neutral-white"), patch(0xf000, "neutral-white"), patch(0xffff, "neutral-white"),
    ], []);
    const operation = controller.guidedTestOperation("coolledux-color-white");
    expect((operation as { parameters?: Record<string, number> }).parameters?.includeHighNibble).toBe(1);
    // The plan compiles the actual bands for the run.
    const plan = controller.planGuidedTest("coolledux-color-white");
    expect(plan.metadata.diagnosticId).toBe("color-white-probe");
  });
});
