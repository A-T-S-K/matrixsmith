import {
  bindingAllowsSessionContinuity,
  deviceIdentityBinding,
  latestInvestigationFor,
} from "./dependencies";
import type { ContentGate, ContentPathId } from "./dependencies";
import type {
  ClaimGroupView,
  CoreProgressView,
  GuidedTestView,
  InvestigationSummaryView,
  OrchestrationDebugView,
  StoredInvestigationView,
} from "./types";
import { SCOPE_LABELS } from "./selectors";

import type { WorkspaceStore } from "./workspace-store";
import type { SnapshotStore } from "./snapshot-store";
import type { GuidedController } from "./guided-controller";
import type { PresentationEnvironment } from "../environment";

interface Ports {
  workspaceStore(): Pick<WorkspaceStore, "getController">;
  snapshotStore(): Pick<SnapshotStore, "_liveResolved">;
  guidedController(): Pick<GuidedController, "_retryableOnCurrentMilestone">;
}
export class ProjectionStore {
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<PresentationEnvironment, "storage">,
  ) {}
  _claimGroups(): readonly ClaimGroupView[] {
    if (
      !this.ports.workspaceStore().getController().session.selection?.selected
    )
      return [];
    const claims = this.ports.workspaceStore().getController().claims();
    const groups: { category: ClaimGroupView["category"]; label: string }[] = [
      { category: "core", label: "Core support" },
      { category: "content", label: "Content" },
      { category: "optional", label: "Optional" },
    ];
    return groups.map((group) => ({
      category: group.category,
      label: group.label,
      claims: claims
        .filter((claim) => claim.category === group.category)
        .map((claim) => ({
          id: claim.id,
          label: claim.label,
          status: claim.status,
          glyph:
            claim.status === "verified"
              ? "✓"
              : claim.status === "rejected"
                ? "✕"
                : claim.status === "unresolved"
                  ? "!"
                  : claim.status === "source-supported"
                    ? "◦"
                    : "?",
          evidence: claim.decidedBy?.summary ?? "No evidence recorded.",
          scopeLabel: claim.decidedBy
            ? SCOPE_LABELS[claim.decidedBy.scope]
            : null,
        })),
    }));
  }
  _contentGates(): Readonly<Record<ContentPathId, ContentGate>> {
    const gates = this.ports.workspaceStore().getController().session.selection
      ?.selected
      ? this.ports.workspaceStore().getController().contentGates()
      : [];
    const entries = (["text", "image", "animation", "gif"] as const).map(
      (path) => {
        const gate = gates.find((candidate) => candidate.path === path);
        return [
          path,
          gate ?? {
            path,
            allowed: false,
            reason: "Connect and identify a display first.",
            missingClaims: [],
          },
        ] as const;
      },
    );
    return Object.fromEntries(entries) as Record<ContentPathId, ContentGate>;
  }
  _investigationView(): InvestigationSummaryView | null {
    const investigation = this.ports
      .workspaceStore()
      .getController().investigation;
    if (!investigation) return null;
    return {
      id: investigation.id,
      goalLabel:
        investigation.goal.kind === "troubleshoot"
          ? `Troubleshooting: ${investigation.goal.description}`
          : "Guided development",
      status: investigation.status,
      completedTests: investigation.completedTests,
    };
  }
  _guidedTestViews(): readonly GuidedTestView[] {
    return this.ports
      .workspaceStore()
      .getController()
      .guidedTests()
      .map((entry) => ({
        id: entry.test.id,
        title: entry.test.title,
        question: entry.test.about.question,
        category: entry.test.category,
        estimatedObservationTime: entry.test.about.estimatedObservationTime,
        available:
          entry.available && this.ports.snapshotStore()._liveResolved(),
        reason: !this.ports.snapshotStore()._liveResolved()
          ? "Requires a live connected display."
          : entry.reason,
        lastStatus:
          this.ports
            .workspaceStore()
            .getController()
            .investigation?.completedTests.filter(
              (test) => test.testId === entry.test.id,
            )
            .at(-1)?.status ?? null,
      }));
  }
  _orchestrationView(): OrchestrationDebugView {
    return {
      investigationId:
        this.ports.workspaceStore().getController().investigation?.id ?? null,
      corePlanStepId:
        this.ports.workspaceStore().getController().corePlanProgress()?.current
          ?.step.id ?? null,
      experiments: this.ports
        .workspaceStore()
        .getController()
        .experiments.map((run) => ({
          experimentRunId: run.experimentRunId,
          definitionId: run.definitionId,
          status: run.status,
          resolution: run.resolution,
          corePlanStepId: run.corePlanStepId,
          fingerprintKey: run.fingerprint.key,
          attempts: run.attempts.map((attempt) => ({
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
            reason: attempt.reason,
            validity: attempt.validity,
            failureKind: attempt.failureKind,
          })),
        })),
      transfers: this.ports
        .workspaceStore()
        .getController()
        .transfers.map((transfer) => ({
          transferId: transfer.transferId,
          attemptId: transfer.attemptId,
          reason: transfer.reason,
          programCrc32: transfer.fingerprint.programCrc32,
          transactionIds: transfer.transactionIds,
          failureReason: transfer.failureReason,
        })),
      panelProgram: (() => {
        const panel = this.ports
          .workspaceStore()
          .getController()
          .panelProgram();
        return {
          certainty: panel.certainty,
          kind: panel.kind,
          label: panel.label,
          fingerprintKey: panel.fingerprint?.key ?? null,
        };
      })(),
      recommendationTrail: this.ports
        .workspaceStore()
        .getController()
        .recommendationTrail.map((entry) => ({
          testId: entry.testId,
          at: entry.at,
          evidenceCount: entry.evidenceCount,
          origin: entry.origin ?? null,
        })),
      cycling: this.ports.workspaceStore().getController().recommendationCycle
        .cycling,
      unclassifiedDuplicates: this.ports
        .workspaceStore()
        .getController()
        .transferSummary().unclassifiedDuplicates,
    };
  }
  _coreProgressView(): CoreProgressView | null {
    const progress = this.ports
      .workspaceStore()
      .getController()
      .corePlanProgress();
    if (!progress) return null;
    return {
      title: progress.plan.title,
      completed: progress.completed,
      skipped: progress.skipped,
      resolved: progress.resolved,
      total: progress.total,
      complete: progress.complete,
      currentStepId: progress.current?.step.id ?? null,
      // Every milestone keeps its own ordinal, skipped ones included. A
      // skipped slot is shown as skipped at its number; it does not vanish
      // and take the denominator down with it, so "Test 6 of 6" stays "Test
      // 6 of 6" for the whole investigation.
      steps: progress.steps.map((entry) => ({
        id: entry.step.id,
        position: entry.step.ordinal,
        title: entry.step.title,
        purpose: entry.step.purpose,
        state: entry.state,
        skipReason: entry.skipReason,
      })),
      retryableTestId:
        this.ports.guidedController()._retryableOnCurrentMilestone()?.testId ??
        null,
    };
  }
  _storedInvestigationView(): StoredInvestigationView | null {
    const profileId =
      this.ports.workspaceStore().getController().session.profile?.id ?? null;
    const stored = latestInvestigationFor(null, this.environment.storage);
    if (!stored) return null;
    // Never offer to resume the investigation that is already active.
    if (
      this.ports.workspaceStore().getController().investigation?.id ===
      stored.investigation.id
    )
      return null;
    return {
      savedAt: stored.savedAt,
      deviceName: stored.investigation.deviceName,
      goalLabel:
        stored.investigation.goal.description || stored.investigation.goal.kind,
      testCount: stored.investigation.completedTests.length,
      matchesProfile:
        profileId !== null && stored.investigation.profileId === profileId,
      sameAuthorizedDevice: bindingAllowsSessionContinuity(
        stored.investigation.deviceBinding,
        deviceIdentityBinding(
          this.ports.workspaceStore().getController().session.fingerprint,
          profileId,
        ),
      ),
      experimentCount:
        stored.investigation.orchestration?.experiments.length ?? 0,
    };
  }
}
