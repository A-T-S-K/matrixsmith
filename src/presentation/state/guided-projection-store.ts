import {
  observationsComplete,
  aggregateAttemptDurations,
  describeAggregate,
  stepForTest,
} from "./dependencies";
import type { ObservationValue } from "./dependencies";
import type { GuidedFlowState } from "./types";
import { recommendationView } from "./selectors";

import type { GuidedController } from "./guided-controller";
import type { WorkspaceStore } from "./workspace-store";
import type { ProjectionStore } from "./projection-store";

import type { GuidedFlowInternal } from "./internal-types";
interface Ports {
  guidedController(): Pick<
    GuidedController,
    "getGuidedFlow" | "_observationSteps"
  >;
  workspaceStore(): Pick<WorkspaceStore, "getController">;
  projectionStore(): Pick<ProjectionStore, "_coreProgressView">;
}
export class GuidedProjectionStore {
  constructor(private readonly ports: Ports) {}
  _guidedFlowView(): GuidedFlowState | null {
    const flow = this.ports.guidedController().getGuidedFlow();
    if (!flow) return null;
    const machine = flow.machine;
    if (machine.value === "idle") return null;
    const observing =
      machine.value === "observing-timed" ||
      machine.value === "observing-questions"
        ? machine
        : machine.value === "retry-confirmation"
          ? machine.resume
          : null;
    const timed = observing?.value === "observing-timed" ? observing : null;
    const recordedDurations = flow.timerSpec
      ? flow.timerSpec.phases
          .flatMap((phase) => [
            phase.fieldId,
            phase.stillDurationFieldId ?? phase.fieldId,
          ])
          .map((fieldId) => flow.values[fieldId])
          .filter(
            (value): value is Extract<ObservationValue, { kind: "duration" }> =>
              value?.kind === "duration",
          )
          .map((value) => value.milliseconds)
      : [];
    const elapsed = timed
      ? timed.timing.elapsedMs
      : recordedDurations.length > 0
        ? Math.max(...recordedDurations)
        : null;
    const timerPhaseIndex = timed
      ? timed.timing.phaseIndex
      : flow.timerSpec
        ? flow.timerSpec.phases.length
        : 0;
    const timerStopped = Boolean(flow.timerSpec) && timed === null;
    const currentPhase = timed
      ? (flow.timerSpec?.phases[timerPhaseIndex] ?? null)
      : null;
    const previousPhase =
      timerPhaseIndex > 0
        ? (flow.timerSpec?.phases[timerPhaseIndex - 1] ?? null)
        : null;
    const previousEvent = previousPhase
      ? flow.values[previousPhase.fieldId]
      : undefined;
    const phaseStartMs =
      previousEvent?.kind === "duration" ? previousEvent.milliseconds : 0;
    const phaseElapsedMs =
      elapsed !== null && currentPhase
        ? Math.max(0, elapsed - phaseStartMs)
        : null;
    const steps = this.ports.guidedController()._observationSteps(flow);
    const stepIndex = Math.max(
      0,
      Math.min(flow.stepIndex, Math.max(0, steps.length - 1)),
    );
    // A timed test watches first and asks afterwards; everything else is
    // already in its questions stage the moment the transfer lands.
    const observeStage: "timing" | "questions" = timed ? "timing" : "questions";
    const stage: GuidedFlowState["stage"] =
      machine.value === "about"
        ? "about"
        : machine.value === "transferring"
          ? "running"
          : machine.value === "result"
            ? "result"
            : machine.value === "failed"
              ? "failed"
              : "observe";
    // The quantity worth summarising is the DERIVED visible static hold —
    // how long the finished image stayed put — measured between the two human
    // marks, never the raw elapsed time since the upload.
    const holds = flow.attempts
      .filter((attempt) => attempt.validity === "valid")
      .map((attempt) => {
        const visible = attempt.marks.find(
          (mark) => mark.event === "visible",
        )?.elapsedMs;
        const ended = attempt.marks.find((mark) =>
          mark.event.startsWith("movement"),
        )?.elapsedMs;
        return visible !== undefined && ended !== undefined
          ? Math.max(0, ended - visible)
          : undefined;
      })
      .filter((value): value is number => value !== undefined);
    const aggregate = aggregateAttemptDurations(holds);
    return {
      testId: flow.testId,
      title: flow.title,
      stage,
      about: flow.about,
      consequence: flow.consequence,
      category: flow.category,
      risk: flow.risk,
      planSummary: flow.planSummary,
      previews: [...flow.previews],
      regions: [...flow.regions],
      observationSpecs: [...flow.observationSpecs],
      values: { ...flow.values },
      observationsReady: observationsComplete(
        steps.map((step) => step.spec),
        Object.values(flow.values),
      ),
      timerSpec: flow.timerSpec,
      timerStartedAt: timed?.run.finalWriteAcceptedAt ?? null,
      timerElapsedMs: elapsed,
      phaseElapsedMs,
      currentPhase,
      timerPhaseIndex,
      timerStopped,
      transferProgress:
        machine.value === "transferring"
          ? `Uploading diagnostic program (${machine.progress.totalPackets} packets at ${flow.planSummary?.pacingMs ?? "?"} ms pacing)…`
          : null,
      failure:
        machine.value === "failed"
          ? {
              message: machine.failure.message,
              retryable: machine.failure.retryable,
            }
          : null,
      transactionIds: [...flow.transactionIds],
      result: machine.value === "result" ? machine.completed : null,
      nextTest:
        machine.value === "result"
          ? recommendationView(
              this.ports
                .workspaceStore()
                .getController()
                .recommendations()[0] ?? null,
            )
          : null,
      coreComplete:
        this.ports.workspaceStore().getController().corePlanProgress()
          ?.complete ?? false,
      presentation: flow.presentation,
      steps,
      stepIndex,
      observeStage,
      questionPresentation: steps.some((step) => step.regionId !== null)
        ? "spatial"
        : "simple",
      attempts: flow.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        validity: attempt.validity,
        invalidationReason: attempt.invalidationReason,
        parameters: attempt.parameters,
        marks: attempt.marks,
      })),
      // The authoritative attempt number, not a count of what this dialog has
      // seen. A measure-again opens a fresh flow but CONTINUES the experiment,
      // so restarting the display count here would show "Attempt 1" over an
      // attempt the record calls 3 — exactly the renumbering the attempt model
      // exists to prevent.
      attemptNumber:
        flow.attempts.at(-1)?.attemptNumber ??
        this._openAttemptNumber(flow) ??
        1,
      // Undo is only honest while the next physical event has not happened.
      canUndoMark:
        Boolean(flow.timerSpec) && timed !== null && timerPhaseIndex > 0,
      timingSummary: aggregate ? describeAggregate(aggregate) : null,
      awaitingRetryConfirmation: machine.value === "retry-confirmation",
      corePosition: this._corePositionFor(flow.testId),
    };
  }
  _corePositionFor(testId: string): GuidedFlowState["corePosition"] {
    const progress = this.ports.projectionStore()._coreProgressView();
    const plan = this.ports.workspaceStore().getController().corePlan();
    const step = stepForTest(
      plan,
      testId,
      this.ports.workspaceStore().getController().corePlanProgress(),
    );
    if (!progress || !step) return null;
    const entry = progress.steps.find((candidate) => candidate.id === step.id);
    if (!entry) return null;
    return {
      position: entry.position,
      total: progress.total,
      stepTitle: entry.title,
    };
  }
  _openAttemptNumber(flow: GuidedFlowInternal): number | null {
    const run = this.ports
      .workspaceStore()
      .getController()
      .experiments.find(
        (entry) => entry.experimentRunId === flow.experimentRunId,
      );
    return run?.attempts.at(-1)?.attemptNumber ?? null;
  }
}
