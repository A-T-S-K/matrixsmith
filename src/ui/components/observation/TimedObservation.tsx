import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type {
  GuidedFlowState,
  PresentationStore,
} from "../../../presentation/store";
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
export function TimedObservation({
  flow,
  store,
}: {
  readonly flow: GuidedFlowState;
  readonly store: PresentationStore;
}): JSX.Element {
  const frame = flow.previews[0];
  const phase = flow.currentPhase;
  const [elapsedMs, setElapsedMs] = useState(() => elapsedSince(flow));
  useEffect(() => {
    setElapsedMs(elapsedSince(flow));
    if (!flow.timerStartedAt || flow.timerStopped) return;
    const interval = setInterval(() => setElapsedMs(elapsedSince(flow)), 100);
    return () => clearInterval(interval);
  }, [flow.timerStartedAt, flow.timerStopped]);
  const phaseElapsedMs =
    phase && elapsedMs !== null
      ? Math.max(0, elapsedMs - previousPhaseElapsed(flow))
      : null;
  const priorAttempts = flow.attempts.filter(
    (attempt) => attempt.validity !== "incomplete",
  );
  return (
    <div class="timed-observe">
      <div class="timed-visual">
        {frame && (
          <FramePreview
            frame={frame}
            scale={10}
            label="The image the display should be showing"
          />
        )}
        <p class="fineprint">This is what the panel should be showing.</p>
      </div>
      <div class="timed-controls">
        <p class="timer-caption">Since upload completed</p>
        <strong class="big-value" role="timer" aria-live="off">
          {elapsedMs !== null ? formatDuration(elapsedMs) : "--:--"}
        </strong>
        {phase && (
          <>
            <p class="guided-question">{phase.prompt}</p>
            <div class="timed-actions">
              <button
                type="button"
                class="primary"
                onClick={() => store.recordGuidedTimeline("event")}
              >
                {phase.eventLabel}
              </button>
              {phase.failLabel && (
                <button
                  type="button"
                  class="secondary"
                  onClick={() => store.recordGuidedTimeline("fail")}
                >
                  {phase.failLabel}
                </button>
              )}
              {phase.stillLabel && (
                <button
                  type="button"
                  class="secondary"
                  onClick={() => store.recordGuidedTimeline("still")}
                >
                  {stillLabel(phase, phaseElapsedMs)}
                </button>
              )}
            </div>
            <div class="recovery-actions">
              {flow.canUndoMark && (
                <button
                  type="button"
                  class="quiet small"
                  onClick={() => store.undoLastMark()}
                >
                  Undo last mark
                </button>
              )}
              <button
                type="button"
                class="quiet small"
                onClick={() =>
                  store.markObservationMissed(
                    flow.timerPhaseIndex === 0 ? "missed-t1" : "missed-t2",
                  )
                }
              >
                I missed it — retry
              </button>
            </div>
            {phase.minStillSeconds !== undefined &&
              phaseElapsedMs !== null &&
              phaseElapsedMs < phase.minStillSeconds * 1000 && (
                <p class="fineprint">
                  Stopping before {phase.minStillSeconds} seconds records
                  exactly what you saw; stability then stays unverified.
                </p>
              )}
          </>
        )}
        {!phase && flow.timerStopped && (
          <p class="fineprint">
            Timeline recorded. T0 was measured automatically; your marks are
            recorded as human observations.
          </p>
        )}
        {priorAttempts.length > 0 && (
          <details class="technical-disclosure">
            <summary>Attempts ({priorAttempts.length})</summary>
            <ul class="observation-list">
              {priorAttempts.map((attempt) => (
                <li key={attempt.attemptNumber}>
                  <span>
                    <strong>Attempt {attempt.attemptNumber}</strong> —{" "}
                    {attempt.validity === "valid"
                      ? "valid"
                      : `discarded: ${attempt.invalidationReason ?? attempt.validity}`}
                    {attempt.marks.length > 0 && (
                      <>
                        {" "}
                        ·{" "}
                        {attempt.marks
                          .map(
                            (mark) =>
                              `${mark.event} ${approximateSeconds(mark.elapsedMs)}`,
                          )
                          .join(", ")}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function elapsedSince(flow: GuidedFlowState): number | null {
  if (!flow.timerStartedAt) return flow.timerElapsedMs;
  return Math.max(0, Date.now() - Date.parse(flow.timerStartedAt));
}

function previousPhaseElapsed(flow: GuidedFlowState): number {
  if (!flow.timerSpec || flow.timerPhaseIndex === 0) return 0;
  const previous = flow.timerSpec.phases[flow.timerPhaseIndex - 1];
  const value = previous ? flow.values[previous.fieldId] : undefined;
  return value?.kind === "duration" ? value.milliseconds : 0;
}

function stillLabel(
  phase: TimelinePhase,
  phaseElapsedMs: number | null,
): string {
  if (
    phase.minStillSeconds !== undefined &&
    phaseElapsedMs !== null &&
    phaseElapsedMs >= phase.minStillSeconds * 1000
  ) {
    return `Still completely static at ${phase.minStillSeconds} seconds`;
  }
  return phase.stillLabel ?? "Stop watching";
}
