import type { ObservationValue } from "../../investigation/observations";
import type { CompletedGuidedTest } from "../../investigation/investigation";

export interface PreparedTest {
  readonly testId: string;
  readonly title: string;
  readonly planDigest: string;
}

export interface TransferProgress {
  readonly completedPackets: number;
  readonly totalPackets: number;
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface ActiveRun {
  readonly runId: string;
  readonly prepared: PreparedTest;
  readonly startedAt: string;
  readonly finalWriteAcceptedAt: string;
}

export interface TimingState {
  readonly phaseIndex: number;
  readonly elapsedMs: number;
  readonly marks: readonly {
    readonly id: string;
    readonly elapsedMs: number;
  }[];
}

export interface AnswerState {
  readonly values: Readonly<Record<string, ObservationValue>>;
}

export interface TestFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type GuidedTestState =
  | { readonly value: "idle" }
  | { readonly value: "about"; readonly prepared: PreparedTest }
  | {
      readonly value: "transferring";
      readonly prepared: PreparedTest;
      readonly progress: TransferProgress;
    }
  | {
      readonly value: "observing-timed";
      readonly run: ActiveRun;
      readonly timing: TimingState;
    }
  | {
      readonly value: "observing-questions";
      readonly run: ActiveRun;
      readonly answers: AnswerState;
    }
  | {
      readonly value: "retry-confirmation";
      readonly resume:
        | Extract<GuidedTestState, { readonly value: "observing-timed" }>
        | Extract<GuidedTestState, { readonly value: "observing-questions" }>;
    }
  | { readonly value: "result"; readonly completed: CompletedGuidedTest }
  | {
      readonly value: "failed";
      readonly prepared: PreparedTest;
      readonly failure: TestFailure;
    };

export type GuidedTestEvent =
  | { readonly type: "PREPARE"; readonly prepared: PreparedTest }
  | { readonly type: "START_TRANSFER"; readonly progress: TransferProgress }
  | { readonly type: "TRANSFER_PROGRESS"; readonly progress: TransferProgress }
  | {
      readonly type: "OBSERVE_TIMED";
      readonly run: ActiveRun;
      readonly timing?: TimingState;
    }
  | { readonly type: "TICK"; readonly elapsedMs: number }
  | { readonly type: "MARK"; readonly id: string; readonly elapsedMs: number }
  | { readonly type: "UNDO_MARK" }
  | { readonly type: "RESET_TIMING" }
  | {
      readonly type: "OBSERVE_QUESTIONS";
      readonly run: ActiveRun;
      readonly answers?: AnswerState;
    }
  | { readonly type: "ANSWER"; readonly answer: ObservationValue }
  | { readonly type: "REQUEST_RETRY" }
  | { readonly type: "CANCEL_RETRY" }
  | { readonly type: "RETRY" }
  | { readonly type: "COMPLETE"; readonly completed: CompletedGuidedTest }
  | { readonly type: "FAIL"; readonly failure: TestFailure }
  | { readonly type: "ABANDON" };

export const INITIAL_GUIDED_TEST_STATE: GuidedTestState = Object.freeze({
  value: "idle",
});

export function transitionGuidedTest(
  state: GuidedTestState,
  event: GuidedTestEvent,
): GuidedTestState {
  switch (event.type) {
    case "PREPARE":
      return state.value === "idle"
        ? { value: "about", prepared: event.prepared }
        : state;
    case "START_TRANSFER":
      return state.value === "about"
        ? {
            value: "transferring",
            prepared: state.prepared,
            progress: event.progress,
          }
        : state;
    case "TRANSFER_PROGRESS":
      return state.value === "transferring"
        ? { ...state, progress: event.progress }
        : state;
    case "OBSERVE_TIMED":
      return state.value === "transferring"
        ? {
            value: "observing-timed",
            run: event.run,
            timing: event.timing ?? { phaseIndex: 0, elapsedMs: 0, marks: [] },
          }
        : state;
    case "TICK":
      return state.value === "observing-timed"
        ? { ...state, timing: { ...state.timing, elapsedMs: event.elapsedMs } }
        : state;
    case "MARK":
      return state.value === "observing-timed"
        ? {
            ...state,
            timing: {
              ...state.timing,
              marks: [
                ...state.timing.marks,
                { id: event.id, elapsedMs: event.elapsedMs },
              ],
              phaseIndex: state.timing.phaseIndex + 1,
            },
          }
        : state;
    case "UNDO_MARK":
      return state.value === "observing-timed" && state.timing.phaseIndex > 0
        ? {
            ...state,
            timing: {
              ...state.timing,
              phaseIndex: state.timing.phaseIndex - 1,
              marks: state.timing.marks.slice(0, -1),
            },
          }
        : state;
    case "RESET_TIMING":
      return state.value === "observing-timed"
        ? { ...state, timing: { phaseIndex: 0, elapsedMs: 0, marks: [] } }
        : state;
    case "OBSERVE_QUESTIONS":
      return state.value === "transferring" || state.value === "observing-timed"
        ? {
            value: "observing-questions",
            run: state.value === "observing-timed" ? state.run : event.run,
            answers: event.answers ?? { values: {} },
          }
        : state;
    case "ANSWER":
      return state.value === "observing-questions"
        ? {
            ...state,
            answers: {
              values: {
                ...state.answers.values,
                [event.answer.fieldId]: event.answer,
              },
            },
          }
        : state;
    case "REQUEST_RETRY":
      return state.value === "observing-timed" ||
        state.value === "observing-questions"
        ? { value: "retry-confirmation", resume: state }
        : state;
    case "CANCEL_RETRY":
      return state.value === "retry-confirmation" ? state.resume : state;
    case "RETRY":
      if (state.value === "retry-confirmation")
        return { value: "about", prepared: state.resume.run.prepared };
      if (state.value === "failed" && state.failure.retryable)
        return { value: "about", prepared: state.prepared };
      return state;
    case "COMPLETE":
      return state.value === "observing-timed" ||
        state.value === "observing-questions"
        ? { value: "result", completed: event.completed }
        : state;
    case "FAIL": {
      const prepared = preparedFromState(state);
      return prepared
        ? { value: "failed", prepared, failure: event.failure }
        : state;
    }
    case "ABANDON":
      return { value: "idle" };
  }
}

function preparedFromState(state: GuidedTestState): PreparedTest | null {
  if (
    state.value === "about" ||
    state.value === "transferring" ||
    state.value === "failed"
  )
    return state.prepared;
  if (
    state.value === "observing-timed" ||
    state.value === "observing-questions"
  )
    return state.run.prepared;
  if (state.value === "retry-confirmation") return state.resume.run.prepared;
  return null;
}
