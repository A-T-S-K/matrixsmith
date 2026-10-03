import { describe, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { DriverRegistry } from "../../src/drivers/registry";
import { FakeTransport } from "../../src/transport/fake";
import {
  lumenFrame,
  SYNTHETIC_SERVICE,
  SYNTHETIC_NOTIFY,
  syntheticDriver,
  syntheticFingerprint,
  syntheticQueryTest,
} from "../helpers/synthetic-driver";
import type { MatrixDriver } from "../../src/drivers/types";

async function harness(driver: MatrixDriver = syntheticDriver) {
  const transport = new FakeTransport(syntheticFingerprint(true));
  transport.notificationOnWriteEndpoint = {
    serviceUuid: SYNTHETIC_SERVICE,
    characteristicUuid: SYNTHETIC_NOTIFY,
  };
  transport.notificationOnWrite = lumenFrame(0x91, [0x4c, 0x4d, 24, 8, 7]);
  const runtime = new ApplicationRuntime(
    transport,
    undefined,
    new DriverRegistry([driver]),
  );
  await runtime.connect();
  runtime.session.enableExperimentalTx();
  await runtime.probe("test-lumen", "lumen-info");
  return { runtime, transport };
}
function attempt(runtime: ApplicationRuntime) {
  const run = runtime.beginExperiment(syntheticQueryTest.id);
  return runtime.beginAttempt(run.experimentRunId, "initial-experiment");
}
function run(runtime: ApplicationRuntime, attemptId: string) {
  return runtime.runGuidedTestTransfer(syntheticQueryTest.id, {
    attemptId,
    confirmedConsequence: false,
    reason: "initial-experiment",
  });
}

describe("registered synthetic read-only guided execution", () => {
  it("records a correlated query and links its attempt without compiling content or consuming confirmation", async () => {
    const { runtime, transport } = await harness();
    try {
      const panel = runtime.panelProgram();
      const compilationCount = runtime.exportBundle();
      runtime.session.confirmPlanDigest("unrelated persistent confirmation");
      const a = attempt(runtime);
      expect(runtime.guidedTests()[0]?.available).toBe(true);
      const result = await run(runtime, a.attemptId);
      expect(transport.writeAttempts).toHaveLength(2);
      expect(result.transactionIds).toEqual([runtime.transactions.at(-1)?.id]);
      expect(runtime.transactions.at(-1)).toMatchObject({
        operation: "GetDeviceInfo",
        source: "diagnostic",
        protocolAcknowledged: true,
        decodedResponse: { family: "Synthetic Lumen" },
      });
      expect(
        runtime.transactions
          .at(-1)
          ?.packets.some(({ relation }) => relation === "matched-response"),
      ).toBe(true);
      expect(runtime.panelProgram()).toEqual(panel);
      expect(runtime.session.confirmedPlanDigest).toBe(
        "unrelated persistent confirmation",
      );
      expect(runtime.session.experimentalTxEnabled).toBe(true);
      expect(JSON.parse(runtime.exportBundle()).contentCompilations).toEqual(
        JSON.parse(compilationCount).contentCompilations,
      );
      expect(runtime.experiments.at(-1)?.attempts.at(-1)).toMatchObject({
        validity: "valid",
        observations: [],
        transferIds: [result.transferId],
      });
      expect(runtime.investigation?.claimEvidence).toEqual([]);
      expect(runtime.investigationReportMarkdown()).toContain(
        "Read-only query executions: 1",
      );
      expect(runtime.investigationReportMarkdown()).not.toContain(
        "program upload accepted",
      );
      // A repeated query never asserts a diagnostic program is on the panel.
      await run(runtime, attempt(runtime).attemptId);
      expect(runtime.panelProgram()).toEqual(panel);
    } finally {
      await runtime.dispose();
    }
  });

  it("requires explicit experimental permission and settles policy rejection before writes", async () => {
    const { runtime, transport } = await harness();
    try {
      runtime.session.disableExperimentalTx();
      const a = attempt(runtime);
      await expect(run(runtime, a.attemptId)).rejects.toThrow(
        /per-session unlock/,
      );
      expect(transport.writeAttempts).toHaveLength(1);
      expect(runtime.inProgressAttempts()).toEqual([]);
      expect(runtime.session.experimentalTxEnabled).toBe(false);
      expect(
        runtime.experiments.at(-1)?.attempts.at(-1)?.invalidationReason,
      ).toContain("per-session unlock");
    } finally {
      await runtime.dispose();
    }
  });

  it("can characterize missing query evidence only through the fixed registration", async () => {
    const driver: MatrixDriver = {
      ...syntheticDriver,
      familyProbes: (context) =>
        syntheticDriver.familyProbes!(context).map((probe) => ({
          ...probe,
          establishesClaims: ["transport.bluetooth"],
        })),
    };
    const { runtime, transport } = await harness(driver);
    try {
      const plan = runtime.plan({ type: "GetDeviceInfo" });
      expect(
        runtime.assessment().capabilities["device-info"].availability,
      ).toBe("blocked");
      await expect(runtime.send(plan)).rejects.toThrow(/Missing trusted/);
      expect(runtime.guidedTests()[0]?.available).toBe(true);
      await run(runtime, attempt(runtime).attemptId);
      expect(transport.writeAttempts).toHaveLength(2);
      expect(runtime.investigation?.claimEvidence).toEqual([]);
      expect(
        runtime.assessment().capabilities["device-info"].availability,
      ).toBe("blocked");
    } finally {
      await runtime.dispose();
    }
  });

  it.each(["timeout", "write-failure"])(
    "settles %s with actual evidence and no panel replacement or observation",
    async (kind) => {
      const { runtime, transport } = await harness();
      try {
        const panel = runtime.panelProgram();
        runtime.session.confirmPlanDigest("keep this confirmation");
        if (kind === "timeout") transport.notificationOnWrite = null;
        else transport.failWriteAt = transport.writes.length;
        const a = attempt(runtime);
        await expect(run(runtime, a.attemptId)).rejects.toThrow(
          kind === "timeout" ? /matching response/ : /Injected write failure/,
        );
        expect(runtime.inProgressAttempts()).toEqual([]);
        expect(runtime.experiments.at(-1)?.attempts.at(-1)).toMatchObject({
          validity: "invalid",
          observations: [],
        });
        expect(runtime.transfers.at(-1)?.transactionIds).toEqual([
          runtime.transactions.at(-1)?.id,
        ]);
        expect(runtime.panelProgram()).toEqual(panel);
        expect(runtime.session.confirmedPlanDigest).toBe(
          "keep this confirmation",
        );
        expect(runtime.investigation?.claimEvidence).toEqual([]);
        expect(transport.writeAttempts).toHaveLength(2);
      } finally {
        await runtime.dispose();
      }
    },
  );

  it.each([
    "unknown",
    "mismatch",
    "plan-mismatch",
    "restricted",
    "historical-prerequisite",
  ])("rejects %s before any guided write", async (kind) => {
    const driver: MatrixDriver = {
      ...syntheticDriver,
      guidedTests: () => [
        {
          ...syntheticQueryTest,
          ...(kind === "unknown" ? { persistence: "unknown" as const } : {}),
          ...(kind === "mismatch"
            ? {
                risk: "persistent" as const,
                persistence: "persistent" as const,
              }
            : {}),
          ...(kind === "historical-prerequisite"
            ? {
                prerequisites: [
                  {
                    claimId: "brightness.control" as const,
                    anyOf: ["verified" as const],
                  },
                ],
              }
            : {}),
        },
      ],
      plan: (operation, context) => ({
        ...syntheticDriver.plan(operation, context),
        ...(kind === "plan-mismatch"
          ? {
              risk: "persistent" as const,
              persistence: "persistent" as const,
            }
          : {}),
      }),
      operations: (context) =>
        syntheticDriver.operations(context).map((operation) =>
          kind === "restricted"
            ? {
                ...operation,
                availability: "blocked",
                reason: "Authored query restriction.",
              }
            : operation,
        ),
    };
    const { runtime, transport } = await harness(driver);
    try {
      const investigation = runtime.ensureInvestigation();
      if (kind === "historical-prerequisite")
        runtime.adoptInvestigation({
          ...investigation,
          claimEvidence: [
            {
              claimId: "brightness.control",
              status: "verified",
              scope: "previous-local-session",
              provenance: "observed",
              summary: "Historical only.",
            },
          ],
        });
      const a = attempt(runtime);
      const options = {
        attemptId: a.attemptId,
        confirmedConsequence: true,
        reason: "initial-experiment" as const,
      };
      await expect(
        runtime.runGuidedTestTransfer(syntheticQueryTest.id, options),
      ).rejects.toThrow();
      expect(transport.writeAttempts).toHaveLength(1);
      expect(runtime.inProgressAttempts()).toEqual([]);
      if (kind !== "mismatch" && kind !== "plan-mismatch")
        expect(runtime.guidedTests()[0]?.available).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects a changed reviewed plan before writes and settles the attempt", async () => {
    const { runtime, transport } = await harness();
    try {
      const a = attempt(runtime);
      await expect(
        runtime.runGuidedTestTransfer(syntheticQueryTest.id, {
          attemptId: a.attemptId,
          reason: "initial-experiment",
          confirmedConsequence: false,
          confirmedPlanDigest: "stale reviewed plan",
        }),
      ).rejects.toThrow(/changed after it was reviewed/);
      expect(transport.writeAttempts).toHaveLength(1);
      expect(runtime.inProgressAttempts()).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps imported registration context read-only", async () => {
    const { runtime, transport } = await harness();
    try {
      runtime.ensureInvestigation();
      runtime.importBundle(runtime.exportBundle());
      expect(runtime.guidedTests().every(({ available }) => !available)).toBe(
        true,
      );
      await expect(run(runtime, "historical-attempt")).rejects.toThrow(
        /live connection/,
      );
      expect(transport.writeAttempts).toHaveLength(1);
      expect(runtime.session.experimentalTxEnabled).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("leaves a stale guided dialog failed and closable instead of stuck running", async () => {
    const { runtime, transport } = await harness();
    const { createPresentationStore } =
      await import("../helpers/presentation-fixture");
    const store = createPresentationStore(runtime, transport);
    try {
      const { deferred } = await import("../helpers/deferred-gatt");
      const receipt =
        deferred<
          import("../../src/application/ports/transport").TransportReceipt
        >();
      const original = transport.write.bind(transport);
      let accepted: Awaited<ReturnType<typeof original>> | undefined;
      vi.spyOn(transport, "write").mockImplementationOnce(async (...args) => {
        accepted = await original(...args);
        return receipt.promise;
      });
      store.startGuidedTest(syntheticQueryTest.id, "manual-selection");
      const pending = store.confirmGuidedTransfer();
      await vi.waitFor(() => expect(accepted).toBeDefined(), { interval: 1 });
      await runtime.disconnect();
      await runtime.connect();
      const panel = runtime.panelProgram();
      receipt.resolve(accepted!);
      await pending;
      expect(store.getSnapshot().guidedFlow).toMatchObject({
        stage: "failed",
        failure: {
          retryable: false,
          message: expect.stringContaining("retired connection"),
        },
      });
      expect(store.getSnapshot().busy).toBeNull();
      expect(runtime.panelProgram()).toEqual(panel);
      store.closeGuidedTest();
      expect(store.getSnapshot().guidedFlow).toBeNull();
    } finally {
      await store.dispose();
    }
  });

  it("keeps late completion in its original investigation and preserves replacement authority", async () => {
    const { runtime, transport } = await harness();
    try {
      const { deferred } = await import("../helpers/deferred-gatt");
      const receipt =
        deferred<
          import("../../src/application/ports/transport").TransportReceipt
        >();
      const original = transport.write.bind(transport);
      let accepted: Awaited<ReturnType<typeof original>> | undefined;
      vi.spyOn(transport, "write").mockImplementationOnce(async (...args) => {
        accepted = await original(...args);
        return receipt.promise;
      });
      const a = attempt(runtime);
      const oldId = runtime.investigation!.id;
      const pending = run(runtime, a.attemptId).catch(
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(accepted).toBeDefined(), { interval: 1 });
      await runtime.disconnect();
      transport.fingerprint = {
        ...syntheticFingerprint(true),
        browserDeviceId: "replacement-unit",
      };
      await runtime.connect();
      runtime.ensureInvestigation();
      const panel = runtime.panelProgram();
      runtime.session.enableExperimentalTx();
      runtime.session.confirmPlanDigest("replacement confirmation");
      expect(runtime.takeDetachedInvestigation()?.id).toBe(oldId);
      receipt.resolve(accepted!);
      expect(await pending).toBeInstanceOf(Error);
      expect(runtime.investigation?.id).not.toBe(oldId);
      expect(runtime.panelProgram()).toEqual(panel);
      expect(runtime.session.confirmedPlanDigest).toBe(
        "replacement confirmation",
      );
      expect(runtime.transfers).toEqual([]);
      const old = runtime.takeDetachedInvestigation();
      expect(old?.id).toBe(oldId);
      expect(
        old?.orchestration?.experiments.at(-1)?.attempts.at(-1),
      ).toMatchObject({ validity: "invalid", observations: [] });
      expect(old?.orchestration?.transfers.at(-1)?.failureReason).toBeTruthy();
    } finally {
      await runtime.dispose();
    }
  });
});
