import type { PresentationEnvironment } from "../environment";
import { Framebuffer } from "./dependencies";
import type { ObservationValue, ObservationAttempt } from "./dependencies";
import type { DiagnosticRegionView } from "./types";

import { completedTestResolution } from "./dependencies";
import type { ObservationStepView } from "./types";
import { transitionGuidedTest } from "../../application/machines/guided-test-machine";
import {
  timerDrivenFieldIds,
  ATTEMPT_INVALIDATION_LABELS,
} from "./dependencies";
import type { AttemptValidity } from "./dependencies";
import { regionView, attemptFailureKind } from "./selectors";
import type { RecommendationOrigin } from "./dependencies";
import { presentationFor, operationParameters } from "./selectors";
import type { SnapshotStore } from "./snapshot-store";
import type { WorkspaceStore } from "./workspace-store";
import type { InvestigationStore } from "./investigation-store";
import type { NoticeStore } from "./notice-store";
import type { NavigationStore } from "./navigation-store";
import type { ContentSendStore } from "./content-send-store";

import type { GuidedFlowInternal } from "./internal-types";
interface Ports {
  snapshotStore(): Pick<SnapshotStore, "_emit">;
  workspaceStore(): Pick<WorkspaceStore, "getController" | "getTransport">;
  investigationStore(): Pick<InvestigationStore, "_persistInvestigation">;
  noticeStore(): Pick<NoticeStore, "setError" | "setInfo" | "_run">;
  navigationStore(): Pick<NavigationStore, "_closeOverlay" | "_openOverlay">;
  contentSendStore(): Pick<ContentSendStore, "getWakeLock">;
}
export class GuidedController {
  private _guidedFlow: GuidedFlowInternal | null = null;
  constructor(
    private readonly ports: Ports,
    private readonly environment: Pick<
      PresentationEnvironment,
      "signalTimingStart"
    >,
  ) {}
  getGuidedFlow() {
    return this._guidedFlow;
  }
  setGuidedStep(index: number): void {
    const flow = this._guidedFlow;
    if (!flow) return;
    const steps = this._observationSteps(flow);
    flow.stepIndex = Math.max(
      0,
      Math.min(index, Math.max(0, steps.length - 1)),
    );
    this.ports.snapshotStore()._emit();
  }
  nextGuidedStep(): void {
    this.setGuidedStep((this._guidedFlow?.stepIndex ?? 0) + 1);
  }
  previousGuidedStep(): void {
    this.setGuidedStep((this._guidedFlow?.stepIndex ?? 0) - 1);
  }
  focusRegion(regionId: string): void {
    const flow = this._guidedFlow;
    if (!flow) return;
    const steps = this._observationSteps(flow);
    const index = steps.findIndex(
      (step: ObservationStepView) => step.regionId === regionId,
    );
    if (index >= 0) this.setGuidedStep(index);
  }
  setGuidedObservation(value: ObservationValue): void {
    const flow = this._guidedFlow;
    if (!flow) return;
    flow.values = { ...flow.values, [value.fieldId]: value };
    flow.machine = transitionGuidedTest(flow.machine, {
      type: "ANSWER",
      answer: value,
    });
    this.ports.snapshotStore()._emit();
  }
  submitGuidedObservations(): void {
    const flow = this._guidedFlow;
    if (!flow || flow.machine.value !== "observing-questions") return;
    try {
      const values = Object.values(flow.values);
      // A non-timed test settles its single attempt here; timed tests already
      // settled theirs when the timeline closed.
      if (!flow.timerSpec) {
        this.ports
          .workspaceStore()
          .getController()
          .settleAttempt(flow.machine.run.runId, {
            validity: "valid",
            observations: values,
            timing: null,
          });
      }
      // The controller settles the run from the interpretation itself, so the
      // result's resolution and its run's cannot disagree.
      const completed = this.ports
        .workspaceStore()
        .getController()
        .recordGuidedTestObservations(
          flow.testId,
          values,
          flow.transactionIds,
          flow.startedAt,
          flow.attempts,
        );
      flow.machine = transitionGuidedTest(flow.machine, {
        type: "COMPLETE",
        completed,
      });
      this.ports.investigationStore()._persistInvestigation();
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
    }
    this.ports.snapshotStore()._emit();
  }
  continueToNextTest(
    options: { readonly includeOptional?: boolean } = {},
  ): void {
    this._guidedFlow = null;
    this.ports.navigationStore()._closeOverlay("guided");
    const retryable = this._retryableOnCurrentMilestone();
    if (retryable) {
      this.ports
        .noticeStore()
        .setInfo(
          `${retryable.title} did not run long enough to settle this milestone. Choose Measure again to repeat the same parameters.`,
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    const progress = this.ports
      .workspaceStore()
      .getController()
      .corePlanProgress();
    if (progress?.complete && !options.includeOptional) {
      this.ports
        .noticeStore()
        .setInfo(
          "Core characterization is complete. You can finish now or choose optional measurements.",
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    const next =
      this.ports.workspaceStore().getController().recommendations()[0] ?? null;
    if (!next) {
      this.ports
        .noticeStore()
        .setInfo("No further guided tests are currently available.");
      this.ports.snapshotStore()._emit();
      return;
    }
    const concluded = this.ports
      .workspaceStore()
      .getController()
      .investigation?.completedTests.filter(
        (test) => test.testId === next.testId,
      )
      .at(-1);
    if (
      concluded &&
      completedTestResolution(concluded) !== "retryable-incomplete"
    ) {
      this.ports
        .noticeStore()
        .setError(
          `${next.title} already produced a result. Reopen it deliberately if you want to run it again.`,
        );
      this.ports.snapshotStore()._emit();
      return;
    }
    this.startGuidedTest(
      next.testId,
      options.includeOptional ? "manual-selection" : "automatic-recommendation",
    );
  }
  reopenExperiment(testId: string, reason: string): void {
    this.ports
      .workspaceStore()
      .getController()
      .reopenExperiment(testId, reason);
    this.startGuidedTest(testId, "explicit-reopen");
  }
  measureAgain(testId: string): void {
    this.closeGuidedTest();
    this.startGuidedTest(testId, "explicit-retry");
    const flow = this._guidedFlow;
    if (flow) flow.pendingTransferReason = "explicit-measure-again";
    this.ports.snapshotStore()._emit();
  }
  closeGuidedTest(): void {
    const flow = this._guidedFlow;
    // A running transfer cannot be dismissed as if canceled: the persistent
    // BLE upload continues regardless of the dialog.
    if (flow?.machine.value === "transferring") return;
    // After the transfer, closing is never a silent discard — the device WAS
    // changed, so the abandonment is recorded as incomplete evidence.
    if (
      flow &&
      (flow.machine.value === "observing-timed" ||
        flow.machine.value === "observing-questions" ||
        flow.machine.value === "retry-confirmation") &&
      flow.transactionIds.length > 0
    ) {
      this.abandonGuidedTest();
      return;
    }
    if (flow)
      flow.machine = transitionGuidedTest(flow.machine, { type: "ABANDON" });
    this._guidedFlow = null;
    this.ports.navigationStore()._closeOverlay("guided");
    this.ports.snapshotStore()._emit();
  }
  abandonGuidedTest(): void {
    const flow = this._guidedFlow;
    if (
      !flow ||
      !(
        flow.machine.value === "observing-timed" ||
        flow.machine.value === "observing-questions" ||
        flow.machine.value === "retry-confirmation"
      )
    )
      return;
    try {
      // An abandoned run still closes its open attempt, so the report can
      // say the observation stopped rather than silently losing the timeline.
      const observing =
        flow.machine.value === "retry-confirmation"
          ? flow.machine.resume
          : flow.machine;
      if (flow.timerSpec && observing.value === "observing-timed")
        this._completeAttempt("incomplete");
      else
        this.ports
          .workspaceStore()
          .getController()
          .settleAttempt(observing.run.runId, {
            validity: "invalid",
            failureKind: "observation-incomplete",
            invalidationReason: "Observation stopped before completion.",
          });
      this.ports
        .workspaceStore()
        .getController()
        .abandonGuidedTest(
          flow.testId,
          Object.values(flow.values),
          flow.transactionIds,
          flow.startedAt,
          flow.attempts,
        );
      this.ports.investigationStore()._persistInvestigation();
      this.ports
        .noticeStore()
        .setInfo(
          "Observation stopped. The test was recorded as incomplete — the transmitted content and automatic capture remain as evidence, and its report is available.",
        );
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
    }
    flow.machine = transitionGuidedTest(flow.machine, { type: "ABANDON" });
    this._guidedFlow = null;
    this.ports.navigationStore()._closeOverlay("guided");
    this.ports.snapshotStore()._emit();
  }
  _completeAttempt(validity: AttemptValidity): void {
    const flow = this._guidedFlow;
    if (!flow) return;
    const observing =
      flow.machine.value === "observing-timed" ||
      flow.machine.value === "observing-questions"
        ? flow.machine
        : flow.machine.value === "retry-confirmation"
          ? flow.machine.resume
          : null;
    if (!observing) return;
    const open = flow.attempts.at(-1);
    if (!open || open.endedAt !== null) return;
    const settled: ObservationAttempt = {
      ...open,
      marks: [...flow.marks],
      values: validity === "valid" ? Object.values(flow.values) : [],
      validity,
      invalidationReason:
        validity === "valid" ? null : ATTEMPT_INVALIDATION_LABELS[validity],
      endedAt: new Date().toISOString(),
    };
    flow.attempts = [...flow.attempts.slice(0, -1), settled];
    // Mirror the outcome onto the semantic attempt. An invalid attempt is
    // never removed: it is part of what happened, and the report has to be
    // able to say a measurement was discarded rather than silently omit it.
    this.ports
      .workspaceStore()
      .getController()
      .settleAttempt(observing.run.runId, {
        validity: validity === "valid" ? "valid" : "invalid",
        invalidationReason: settled.invalidationReason,
        failureKind: attemptFailureKind(validity),
        observations: settled.values,
        timing: settled,
      });
    flow.machine = transitionGuidedTest(observing, {
      type: "OBSERVE_QUESTIONS",
      run: observing.run,
      answers: { values: { ...flow.values } },
    });
  }
  _discardAttemptValues(): void {
    const flow = this._guidedFlow;
    if (!flow?.timerSpec) return;
    for (const fieldId of timerDrivenFieldIds(flow.timerSpec))
      delete flow.values[fieldId];
    flow.marks = [];
    flow.machine = transitionGuidedTest(flow.machine, { type: "RESET_TIMING" });
  }
  _signalTimingStart(): void {
    try {
      this.environment.signalTimingStart();
    } catch {
      /* cue is optional */
    }
  }
  _observationSteps(flow: GuidedFlowInternal): readonly ObservationStepView[] {
    const driven = timerDrivenFieldIds(flow.timerSpec);
    const present = new Set(flow.regions.map((region) => region.id));
    return flow.observationSpecs
      .filter((spec) => !driven.has(spec.id) && spec.kind !== "duration")
      .filter(
        (spec) => spec.regionId === undefined || present.has(spec.regionId),
      )
      .map((spec) => ({
        spec,
        regionId: spec.regionId ?? null,
        answered: flow.values[spec.id] !== undefined,
      }));
  }
  _retryableOnCurrentMilestone(): {
    readonly testId: string;
    readonly title: string;
  } | null {
    const current = this.ports
      .workspaceStore()
      .getController()
      .corePlanProgress()?.current?.step;
    const investigation = this.ports
      .workspaceStore()
      .getController().investigation;
    if (!current || !investigation) return null;
    const test = [...investigation.completedTests]
      .reverse()
      .find(
        (entry) =>
          current.testIds.includes(entry.testId) &&
          completedTestResolution(entry) === "retryable-incomplete",
      );
    if (!test) return null;
    return {
      testId: test.testId,
      title: this.ports.workspaceStore().getController().guidedTest(test.testId)
        .title,
    };
  }
  _guidedTestVisuals(
    operation: import("../../core/operations").MatrixOperation,
  ): {
    previews: Framebuffer[];
    regions: DiagnosticRegionView[];
  } {
    const profile = this.ports.workspaceStore().getController().session.profile;
    if (!profile || operation.type !== "ShowDiagnostic")
      return { previews: [], regions: [] };
    try {
      const previews = [
        ...this.ports
          .workspaceStore()
          .getController()
          .guidedTestPreviews(operation),
      ];
      const regions = this.ports
        .workspaceStore()
        .getController()
        .diagnosticRegions(operation);
      return { previews, regions: regions.map((region) => regionView(region)) };
    } catch {
      return { previews: [], regions: [] };
    }
  }
  recordGuidedTimeline(action: "event" | "fail" | "still"): void {
    const flow = this._guidedFlow;
    if (!flow?.timerSpec || flow.machine.value !== "observing-timed") return;
    const phase = flow.timerSpec.phases[flow.machine.timing.phaseIndex];
    if (!phase) return;
    const now = new Date();
    const elapsed = Math.max(
      0,
      now.getTime() - Date.parse(flow.machine.run.finalWriteAcceptedAt),
    );
    const setBooleans = (
      sets?: readonly { fieldId: string; value: "yes" | "no" }[],
    ): void => {
      for (const set of sets ?? [])
        flow.values[set.fieldId] = {
          kind: "boolean",
          fieldId: set.fieldId,
          value: set.value,
        };
    };
    // The tap is a HUMAN observation of a physical event, recorded with its
    // provenance. The timestamp is exact; the precision it represents is not.
    const mark = (event: string, fieldId?: string): void => {
      flow.marks = [
        ...flow.marks,
        {
          event,
          timestamp: now.toISOString(),
          source: "human-observed",
          elapsedMs: elapsed,
          ...(fieldId ? { fieldId } : {}),
        },
      ];
    };
    if (action === "event") {
      flow.values[phase.fieldId] = {
        kind: "duration",
        fieldId: phase.fieldId,
        milliseconds: elapsed,
        measuredBy: "matrixsmith-timer",
      };
      setBooleans(phase.eventSets);
      mark(phase.id, phase.fieldId);
      const marked = transitionGuidedTest(flow.machine, {
        type: "MARK",
        id: phase.id,
        elapsedMs: elapsed,
      });
      flow.machine = marked;
      if (
        marked.value === "observing-timed" &&
        marked.timing.phaseIndex >= flow.timerSpec.phases.length
      )
        this._completeAttempt("valid");
    } else if (action === "fail") {
      setBooleans(phase.failSets);
      mark(`${phase.id}:not-observed`);
      flow.machine = transitionGuidedTest(flow.machine, {
        type: "MARK",
        id: `${phase.id}:not-observed`,
        elapsedMs: elapsed,
      });
      // The event genuinely did not happen — that is a real observation of
      // the hardware, not a mistimed measurement.
      this._completeAttempt("valid");
    } else {
      const fieldId = phase.stillDurationFieldId ?? phase.fieldId;
      flow.values[fieldId] = {
        kind: "duration",
        fieldId,
        milliseconds: elapsed,
        measuredBy: "matrixsmith-timer",
        note: "observation ended with the image still completely static",
      };
      setBooleans(phase.stillSets);
      mark(`${phase.id}:still`, fieldId);
      flow.machine = transitionGuidedTest(flow.machine, {
        type: "MARK",
        id: `${phase.id}:still`,
        elapsedMs: elapsed,
      });
      this._completeAttempt("valid");
    }
    this.ports.snapshotStore()._emit();
  }
  markObservationMissed(
    reason: Extract<
      AttemptValidity,
      "missed-t1" | "missed-t2" | "accidental-tap"
    >,
  ): void {
    const flow = this._guidedFlow;
    if (!flow?.timerSpec || flow.machine.value !== "observing-timed") return;
    this._discardAttemptValues();
    this._completeAttempt(reason);
    flow.pendingTransferReason = "explicit-retry-missed-observation";
    flow.machine = transitionGuidedTest(flow.machine, {
      type: "REQUEST_RETRY",
    });
    this.ports
      .noticeStore()
      .setInfo(
        "Measurement attempt discarded. Nothing about the display was concluded from it.",
      );
    this.ports.snapshotStore()._emit();
  }
  undoLastMark(): void {
    const flow = this._guidedFlow;
    if (
      !flow?.timerSpec ||
      flow.machine.value !== "observing-timed" ||
      flow.machine.timing.phaseIndex === 0
    )
      return;
    const removed = flow.marks.at(-1);
    flow.marks = flow.marks.slice(0, -1);
    if (removed?.fieldId) delete flow.values[removed.fieldId];
    const phase = flow.timerSpec.phases[flow.machine.timing.phaseIndex - 1];
    for (const set of phase?.eventSets ?? []) delete flow.values[set.fieldId];
    flow.machine = transitionGuidedTest(flow.machine, { type: "UNDO_MARK" });
    this.ports
      .noticeStore()
      .setInfo(
        "Mark removed. Keep watching — the timer is still running from the upload.",
      );
    this.ports.snapshotStore()._emit();
  }
  requestTimingRetry(): void {
    const flow = this._guidedFlow;
    if (!flow) return;
    // Asking to measure again is a different intent from recovering a missed
    // mark, and reports keep them apart.
    if (flow.pendingTransferReason !== "explicit-retry-missed-observation")
      flow.pendingTransferReason = "explicit-measure-again";
    flow.machine = transitionGuidedTest(flow.machine, {
      type: "REQUEST_RETRY",
    });
    this.ports.snapshotStore()._emit();
  }
  cancelTimingRetry(): void {
    const flow = this._guidedFlow;
    if (!flow) return;
    flow.machine = transitionGuidedTest(flow.machine, {
      type: "CANCEL_RETRY",
    });
    this.ports.snapshotStore()._emit();
  }
  async retryTimingAttempt(): Promise<void> {
    const flow = this._guidedFlow;
    if (!flow || flow.machine.value !== "retry-confirmation") return;
    if (flow.machine.resume.value === "observing-timed") {
      flow.machine = flow.machine.resume;
      this._discardAttemptValues();
      this._completeAttempt("user-restarted");
    }
    flow.machine = transitionGuidedTest(
      flow.machine.value === "retry-confirmation"
        ? flow.machine
        : { value: "retry-confirmation", resume: flow.machine },
      { type: "RETRY" },
    );
    await this.confirmGuidedTransfer();
    // The next transmission is a fresh intent, not a repeat of this one.
    flow.pendingTransferReason = "explicit-measure-again";
  }
  async retryFailedGuidedTransfer(): Promise<void> {
    const flow = this._guidedFlow;
    if (!flow || flow.machine.value !== "failed") return;
    flow.machine = transitionGuidedTest(flow.machine, { type: "RETRY" });
    if (flow.machine.value === "about") await this.confirmGuidedTransfer();
  }
  startGuidedTest(
    testId: string,
    origin: RecommendationOrigin = "automatic-recommendation",
  ): void {
    this.ports.noticeStore().setError(null);
    try {
      const test = this.ports
        .workspaceStore()
        .getController()
        .guidedTest(testId);
      const availability = this.ports
        .workspaceStore()
        .getController()
        .guidedTests()
        .find((entry) => entry.test.id === testId);
      if (availability && !availability.available)
        throw new Error(
          availability.reason ?? "This test's prerequisites are not met.",
        );
      // How the user got here decides whether a repeat is an algorithmic loop
      // or a deliberate re-measurement. Only the former is a cycle — and a
      // detected cycle has to STOP the workflow here, before an experiment is
      // opened and long before anything is transmitted. A warning the user
      // reads after the panel has been rewritten is not a guard.
      const verdict = this.ports
        .workspaceStore()
        .getController()
        .noteRecommendationTaken(testId, origin);
      if (verdict.cycling) {
        throw new Error(
          "MatrixSmith detected a recommendation cycle and stopped before running another test. " +
            `${verdict.detail ?? ""} Reopen a test deliberately if you want to measure it again.`.trim(),
        );
      }
      const run = this.ports
        .workspaceStore()
        .getController()
        .beginExperiment(testId);
      const plan = this.ports
        .workspaceStore()
        .getController()
        .planGuidedTest(testId);
      // The resolved operation (evidence-aware where declared) drives the
      // preview and region diagram, so About always shows the actual run.
      const { previews, regions } = this._guidedTestVisuals(
        this.ports.workspaceStore().getController().guidedTestOperation(testId),
      );
      this._guidedFlow = {
        testId,
        title: test.title,
        machine: transitionGuidedTest(
          { value: "idle" },
          {
            type: "PREPARE",
            prepared: {
              testId,
              title: test.title,
              planDigest:
                "digest" in plan && typeof plan.digest === "string"
                  ? plan.digest
                  : plan.id,
            },
          },
        ),
        about: test.about,
        consequence: test.consequence,
        category: test.category,
        risk: test.risk,
        planSummary: {
          packetCount: plan.packets.length,
          programBytes:
            typeof plan.metadata.programBytes === "number"
              ? plan.metadata.programBytes
              : 0,
          chunkCount:
            typeof plan.metadata.chunkCount === "number"
              ? plan.metadata.chunkCount
              : 0,
          crc32:
            typeof plan.metadata.crc32 === "string"
              ? plan.metadata.crc32
              : "unknown",
          pacingMs:
            typeof plan.metadata.pacingMs === "number"
              ? plan.metadata.pacingMs
              : 0,
        },
        previews,
        regions,
        observationSpecs: [...test.observation],
        values: {},
        timerSpec: test.timer ?? null,
        startedAt: new Date().toISOString(),
        transactionIds: [],
        presentation: presentationFor(test),
        stepIndex: 0,
        parameters: operationParameters(
          this.ports
            .workspaceStore()
            .getController()
            .guidedTestOperation(testId),
        ),
        attempts: [],
        marks: [],
        experimentRunId: run.experimentRunId,
        // Reopening a concluded experiment is a different act from starting
        // one, and the report must be able to say which happened.
        pendingTransferReason: run.reopenReason
          ? "explicit-reopen"
          : "initial-experiment",
      };
      this.ports.navigationStore()._openOverlay("guided");
    } catch (error) {
      this.ports
        .noticeStore()
        .setError(error instanceof Error ? error.message : String(error));
    }
    this.ports.snapshotStore()._emit();
  }
  async confirmGuidedTransfer(): Promise<void> {
    const flow = this._guidedFlow;
    if (!flow) return;
    if (flow.machine.value === "failed" && flow.machine.failure.retryable)
      flow.machine = transitionGuidedTest(flow.machine, { type: "RETRY" });
    if (flow.machine.value !== "about") return;
    flow.machine = transitionGuidedTest(flow.machine, {
      type: "START_TRANSFER",
      progress: {
        completedPackets: 0,
        totalPackets: flow.planSummary?.packetCount ?? 0,
        completedBytes: 0,
        totalBytes: flow.planSummary?.programBytes ?? 0,
      },
    });
    this.ports.snapshotStore()._emit();
    await this.ports
      .noticeStore()
      ._run("Transferring diagnostic content…", async () => {
        await this.ports.contentSendStore().getWakeLock().acquire();
        try {
          // The controller's attempt is the authoritative identity; the timing
          // record below borrows its number rather than counting separately. Two
          // independently numbered attempt lists drift the moment one of them
          // gains an entry the other cannot see — a failed transfer, for example.
          const attempt = this.ports
            .workspaceStore()
            .getController()
            .beginAttempt(flow.experimentRunId, flow.pendingTransferReason);
          try {
            const { transactionIds, finalWriteAcceptedAt } = await this.ports
              .workspaceStore()
              .getController()
              .runGuidedTestTransfer(flow.testId, {
                confirmedConsequence: true,
                reason: flow.pendingTransferReason,
                attemptId: attempt.attemptId,
              });
            flow.transactionIds = [...flow.transactionIds, ...transactionIds];
            if (flow.timerSpec && !finalWriteAcceptedAt)
              throw new Error(
                "The transfer completed without an accepted-write timestamp, so a timed observation cannot start safely.",
              );
            // Each transfer opens a fresh observation attempt: T0 restarts, so the
            // human's marks belong to this run and not the previous one.
            if (flow.timerSpec) {
              flow.marks = [];
            }
            flow.attempts = [
              ...flow.attempts,
              {
                attemptNumber: attempt.attemptNumber,
                parameters: { ...flow.parameters },
                t0: finalWriteAcceptedAt,
                marks: [],
                values: [],
                validity: "incomplete",
                invalidationReason: null,
                note: null,
                startedAt: new Date().toISOString(),
                endedAt: null,
              },
            ];
            const activeRun = {
              runId: attempt.attemptId,
              prepared:
                flow.machine.value === "transferring"
                  ? flow.machine.prepared
                  : {
                      testId: flow.testId,
                      title: flow.title,
                      planDigest: "unknown",
                    },
              startedAt: attempt.startedAt,
              finalWriteAcceptedAt: finalWriteAcceptedAt ?? attempt.startedAt,
            };
            flow.machine = transitionGuidedTest(
              flow.machine,
              flow.timerSpec
                ? { type: "OBSERVE_TIMED", run: activeRun }
                : { type: "OBSERVE_QUESTIONS", run: activeRun },
            );
            if (flow.timerSpec) this._signalTimingStart();
            this.ports
              .noticeStore()
              .setInfo(
                "Diagnostic upload sent; host writes completed. Watch the physical panel now to verify acceptance.",
              );
          } catch (error) {
            // The transfer failed, so this attempt number is spent. It stays in
            // the record as a failed attempt — the controller has already settled
            // it — and the next try becomes the NEXT attempt. Blaming the person
            // for a radio failure, or silently reusing the number, both lose what
            // actually happened.
            flow.attempts = [
              ...flow.attempts,
              {
                attemptNumber: attempt.attemptNumber,
                parameters: { ...flow.parameters },
                t0: null,
                marks: [],
                values: [],
                validity: "transfer-failed",
                invalidationReason:
                  ATTEMPT_INVALIDATION_LABELS["transfer-failed"],
                note: null,
                startedAt: attempt.startedAt,
                endedAt: new Date().toISOString(),
              },
            ];
            flow.machine = transitionGuidedTest(flow.machine, {
              type: "FAIL",
              failure: {
                code: "transfer-failed",
                message: error instanceof Error ? error.message : String(error),
                retryable:
                  this.ports.workspaceStore().getTransport().state ===
                  "connected",
              },
            });
            throw error;
          }
        } finally {
          await this.ports.contentSendStore().getWakeLock().release();
        }
      });
    this.ports.snapshotStore()._emit();
  }
}
