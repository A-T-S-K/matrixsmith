import { describe, expect, it } from "vitest";
import { MatrixController } from "../../src/app/controller";
import { TraceRecorder } from "../../src/diagnostics/trace";
import { STATIC_FRAME_VALIDATION } from "../../src/diagnostics/validation";
import { computeSupportMatrix } from "../../src/diagnostics/support";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { orientationPattern } from "../../src/render/patterns";

async function liveController(): Promise<{ controller: MatrixController; transport: ScriptedCoolLedUxDevice }> {
  const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
  const controller = new MatrixController(transport, new TraceRecorder());
  await controller.connect();
  await controller.probe();
  return { controller, transport };
}

const yesAnswers = STATIC_FRAME_VALIDATION.questions.map((question) => ({ questionId: question.id, answer: "yes" as const }));

describe("guided static-frame validation workflow", () => {
  it("exposes the workflow with honest safety metadata and the exact consequence", async () => {
    const { controller } = await liveController();
    const workflows = controller.contentValidationWorkflows();
    const staticFrame = workflows.find(({ id }) => id === "coolledux-validate-static-frame");
    expect(staticFrame?.risk).toBe("persistent");
    expect(staticFrame?.persistence).toBe("persistent");
    expect(staticFrame?.validation).toBe("experimental");
    expect(staticFrame?.consequence).toContain("replaces the currently stored display program");
    expect(staticFrame?.consequence).toContain("has not been verified");
  });

  it("never transmits without explicit confirmation", async () => {
    const { controller, transport } = await liveController();
    const writesBefore = transport.writes.length;
    await expect(controller.runContentValidation("coolledux-validate-static-frame", { confirmedConsequence: false })).rejects.toThrow(/Explicit confirmation required/);
    expect(transport.writes.length).toBe(writesBefore);
  });

  it("blocks the persistent plan through the ordinary send path even with the experimental unlock", async () => {
    const { controller, transport } = await liveController();
    controller.session.enableExperimentalTx();
    const plan = controller.planValidationContent("coolledux-validate-static-frame");
    const decision = controller.evaluate(plan);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(" ")).toContain("explicit per-plan confirmation");
    const writesBefore = transport.writes.length;
    await expect(controller.send(plan)).rejects.toThrow(/confirmation/);
    expect(transport.writes.length).toBe(writesBefore);
  });

  it("transfers the full multi-packet program once confirmed and records one coherent transaction", async () => {
    const { controller, transport } = await liveController();
    const writesBefore = transport.writes.length;
    const { plan, result, transactionIds } = await controller.runContentValidation("coolledux-validate-static-frame", { confirmedConsequence: true });
    expect(result.hostAccepted).toBe(true);
    expect(plan.packets.length).toBeGreaterThan(2);
    expect(transport.writes.length - writesBefore).toBe(plan.packets.length);
    expect(transactionIds).toHaveLength(1);
    const transaction = controller.transactions.find(({ id }) => id === transactionIds[0]);
    expect(transaction?.safety.risk).toBe("persistent");
    expect(transaction?.packets.filter((packet) => packet.direction === "TX")).toHaveLength(plan.packets.length);
    expect(transaction?.packets.map((packet) => packet.hex)).toEqual(expect.arrayContaining(plan.packets.map((packet) => packet.hex)));
  }, 30000);

  it("keeps the persistent confirmation single-use", async () => {
    const { controller } = await liveController();
    const { plan } = await controller.runContentValidation("coolledux-validate-static-frame", { confirmedConsequence: true });
    await expect(controller.send(plan)).rejects.toThrow(/confirmation/);
  }, 30000);

  it("records a compilation evidence entry for the transfer", async () => {
    const { controller } = await liveController();
    await controller.runContentValidation("coolledux-validate-static-frame", { confirmedConsequence: true });
    const record = controller.contentCompilations[0];
    expect(record?.contentType).toBe("graffiti");
    expect(record?.width).toBe(32);
    expect(record?.height).toBe(16);
    expect(record?.tileCount).toBe(4);
    expect(record?.chunkCount).toBeGreaterThan(0);
    expect(record?.pacingMs).toBe(60);
    expect(record?.crc32).toBeGreaterThan(0);
  }, 30000);

  it("records structured observations and advances the session support state", async () => {
    const { controller } = await liveController();
    const { transactionIds } = await controller.runContentValidation("coolledux-validate-static-frame", { confirmedConsequence: true });
    const validation = controller.recordValidationAnswers("coolledux-validate-static-frame", yesAnswers, transactionIds);
    expect(validation.status).toBe("passed");
    expect(validation.validatedAreas).toEqual(expect.arrayContaining(["static-frame", "pixel-orientation", "color-encoding", "stored-programs"]));
    const matrix = computeSupportMatrix({
      connected: true, live: true, resolvedDriverId: "coolledux",
      capabilities: controller.session.selection!.selected!.capabilities(controller.session.profile!),
      validations: controller.validations,
    });
    expect(matrix.find((row) => row.id === "static-frame")?.state).toBe("Verified");
    expect(matrix.find((row) => row.id === "pixel-orientation")?.state).toBe("Verified");
  }, 30000);

  it("records failed observations as rejections without touching profile metadata", async () => {
    const { controller } = await liveController();
    const answers = STATIC_FRAME_VALIDATION.questions.map((question) => ({ questionId: question.id, answer: question.id === "seams" ? "no" as const : "yes" as const }));
    const validation = controller.recordValidationAnswers("coolledux-validate-static-frame", answers);
    expect(validation.status).toBe("failed");
    expect(validation.rejectedAreas).toContain("static-frame");
    // The profile itself keeps its stored validation status.
    expect(controller.session.profile?.validation).toBe("verified");
  });

  it("keeps the animation validation available and distinct", async () => {
    const { controller } = await liveController();
    const plan = controller.planValidationContent("coolledux-validate-animation");
    expect(plan.operation.type).toBe("ShowAnimation");
    expect(plan.metadata.frameCount).toBe(2);
  });

  it("keeps validation content matched to the profile geometry", async () => {
    const { controller } = await liveController();
    const plan = controller.planValidationContent("coolledux-validate-static-frame");
    expect(plan.metadata.width).toBe(32);
    expect(plan.metadata.height).toBe(16);
    const pattern = orientationPattern(32, 16);
    expect(pattern.width).toBe(32);
  });
});
