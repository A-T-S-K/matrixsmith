import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
export function GeometrySetup({
  store,
}: {
  store: PresentationStore;
}): JSX.Element {
  const [width, setWidth] = useState(32);
  const [height, setHeight] = useState(16);
  return (
    <section class="next-action" aria-labelledby="geometry-title">
      <p class="panel-kicker">ONE DETAIL NEEDED</p>
      <h2 id="geometry-title">Confirm the display size</h2>
      <p>
        The protocol family is identified, but MatrixSmith will not inherit
        geometry from another product profile.
      </p>
      <div class="inline-form">
        <label class="field">
          <span>Width</span>
          <input
            type="number"
            min="1"
            max="512"
            value={width}
            onInput={(event) => setWidth(Number(event.currentTarget.value))}
          />
        </label>
        <label class="field">
          <span>Height</span>
          <input
            type="number"
            min="1"
            max="512"
            value={height}
            onInput={(event) => setHeight(Number(event.currentTarget.value))}
          />
        </label>
        <button
          class="primary"
          onClick={() => store.confirmProvisionalGeometry(width, height)}
        >
          Use {width}×{height}
        </button>
      </div>
    </section>
  );
}

export function KnownCharacterized({
  store,
}: {
  store: PresentationStore;
}): JSX.Element {
  return (
    <section class="core-complete" aria-labelledby="known-characterized-title">
      <p class="panel-kicker">READY</p>
      <h2 id="known-characterized-title">
        This model is ready for normal use.
      </h2>
      <p>
        Shipped physical evidence already establishes the normal content path.
        Revalidation is optional and records this unit’s observations
        separately.
      </p>
      <div class="next-action-cta">
        <button class="primary" onClick={() => store.setView("control")}>
          Create content
        </button>
        <button class="secondary" onClick={() => store.setView("develop")}>
          View evidence
        </button>
      </div>
    </section>
  );
}

/**
 * Compact, finite progress.
 *
 * The point is reassurance rather than detail: guided work is a short list of
 * milestones with an end, not an open-ended chain. Kept small deliberately —
 * it should answer "how much is left?" at a glance and then get out of the way.
 */
export function CoreProgress({
  snapshot,
}: {
  snapshot: AppSnapshot;
}): JSX.Element {
  const progress = snapshot.coreProgress;
  if (!progress || progress.complete) return <></>;
  return (
    <section class="core-progress" aria-label="Core characterization progress">
      <div class="core-progress-head">
        <strong>{progress.title}</strong>
        {/*
        The denominator is every slot in the plan and never moves. Skipped
        milestones are reported separately rather than deducted, so a branch
        closing reads as "one fewer to do", not as the plan shrinking.
      */}
        <small>
          {progress.resolved} of {progress.total} resolved
          {progress.skipped > 0 && (
            <>
              {" "}
              · {progress.completed} completed, {progress.skipped} skipped
            </>
          )}
        </small>
      </div>
      <div class="core-bar" aria-hidden="true">
        {progress.steps.map((step) => (
          <span key={step.id} class={step.state} />
        ))}
      </div>
      <details class="technical-disclosure">
        <summary>Milestones</summary>
        <ul class="core-steps">
          {progress.steps.map((step) => (
            <li key={step.id} class={step.state}>
              <span class="glyph" aria-hidden="true">
                {step.state === "complete"
                  ? "✓"
                  : step.state === "current"
                    ? "→"
                    : step.state === "skipped"
                      ? "–"
                      : "○"}
              </span>
              <span>
                {step.position}. {step.title}
                {step.state === "skipped" && (
                  <>
                    {" "}
                    — <em>skipped, not needed: {step.skipReason}</em>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * Core work is finished, so the product says so and stops.
 *
 * Optional characterization is real work with real value, but feeding it
 * automatically is what made the process feel infinite. Continuing is a
 * deliberate choice.
 */
export function CoreComplete({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const strategy = snapshot.rasterStrategyLabel;
  return (
    <section class="core-complete" aria-labelledby="core-complete-title">
      <p class="panel-kicker">DONE</p>
      <h2 id="core-complete-title">Core characterization complete</h2>
      <p>
        {strategy ? (
          <>
            This display can show still images via <strong>{strategy}</strong>.
          </>
        ) : (
          <>
            No working way to show a still image was found on this display. The
            investigation report explains what was ruled out and what it would
            take.
          </>
        )}
      </p>
      <div class="next-action-cta">
        <button class="primary" onClick={() => store.stopInvestigation()}>
          Finish
        </button>
        <button
          class="secondary"
          onClick={() => void store.copyInvestigationReport()}
        >
          Copy report
        </button>
      </div>
      {snapshot.nextTest && (
        <p class="fineprint">
          Optional follow-up is available under “All guided tests” —{" "}
          {snapshot.nextTest.title}.
        </p>
      )}
    </section>
  );
}

/**
 * A stopped investigation has an outcome worth taking away, so the report
 * stops being a secondary disclosure and becomes the action on offer. It stays
 * a strip rather than a card: the work is finished, and the next test is still
 * the thing the user is most likely to want.
 */
export function StoppedInvestigation({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const investigation = snapshot.investigation;
  if (
    !investigation ||
    investigation.status !== "stopped" ||
    investigation.completedTests.length === 0
  )
    return <></>;
  return (
    <section class="stopped-banner">
      <div>
        <strong>Investigation saved</strong>
        <small>
          {investigation.completedTests.length} test
          {investigation.completedTests.length === 1 ? "" : "s"} · kept on this
          device
        </small>
      </div>
      <button
        class="secondary small"
        onClick={() => void store.copyInvestigationReport()}
      >
        Copy report
      </button>
    </section>
  );
}

/** The one dominant action, with the reason it is next. */
