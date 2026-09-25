import type { ObservationAttempt } from "../../investigation/timing";
import { type ClaimEvidence } from "../../investigation/claims";
import {
  recordCompletedTest,
  type CompletedGuidedTest,
} from "../../investigation/investigation";
import {
  validateObservations,
  type ObservationValue,
} from "../../investigation/observations";
import { evaluateStaticViability } from "../../investigation/static-viability";

import type { GuidedTestCatalogService } from "./guided-test-catalog-service";
import type { ConnectionService } from "./connection-service";
import type { ExperimentService } from "./experiment-service";
import type { InvestigationService } from "./investigation-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
interface Ports {
  guidedTestCatalog(): Pick<
    GuidedTestCatalogService,
    "guidedTest" | "guidedTestOperation"
  >;
  connection(): Pick<ConnectionService, "getSession" | "patchSession">;
  experiment(): Pick<ExperimentService, "beginExperiment" | "settleExperiment">;
  investigation(): Pick<
    InvestigationService,
    "setInvestigation" | "ensureInvestigation" | "allClaimEvidence"
  >;
  protocolEvidence(): Pick<ProtocolEvidenceService, "getTrace">;
}
export class ObservationResolutionService {
  constructor(private readonly ports: Ports) {}
  recordGuidedTestObservations(
    testId: string,
    values: readonly ObservationValue[],
    transactionIds: readonly string[] = [],
    startedAt = new Date().toISOString(),
    /**
     * Human-timed attempts behind this result. Only valid attempts supplied
     * the values above; invalid ones ride along so a report can show what was
     * measured and what was discarded, without ever establishing a claim.
     */
    attempts: readonly ObservationAttempt[] = [],
  ): CompletedGuidedTest {
    const session = this.ports.connection().getSession();
    const test = this.ports.guidedTestCatalog().guidedTest(testId);
    // Domain-layer validation: UI checks are never relied on. Invalid or
    // incomplete submissions are rejected before any evidence is produced,
    // and only a live physical session can produce current-session evidence.
    if (session.source !== "live" || !session.fingerprint)
      throw new Error(
        "Guided test observations require a live physical device session.",
      );
    const validationErrors = [
      ...validateObservations(test.observation, values),
      ...(test.validate?.(values) ?? []),
    ];
    if (validationErrors.length > 0)
      throw new Error(
        `Invalid guided-test observations: ${validationErrors.join(" ")}`,
      );
    const interpretation = test.interpret(values);
    const completedAt = new Date().toISOString();
    const evidence: ClaimEvidence[] = interpretation.claimUpdates.map(
      (update) => ({
        claimId: update.claimId,
        status: update.status,
        scope: "current-session",
        provenance: update.provenance ?? "observed",
        summary: update.summary,
        recordedAt: completedAt,
        testId,
        transactionIds,
        ...(update.metrics ? { metrics: update.metrics } : {}),
        ...(update.details ? { details: update.details } : {}),
      }),
    );
    const resolvedOperation = this.ports
      .guidedTestCatalog()
      .guidedTestOperation(testId);
    const parameters =
      resolvedOperation.type === "ShowDiagnostic" &&
      resolvedOperation.parameters
        ? { ...resolvedOperation.parameters }
        : undefined;
    // Every result belongs to an experiment run. Opening one here rather than
    // relying on the caller keeps the link total: a result with no run cannot
    // be told apart from one inherited from another device, and scheduling
    // depends on exactly that distinction.
    const run = this.ports.experiment().beginExperiment(testId);
    const resolution = interpretation.resolution ?? "settled";
    const completed: CompletedGuidedTest = {
      testId,
      title: test.title,
      startedAt,
      completedAt,
      status: interpretation.status,
      observations: [...values],
      established: interpretation.established,
      rejected: interpretation.rejected,
      unknowns: interpretation.unknowns,
      summary: interpretation.summary,
      transactionIds: [...transactionIds],
      ...(parameters ? { parameters } : {}),
      ...(attempts.length > 0 ? { attempts: [...attempts] } : {}),
      // What this run means for the PLAN, which is not always what its status
      // means for the hardware: an "inconclusive" because the observation ran
      // out of time is a measurement to repeat, not a question answered.
      resolution,
      experimentRunId: run.experimentRunId,
    };
    this.ports
      .investigation()
      .setInvestigation(
        recordCompletedTest(
          this.ports.investigation().ensureInvestigation(),
          completed,
          evidence,
          completedAt,
        ),
      );
    // Settled here, from the interpretation, so the run's resolution and the
    // result's can never disagree about whether the plan may move on.
    this.ports
      .experiment()
      .settleExperiment(
        run.experimentRunId,
        interpretation.status,
        interpretation.summary,
        resolution,
      );
    this._deriveSessionRasterStrategy(testId);
    this.ports.protocolEvidence().getTrace().record("guided-test.recorded", {
      testId,
      status: interpretation.status,
      claimUpdates: evidence.length,
    });
    return completed;
  }
  _deriveSessionRasterStrategy(testId: string | null): void {
    const session = this.ports.connection().getSession();
    const selected = evaluateStaticViability(
      this.ports.investigation().allClaimEvidence(),
    ).selected;
    if (selected !== session.validatedRasterStrategy) {
      this.ports
        .connection()
        .patchSession({ validatedRasterStrategy: selected });
      if (selected)
        this.ports
          .protocolEvidence()
          .getTrace()
          .record("raster-strategy.validated", {
            strategy: selected,
            testId,
          });
    }
  }
  abandonGuidedTest(
    testId: string,
    values: readonly ObservationValue[],
    transactionIds: readonly string[],
    startedAt = new Date().toISOString(),
    attempts: readonly ObservationAttempt[] = [],
  ): CompletedGuidedTest {
    const test = this.ports.guidedTestCatalog().guidedTest(testId);
    if (transactionIds.length === 0)
      throw new Error(
        "Nothing was transmitted; close the test instead of abandoning it.",
      );
    const run = this.ports.experiment().beginExperiment(testId);
    const completedAt = new Date().toISOString();
    const resolvedOperation = this.ports
      .guidedTestCatalog()
      .guidedTestOperation(testId);
    const parameters =
      resolvedOperation.type === "ShowDiagnostic" &&
      resolvedOperation.parameters
        ? { ...resolvedOperation.parameters }
        : undefined;
    const completed: CompletedGuidedTest = {
      testId,
      title: test.title,
      startedAt,
      completedAt,
      status: "abandoned",
      // Keep only structurally valid partial observations; nothing is required.
      observations: values.filter(
        (value) => value && typeof value === "object",
      ),
      established: [],
      rejected: [],
      unknowns: [
        "Physical observation was abandoned before completion; no conclusions were drawn beyond the automatic capture.",
      ],
      summary:
        "The diagnostic program was transmitted and the stored display content was replaced, but the physical observation was abandoned.",
      transactionIds: [...transactionIds],
      ...(parameters ? { parameters } : {}),
      ...(attempts.length > 0 ? { attempts: [...attempts] } : {}),
      resolution: "abandoned",
      experimentRunId: run.experimentRunId,
    };
    this.ports
      .investigation()
      .setInvestigation(
        recordCompletedTest(
          this.ports.investigation().ensureInvestigation(),
          completed,
          [],
          completedAt,
        ),
      );
    this.ports
      .experiment()
      .settleExperiment(
        run.experimentRunId,
        "abandoned",
        completed.summary,
        "abandoned",
      );
    this.ports.protocolEvidence().getTrace().record("guided-test.abandoned", {
      testId,
      transactionCount: transactionIds.length,
    });
    return completed;
  }
}
