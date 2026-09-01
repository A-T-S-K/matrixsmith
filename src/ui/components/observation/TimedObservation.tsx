import type { JSX } from "preact";
import type { GuidedFlowState, MatrixStore } from "../../store";
import { FramePreview } from "../FramePreview";
import { formatDuration } from "../../../investigation/observations";
import { approximateSeconds } from "../../../investigation/timing";
import type { TimelinePhase } from "../../../investigation/tests";

/**
 * A physically-timed observation.
 *
 * The design assumption here is that the person is looking at the LED panel,
 * not at the phone — so they will sometimes tap late, tap early, or miss the
 * moment entirely. None of those may ruin the run. Every stage offers a way
 * out: undo while the next event has not happened yet, "I missed it" when it
 * has, and a retry that re-sends the identical experiment so the timeline can
 * start over. A missed measurement is never recorded as the hardware failing.
 *
 * The expected image, the timer, and the event buttons stay together in one
 * viewport: scrolling away from the visual target to find the button is what
 * makes people miss the event in the first place.
 */
export function TimedObservation({ flow, store }: { readonly flow: GuidedFlowState; readonly store: MatrixStore }): JSX.Element {
  const frame = flow.previews[0];
  const phase = flow.currentPhase;
  const priorAttempts = flow.attempts.filter((attempt) => attempt.validity !== "incomplete");
  return <div class="timed-observe">
    <div class="timed-visual">
      {frame && <FramePreview frame={frame} scale={10} label="The image the display should be showing"/>}
      <p class="fineprint">This is what the panel should be showing.</p>
    </div>
    <div class="timed-controls">
      <p class="timer-caption">Since upload completed</p>
      <strong class="big-value" role="timer" aria-live="off">{flow.timerElapsedMs !== null ? formatDuration(flow.timerElapsedMs) : "--:--"}</strong>
      {phase && <>
        <p class="guided-question">{phase.prompt}</p>
        <div class="timed-actions">
          <button type="button" class="primary" onClick={() => store.recordGuidedTimeline("event")}>{phase.eventLabel}</button>
          {phase.failLabel && <button type="button" class="secondary" onClick={() => store.recordGuidedTimeline("fail")}>{phase.failLabel}</button>}
          {phase.stillLabel && <button type="button" class="secondary" onClick={() => store.recordGuidedTimeline("still")}>{stillLabel(phase, flow.phaseElapsedMs)}</button>}
        </div>
        <div class="recovery-actions">
          {flow.canUndoMark && <button type="button" class="quiet small" onClick={() => store.undoLastMark()}>Undo last mark</button>}
          <button type="button" class="quiet small" onClick={() => store.markObservationMissed(flow.timerPhaseIndex === 0 ? "missed-t1" : "missed-t2")}>I missed it — retry</button>
        </div>
        {phase.minStillSeconds !== undefined && flow.phaseElapsedMs !== null && flow.phaseElapsedMs < phase.minStillSeconds * 1000
          && <p class="fineprint">Stopping before {phase.minStillSeconds} seconds records exactly what you saw; stability then stays unverified.</p>}
      </>}
      {!phase && flow.timerStopped && <p class="fineprint">Timeline recorded. T0 was measured automatically; your marks are recorded as human observations.</p>}
      {priorAttempts.length > 0 && <details class="technical-disclosure">
        <summary>Attempts ({priorAttempts.length})</summary>
        <ul class="observation-list">{priorAttempts.map((attempt) => <li>
          <span><strong>Attempt {attempt.attemptNumber}</strong> — {attempt.validity === "valid" ? "valid" : `discarded: ${attempt.invalidationReason ?? attempt.validity}`}
            {attempt.marks.length > 0 && <> · {attempt.marks.map((mark) => `${mark.event} ${approximateSeconds(mark.elapsedMs)}`).join(", ")}</>}</span>
        </li>)}</ul>
      </details>}
    </div>
  </div>;
}

function stillLabel(phase: TimelinePhase, phaseElapsedMs: number | null): string {
  if (phase.minStillSeconds !== undefined && phaseElapsedMs !== null && phaseElapsedMs >= phase.minStillSeconds * 1000) {
    return `Still completely static at ${phase.minStillSeconds} seconds`;
  }
  return phase.stillLabel ?? "Stop watching";
}
