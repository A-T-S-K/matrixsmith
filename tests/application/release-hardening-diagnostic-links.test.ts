import { afterEach, expect, it, vi } from "vitest";
import { ApplicationRuntime } from "../../src/application/runtime";
import { INPUT_LIMITS } from "../../src/application/input-limits";
import { ProtocolEvidenceService } from "../../src/application/services/protocol-evidence-service";
import { knownIledHatFingerprint } from "../helpers/fixtures";
import { ScriptedCoolLedUxDevice } from "../helpers/scripted-device";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
  "keeps diagnostic commands linked at the normal history cap, failed baseline query: %s",
  async (failQuery) => {
    const transport = new ScriptedCoolLedUxDevice(knownIledHatFingerprint());
    const runtime = new ApplicationRuntime(transport);
    try {
      await runtime.connect();
      await runtime.probe();
      const prior = runtime.transactions.at(-1)!;
      const get = ProtocolEvidenceService.prototype.getTransactions;
      let seeded = false;
      vi.spyOn(
        ProtocolEvidenceService.prototype,
        "getTransactions",
      ).mockImplementation(function (this: ProtocolEvidenceService) {
        if (!seeded) {
          seeded = true;
          this.editTransactions((transactions) => {
            transactions.splice(0, transactions.length);
            for (let index = 0; index < INPUT_LIMITS.transactions; index++)
              transactions.push({
                ...prior,
                id: `retained-fixture:${index}`,
                packets: [],
                decodedResponse: null,
                hostAccepted: false,
                protocolAcknowledged: null,
                deviceStateVerified: false,
                findings: [],
                observationIds: [],
              });
          });
        }
        return get.call(this);
      });
      runtime.exportBundle();
      expect(runtime.transactions).toHaveLength(INPUT_LIMITS.transactions);
      const record = ProtocolEvidenceService.prototype._recordTransaction;
      const actualIds: string[] = [];
      vi.spyOn(
        ProtocolEvidenceService.prototype,
        "_recordTransaction",
      ).mockImplementation(function (this: ProtocolEvidenceService, ...args) {
        const transaction = record.apply(this, args);
        actualIds.push(transaction.id);
        return transaction;
      });
      if (failQuery) {
        const write = transport.write.bind(transport);
        let failed = false;
        vi.spyOn(transport, "write").mockImplementation((...args) => {
          if (!failed && args[1][4] === 0x1f) {
            failed = true;
            return Promise.reject(new Error("diagnostic fixture write failed"));
          }
          return write(...args);
        });
      }
      const run = await runtime.runDiagnostic(
        "coolledux-brightness-round-trip",
      );
      expect(run.status).toBe(failQuery ? "failed" : "passed");
      expect(run.restorationAttempted).toBe(!failQuery);
      expect(run.restorationVerified).toBe(!failQuery);
      expect(run.steps.map((step) => step.id)).toEqual(
        failQuery
          ? ["baseline"]
          : [
              "baseline",
              "set-test",
              "verify-test",
              "restore",
              "verify-restore",
            ],
      );
      expect(actualIds).toHaveLength(failQuery ? 1 : 5);
      expect(run.steps.map((step) => step.transactionIds)).toEqual(
        actualIds.map((id) => [id]),
      );
      expect(runtime.transactions).toHaveLength(INPUT_LIMITS.transactions);
      expect(runtime.transactions.map(({ id }) => id)).not.toContain(
        "retained-fixture:0",
      );
      if (failQuery) {
        expect(run.steps[0]).toMatchObject({
          id: "baseline",
          status: "failed",
          transactionIds: [actualIds[0]],
        });
        expect(
          runtime.transactions.find(({ id }) => id === actualIds[0]),
        ).toMatchObject({
          hostAccepted: false,
          error: "diagnostic fixture write failed",
        });
      }
    } finally {
      await runtime.dispose();
    }
  },
);
