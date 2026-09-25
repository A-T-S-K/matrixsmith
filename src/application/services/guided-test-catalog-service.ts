import type { MatrixOperation } from "../../core/operations";
import type { TransmissionPlan } from "../../core/transmission";
import type { ProtocolTransaction } from "../../diagnostics/transactions";
import {
  detectRecommendationCycle,
  type CycleVerdict,
  type RecommendationOrigin,
  type RecommendationTrailEntry,
} from "../../investigation/recommendations";
import { type CompletedGuidedTest } from "../../investigation/investigation";
import {
  evaluateTestAvailability,
  resolveGuidedOperation,
  type GuidedTestAvailability,
  type GuidedTestDefinition,
} from "../../investigation/tests";
import {
  rankRecommendations,
  type Recommendation,
} from "../../investigation/recommendations";
import {
  allContentGates,
  contentPathGate,
  type ContentGate,
  type ContentPathId,
} from "../../investigation/gating";
import {
  analyzeStoredProgramUpload,
  type StoredProgramUploadAnalysis,
} from "../../diagnostics/upload-analysis";

import type { ConnectionService } from "./connection-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
import type { InvestigationService } from "./investigation-service";
import type { GuidedOrchestrationService } from "./guided-orchestration-service";
import type { ExperimentService } from "./experiment-service";
import type { TransmissionService } from "./transmission-service";
interface Ports {
  connection(): Pick<ConnectionService, "getSession">;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    "_notificationDecoder" | "getTrace"
  >;
  investigation(): Pick<
    InvestigationService,
    | "orchestration"
    | "getInvestigation"
    | "baselineClaimEvidence"
    | "ensureInvestigation"
    | "_updateOrchestration"
    | "allClaimEvidence"
  >;
  guidedOrchestration(): Pick<GuidedOrchestrationService, "corePlanProgress">;
  experiment(): Pick<ExperimentService, "reopenedTestIds">;
  transmission(): Pick<TransmissionService, "plan">;
}
export class GuidedTestCatalogService {
  constructor(private readonly ports: Ports) {}
  guidedTestDefinitions(): readonly GuidedTestDefinition[] {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    if (!driver?.guidedTests || !profile) return [];
    return driver.guidedTests(profile);
  }
  guidedTestRegions(
    testId: string,
  ): readonly import("../../investigation/regions").DiagnosticRegion[] {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    if (!driver?.diagnosticRegions || !profile) return [];
    try {
      return driver.diagnosticRegions(
        this.guidedTestOperation(testId),
        profile,
      );
    } catch {
      return [];
    }
  }
  guidedTestPreviews(
    operation: MatrixOperation,
  ): readonly import("../../render/framebuffer").Framebuffer[] {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    if (!driver?.diagnosticPreview || !profile) return [];
    try {
      return driver.diagnosticPreview(operation, profile);
    } catch {
      return [];
    }
  }
  diagnosticRegions(
    operation: MatrixOperation,
  ): readonly import("../../investigation/regions").DiagnosticRegion[] {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    if (!driver?.diagnosticRegions || !profile) return [];
    try {
      return driver.diagnosticRegions(operation, profile);
    } catch {
      return [];
    }
  }
  analyzeStoredUpload(
    transaction: ProtocolTransaction,
    chunkCount: number,
  ): StoredProgramUploadAnalysis | null {
    const decoder = this.ports.protocolEvidence()._notificationDecoder();
    return decoder
      ? analyzeStoredProgramUpload(transaction, chunkCount, decoder)
      : null;
  }
  executedTests(): readonly CompletedGuidedTest[] {
    const runs = new Set(
      this.ports
        .investigation()
        .orchestration.experiments.map((run) => run.experimentRunId),
    );
    return (
      this.ports.investigation().getInvestigation()?.completedTests ?? []
    ).filter(
      (test) =>
        Boolean(test.experimentRunId) && runs.has(test.experimentRunId!),
    );
  }
  recordedTests(): readonly CompletedGuidedTest[] {
    return this.ports.investigation().getInvestigation()?.completedTests ?? [];
  }
  guidedTests(): readonly GuidedTestAvailability[] {
    const evidence = [
      ...this.ports.investigation().baselineClaimEvidence(),
      ...(this.ports.investigation().getInvestigation()?.claimEvidence ?? []),
    ];
    // Scheduling asks what has run HERE, never what the record remembers.
    const completed = this.executedTests().map((test) => test.testId);
    return this.guidedTestDefinitions().map((test) =>
      evaluateTestAvailability(test, evidence, completed),
    );
  }
  recommendations(): readonly Recommendation[] {
    const evidence = [
      ...this.ports.investigation().baselineClaimEvidence(),
      ...(this.ports.investigation().getInvestigation()?.claimEvidence ?? []),
    ];
    const progress = this.ports.guidedOrchestration().corePlanProgress();
    return rankRecommendations({
      goal: this.ports.investigation().getInvestigation()?.goal ?? null,
      evidence,
      availabilities: this.guidedTests(),
      completedTests: this.executedTests(),
      reopenedTestIds: this.ports.experiment().reopenedTestIds(),
      currentCoreTestIds: progress?.current?.step.testIds ?? [],
      coreTestIds:
        progress?.steps
          .filter((entry) => entry.state !== "skipped")
          .flatMap((entry) => entry.step.testIds) ?? [],
    });
  }
  noteRecommendationTaken(
    testId: string,
    origin: RecommendationOrigin = "automatic-recommendation",
  ): CycleVerdict {
    this.ports.investigation().ensureInvestigation();
    const entry: RecommendationTrailEntry = {
      testId,
      at: new Date().toISOString(),
      evidenceCount: (
        this.ports.investigation().getInvestigation()?.claimEvidence ?? []
      ).length,
      origin,
    };
    let verdict: CycleVerdict = { cycling: false, testIds: [], detail: null };
    this.ports.investigation()._updateOrchestration((current) => {
      const recommendationTrail = [...current.recommendationTrail, entry];
      // Only ENGINE repetition is a loop. A retry or reopen the user asked
      // for is recorded for the report and deliberately excluded from the
      // verdict — punishing a deliberate re-measurement as an algorithmic
      // cycle would break the workflow the timing tests depend on.
      verdict = detectRecommendationCycle(recommendationTrail);
      return { ...current, recommendationTrail, cycleVerdict: verdict };
    });
    if (verdict.cycling) {
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("guided-test.cycle-detected", {
          testIds: verdict.testIds.join(","),
          detail: verdict.detail ?? "",
        });
    }
    return verdict;
  }
  get recommendationTrail(): readonly RecommendationTrailEntry[] {
    return this.ports.investigation().orchestration.recommendationTrail;
  }
  contentGates(): readonly ContentGate[] {
    return allContentGates(this.ports.investigation().allClaimEvidence());
  }
  contentGate(path: ContentPathId): ContentGate {
    return contentPathGate(path, this.ports.investigation().allClaimEvidence());
  }
  guidedTest(testId: string): GuidedTestDefinition {
    const test = this.guidedTestDefinitions().find(({ id }) => id === testId);
    if (!test) throw new Error(`Unknown guided test ${testId}.`);
    return test;
  }
  guidedTestOperation(testId: string): MatrixOperation {
    const session = this.ports.connection().getSession();
    const profile = session.profile;
    if (!profile)
      throw new Error(
        "A resolved device profile is required for guided tests.",
      );
    return resolveGuidedOperation(this.guidedTest(testId), {
      profile,
      evidence: this.ports.investigation().allClaimEvidence(),
    });
  }
  planGuidedTest(testId: string): TransmissionPlan {
    return this.ports.transmission().plan(this.guidedTestOperation(testId));
  }
}
