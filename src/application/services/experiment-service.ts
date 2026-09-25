import type { ObservationAttempt } from "../../investigation/timing";
import {
  newId,
  type AttemptFailureKind,
  type ExperimentAttempt,
  type ExperimentResolution,
  type ExperimentRun,
  type TransferReason,
} from "../../investigation/orchestration";
import { stepForTest } from "../../investigation/core-plan";
import { retryableIncompleteTestIds } from "../../investigation/recommendations";
import { type ObservationValue } from "../../investigation/observations";

import type { InvestigationService } from "./investigation-service";
import type { GuidedOrchestrationService } from "./guided-orchestration-service";
import type { GuidedTestCatalogService } from "./guided-test-catalog-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
interface Ports {
  investigation(): Pick<
    InvestigationService,
    "ensureInvestigation" | "orchestration" | "_updateOrchestration"
  >;
  guidedOrchestration(): Pick<
    GuidedOrchestrationService,
    "guidedExecutionFingerprint" | "corePlan" | "corePlanProgress"
  >;
  guidedTestCatalog(): Pick<
    GuidedTestCatalogService,
    "guidedTest" | "guidedTestOperation" | "executedTests"
  >;
  protocolEvidence(): Pick<ProtocolEvidenceService, "getTrace">;
}
export class ExperimentService {
  constructor(private readonly ports: Ports) {}
  beginExperiment(testId: string): ExperimentRun {
    this.ports.investigation().ensureInvestigation();
    const fingerprint = this.ports
      .guidedOrchestration()
      .guidedExecutionFingerprint(testId);
    const runs = this.ports.investigation().orchestration.experiments;
    const existing =
      runs.find(
        (run) => run.definitionId === testId && run.status === "in-progress",
      ) ??
      runs.find(
        (run) =>
          run.definitionId === testId &&
          run.resolution === "retryable-incomplete" &&
          run.fingerprint.key === fingerprint.key,
      );
    if (existing) {
      if (existing.status === "in-progress") return existing;
      const resumed: ExperimentRun = {
        ...existing,
        status: "in-progress",
        completedAt: null,
      };
      this._replaceExperiment(resumed);
      return resumed;
    }
    const test = this.ports.guidedTestCatalog().guidedTest(testId);
    const operation = this.ports
      .guidedTestCatalog()
      .guidedTestOperation(testId);
    const parameters =
      operation.type === "ShowDiagnostic" && operation.parameters
        ? { ...operation.parameters }
        : {};
    const step = stepForTest(
      this.ports.guidedOrchestration().corePlan(),
      testId,
      this.ports.guidedOrchestration().corePlanProgress(),
    );
    const run: ExperimentRun = {
      experimentRunId: newId("experiment"),
      definitionId: testId,
      title: test.title,
      corePlanStepId: step?.id ?? null,
      variant:
        Object.entries(parameters)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ") || null,
      parameters,
      fingerprint,
      status: "in-progress",
      resolution: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      attempts: [],
      conclusion: null,
      reopenReason: this._reopenReason(testId),
    };
    this.ports.investigation()._updateOrchestration((current) => ({
      ...current,
      experiments: [...current.experiments, run],
    }));
    return run;
  }
  _replaceExperiment(run: ExperimentRun): void {
    this.ports.investigation()._updateOrchestration((current) => ({
      ...current,
      experiments: current.experiments.map((entry) =>
        entry.experimentRunId === run.experimentRunId ? run : entry,
      ),
    }));
  }
  beginAttempt(
    experimentRunId: string,
    reason: TransferReason,
  ): ExperimentAttempt {
    const run = this.ports
      .investigation()
      .orchestration.experiments.find(
        (entry) => entry.experimentRunId === experimentRunId,
      );
    if (!run) throw new Error(`Unknown experiment run ${experimentRunId}.`);
    const attempt: ExperimentAttempt = {
      attemptId: newId("attempt"),
      attemptNumber: run.attempts.length + 1,
      reason,
      startedAt: new Date().toISOString(),
      transferIds: [],
      observations: [],
      timing: null,
      validity: "in-progress",
      invalidationReason: null,
      failureKind: null,
    };
    this._replaceExperiment({ ...run, attempts: [...run.attempts, attempt] });
    return attempt;
  }
  settleAttempt(
    attemptId: string,
    update: {
      readonly validity: ExperimentAttempt["validity"];
      readonly invalidationReason?: string | null;
      readonly failureKind?: AttemptFailureKind | null;
      readonly observations?: readonly ObservationValue[];
      readonly timing?: ObservationAttempt | null;
    },
  ): void {
    const transfers = this.ports.investigation().orchestration.transfers;
    for (const run of this.ports.investigation().orchestration.experiments) {
      const attemptIndex = run.attempts.findIndex(
        (attempt) => attempt.attemptId === attemptId,
      );
      if (attemptIndex < 0) continue;
      const attempt = run.attempts[attemptIndex]!;
      const attempts = [...run.attempts];
      attempts[attemptIndex] = {
        ...attempt,
        validity: update.validity,
        invalidationReason:
          update.invalidationReason ?? attempt.invalidationReason,
        failureKind:
          update.failureKind !== undefined
            ? update.failureKind
            : attempt.failureKind,
        observations: update.observations
          ? [...update.observations]
          : attempt.observations,
        timing: update.timing !== undefined ? update.timing : attempt.timing,
        transferIds: transfers
          .filter((transfer) => transfer.attemptId === attemptId)
          .map((transfer) => transfer.transferId),
      };
      this._replaceExperiment({ ...run, attempts });
      return;
    }
  }
  inProgressAttempts(): readonly ExperimentAttempt[] {
    return this.ports
      .investigation()
      .orchestration.experiments.flatMap((run) =>
        run.attempts.filter((attempt) => attempt.validity === "in-progress"),
      );
  }
  settleExperiment(
    experimentRunId: string,
    status: ExperimentRun["status"],
    conclusion: string,
    resolution: ExperimentResolution = "settled",
  ): void {
    const run = this.ports
      .investigation()
      .orchestration.experiments.find(
        (entry) => entry.experimentRunId === experimentRunId,
      );
    if (!run) return;
    this._replaceExperiment({
      ...run,
      status,
      conclusion,
      resolution,
      completedAt: new Date().toISOString(),
    });
    // A settled or abandoned experiment consumes its reopen; one still open
    // for a repeat measurement keeps it, so the report says why it is running.
    if (resolution !== "retryable-incomplete") {
      this.ports.investigation()._updateOrchestration((current) => ({
        ...current,
        reopened: current.reopened.filter(
          (entry) => entry.testId !== run.definitionId,
        ),
      }));
    }
  }
  reopenExperiment(testId: string, reason: string): void {
    this.ports.investigation().ensureInvestigation();
    this.ports.investigation()._updateOrchestration((current) => ({
      ...current,
      reopened: [
        ...current.reopened.filter((entry) => entry.testId !== testId),
        { testId, reason, at: new Date().toISOString() },
      ],
    }));
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("guided-test.reopened", { testId, reason });
  }
  _reopenReason(testId: string): string | null {
    return (
      this.ports
        .investigation()
        .orchestration.reopened.find((entry) => entry.testId === testId)
        ?.reason ?? null
    );
  }
  reopenedTestIds(): readonly string[] {
    return this.ports
      .investigation()
      .orchestration.reopened.map((entry) => entry.testId);
  }
  retryableExperimentIds(): readonly string[] {
    return retryableIncompleteTestIds(
      this.ports.guidedTestCatalog().executedTests(),
    );
  }
}
