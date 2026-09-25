import {
  buildExecutionFingerprint,
  classifyTransfers,
  isGuidedProgramActive,
  newId,
  type DiagnosticExecutionFingerprint,
  type ExperimentRun,
  type TransferReason,
  type TransferRecord,
} from "../../investigation/orchestration";
import {
  evaluateCorePlan,
  type CorePlan,
  type CorePlanProgress,
} from "../../investigation/core-plan";
import { type CycleVerdict } from "../../investigation/recommendations";
import {
  deviceIdentityBinding,
  fingerprintIdentityKey,
} from "../../investigation/device-identity";
import { errorMessage } from "./runtime-support";

import type { GuidedTestCatalogService } from "./guided-test-catalog-service";
import type { ConnectionService } from "./connection-service";
import type { InvestigationService } from "./investigation-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
import type { TransmissionService } from "./transmission-service";
import type { ExperimentService } from "./experiment-service";
interface Ports {
  guidedTestCatalog(): Pick<
    GuidedTestCatalogService,
    | "guidedTest"
    | "guidedTests"
    | "planGuidedTest"
    | "guidedTestOperation"
    | "executedTests"
  >;
  connection(): Pick<ConnectionService, "getSession">;
  investigation(): Pick<
    InvestigationService,
    | "ensureInvestigation"
    | "panelProgram"
    | "setStagedPanelProgram"
    | "_updateOrchestration"
    | "getInvestigation"
    | "orchestration"
    | "allClaimEvidence"
  >;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    "getTrace" | "getTransactions"
  >;
  transmission(): Pick<TransmissionService, "sendPersistentContent">;
  experiment(): Pick<ExperimentService, "settleAttempt">;
}
export class GuidedOrchestrationService {
  constructor(private readonly ports: Ports) {}
  async runGuidedTestTransfer(
    testId: string,
    options: {
      readonly confirmedConsequence: boolean;
      readonly reason: TransferReason;
      readonly attemptId: string;
    },
  ): Promise<{
    readonly transactionIds: readonly string[];
    readonly finalWriteAcceptedAt: string | null;
    readonly transferId: string;
  }> {
    const session = this.ports.connection().getSession();
    const test = this.ports.guidedTestCatalog().guidedTest(testId);
    if (!options.confirmedConsequence)
      throw new Error(`Explicit confirmation required. ${test.consequence}`);
    if (session.source !== "live")
      throw new Error("Guided hardware tests require a live connection.");
    const availability = this.ports
      .guidedTestCatalog()
      .guidedTests()
      .find((entry) => entry.test.id === testId);
    if (availability && !availability.available)
      throw new Error(
        availability.reason ?? "This test's prerequisites are not met.",
      );
    this.ports.investigation().ensureInvestigation();
    const plan = this.ports.guidedTestCatalog().planGuidedTest(testId);
    const fingerprint = this.guidedExecutionFingerprint(
      testId,
      typeof plan.metadata.crc32 === "string" ? plan.metadata.crc32 : null,
    );
    // The guard asks whether THIS diagnostic is presumed to be on the panel
    // right now — not whether these bytes were ever sent. A reason that
    // asserts novelty ("initial experiment", "a controlled variant") cannot
    // be true of a diagnostic already showing; repeat reasons are expected to
    // match, that is what they mean. After any intervening persistent write
    // the diagnostic is gone and an initial run is legitimate again.
    if (
      isGuidedProgramActive(
        this.ports.investigation().panelProgram(),
        fingerprint,
      ) &&
      (options.reason === "initial-experiment" ||
        options.reason === "controlled-variant")
    ) {
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("guided-test.duplicate-blocked", {
          testId,
          reason: options.reason,
          fingerprint: fingerprint.key,
        });
      throw new Error(
        "This diagnostic is already showing on the display and no reason for resending it was recorded. " +
          "MatrixSmith prevented an unnecessary resend.",
      );
    }
    const transactionIndex = this.ports
      .protocolEvidence()
      .getTransactions().length;
    const startedAt = new Date().toISOString();
    const transferId = newId("transfer");
    // The panel program is stamped by the send path itself, so that a partial
    // or failed write leaves certainty at "unknown" rather than claiming this
    // diagnostic is showing.
    this.ports.investigation().setStagedPanelProgram({
      certainty: "known-active",
      kind: "guided-diagnostic",
      fingerprint,
      label: `guided diagnostic ${test.title}`,
      startedAt,
      writtenAt: null,
      uncertaintyReason: null,
    });
    try {
      const result = await this.ports
        .transmission()
        .sendPersistentContent(plan, {
          confirmedConsequence: true,
        });
      const transactionIds = this.ports
        .protocolEvidence()
        .getTransactions()
        .slice(transactionIndex)
        .map(({ id }) => id);
      this._recordTransfer({
        transferId,
        attemptId: options.attemptId,
        diagnosticId: fingerprint.diagnosticId,
        reason: options.reason,
        fingerprint,
        transactionIds,
        startedAt,
        finalWriteAcceptedAt: result.finalWriteAcceptedAt,
        failureReason: null,
      });
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("guided-test.transferred", {
          testId,
          transferId,
          attemptId: options.attemptId,
          reason: options.reason,
          fingerprint: fingerprint.key,
          crc32: fingerprint.programCrc32,
          transactionCount: transactionIds.length,
          finalWriteAcceptedAt: result.finalWriteAcceptedAt,
        });
      return {
        transactionIds,
        finalWriteAcceptedAt: result.finalWriteAcceptedAt,
        transferId,
      };
    } catch (error) {
      // A transfer that threw must settle its attempt. Leaving it open left a
      // zombie in-progress attempt forever and made the next real try look
      // like a continuation of a measurement that never started.
      const transactionIds = this.ports
        .protocolEvidence()
        .getTransactions()
        .slice(transactionIndex)
        .map(({ id }) => id);
      const detail = errorMessage(error);
      this._recordTransfer({
        transferId,
        attemptId: options.attemptId,
        diagnosticId: fingerprint.diagnosticId,
        reason: options.reason,
        fingerprint,
        transactionIds,
        startedAt,
        finalWriteAcceptedAt: null,
        failureReason: detail,
      });
      this.ports.experiment().settleAttempt(options.attemptId, {
        validity: "invalid",
        failureKind: "transfer-failed",
        invalidationReason: `The diagnostic transfer failed before any physical observation: ${detail}`,
      });
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("guided-test.transfer-failed", {
          testId,
          transferId,
          attemptId: options.attemptId,
          reason: options.reason,
          fingerprint: fingerprint.key,
          transactionCount: transactionIds.length,
          error: detail,
        });
      throw error;
    }
  }
  _recordTransfer(record: TransferRecord): void {
    this.ports.investigation()._updateOrchestration((current) => ({
      ...current,
      transfers: [...current.transfers, record],
    }));
  }
  guidedExecutionFingerprint(
    testId: string,
    programCrc32: string | null = null,
  ): DiagnosticExecutionFingerprint {
    const session = this.ports.connection().getSession();
    const operation = this.ports
      .guidedTestCatalog()
      .guidedTestOperation(testId);
    const binding =
      this.ports.investigation().getInvestigation()?.deviceBinding ??
      deviceIdentityBinding(session.fingerprint, session.profile?.id ?? null);
    return buildExecutionFingerprint({
      physicalDeviceKey:
        binding?.browserDeviceId ??
        session.fingerprint?.browserDeviceId ??
        null,
      fingerprintShapeKey:
        binding?.fingerprintKey ??
        (session.fingerprint
          ? fingerprintIdentityKey(session.fingerprint)
          : null),
      profileId: session.profile?.id ?? null,
      testId,
      diagnosticId:
        operation.type === "ShowDiagnostic"
          ? operation.diagnosticId
          : operation.type,
      parameters:
        operation.type === "ShowDiagnostic" ? operation.parameters : undefined,
      programCrc32,
      // The strategy of the EXPERIMENT, not of the session. Using whatever
      // static strategy happened to be selected labelled the two-identical-
      // frame run "animation-single-frame" — an identity describing the
      // session's preference rather than the thing being executed.
      rasterStrategy:
        operation.type === "ShowDiagnostic"
          ? (session.selection?.selected?.diagnosticRasterStrategy?.(
              operation,
            ) ?? null)
          : session.validatedRasterStrategy,
    });
  }
  get experiments(): readonly ExperimentRun[] {
    return this.ports.investigation().orchestration.experiments;
  }
  get transfers(): readonly TransferRecord[] {
    return this.ports.investigation().orchestration.transfers;
  }
  get recommendationCycle(): CycleVerdict {
    return this.ports.investigation().orchestration.cycleVerdict;
  }
  transferSummary(): ReturnType<typeof classifyTransfers> {
    return classifyTransfers(
      this.ports.investigation().orchestration.transfers,
    );
  }
  corePlan(): CorePlan | null {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    if (!driver?.corePlan || !profile) return null;
    return driver.corePlan(profile);
  }
  corePlanProgress(): CorePlanProgress | null {
    const plan = this.corePlan();
    if (!plan) return null;
    return evaluateCorePlan(
      plan,
      this.ports.investigation().allClaimEvidence(),
      this.ports.guidedTestCatalog().executedTests(),
    );
  }
}
