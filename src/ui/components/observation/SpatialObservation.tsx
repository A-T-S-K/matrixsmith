import type { JSX } from "preact";
import type {
  GuidedFlowState,
  PresentationStore,
} from "../../../presentation/store";
import { RegionMap } from "../RegionMap";
import { AnswerControls } from "./AnswerControls";

/**
 * Observation of a specific place on the physical panel.
 *
 * The hard rule this component exists to enforce: the highlighted zone and
 * the question about it are always in the same viewport. On mobile they
 * stack tightly with the map pinned above the question; on desktop they sit
 * side by side. One question is asked at a time — an eleven-zone test is a
 * sequence, never a long form the user has to correlate with a diagram that
 * has scrolled off the screen.
 */
export function SpatialObservation({
  flow,
  store,
}: {
  readonly flow: GuidedFlowState;
  readonly store: PresentationStore;
}): JSX.Element {
  const step = flow.steps[flow.stepIndex];
  const regions = flow.regions;
  const frame = flow.previews[0];
  const region = step?.regionId
    ? (regions.find((entry) => entry.id === step.regionId) ?? null)
    : null;
  const answered = new Set(
    flow.steps
      .filter((entry) => entry.answered && entry.regionId)
      .map((entry) => entry.regionId!),
  );
  const referenced = new Set(
    flow.steps
      .map((entry) => entry.regionId)
      .filter((id): id is string => id !== null),
  );
  // Show only the zones this question is actually about. A grouped region
  // ("the four sections", "the joins") brings its group and nothing else;
  // an ungrouped set shows all its zones so the numbering stays orienting.
  // With no active region there is nothing to annotate, so the pattern is
  // shown plain rather than covered in labels the question does not use.
  const visibleRegions = region
    ? region.groupId
      ? regions.filter((entry) => entry.groupId === region.groupId)
      : regions.filter((entry) => referenced.has(entry.id) && !entry.groupId)
    : [];
  const spatialSteps = flow.steps.filter((entry) => entry.regionId);
  const positionInSpatial = step?.regionId
    ? spatialSteps.findIndex((entry) => entry.spec.id === step.spec.id) + 1
    : 0;
  const isLast = flow.stepIndex >= flow.steps.length - 1;
  if (!step) return <></>;
  return (
    <div class="spatial-observe">
      {frame && (
        <div class="spatial-visual">
          <RegionMap
            frame={frame}
            regions={visibleRegions}
            activeRegionId={region?.id ?? null}
            answeredRegionIds={answered}
            onSelect={
              visibleRegions.length > 1
                ? (regionId) => store.focusRegion(regionId)
                : undefined
            }
            label={
              region
                ? `Diagnostic pattern, ${region.displayLabel} highlighted`
                : "Diagnostic pattern"
            }
          />
        </div>
      )}
      <div class="spatial-question">
        {positionInSpatial > 0 && (
          <p class="step-counter">
            Step {positionInSpatial} of {spatialSteps.length}
          </p>
        )}
        {region && (
          <>
            <h3 id={`region-${region.id}`}>{region.displayLabel}</h3>
            <p class="region-purpose">{region.description}</p>
          </>
        )}
        <p class="guided-question" id={`prompt-${step.spec.id}`}>
          {step.spec.prompt}
        </p>
        <div
          role="group"
          aria-labelledby={
            region
              ? `region-${region.id} prompt-${step.spec.id}`
              : `prompt-${step.spec.id}`
          }
        >
          <AnswerControls
            spec={step.spec}
            value={flow.values[step.spec.id]}
            store={store}
            autoAdvance={isLast ? undefined : () => store.nextGuidedStep()}
          />
        </div>
        {region && (region.rawWordHex || region.technicalNotes.length > 0) && (
          <details class="technical-disclosure">
            <summary>Technical details</summary>
            <ul class="observation-list">
              {region.rawWordHex && (
                <li>
                  <span>
                    Raw pixel value: <code>{region.rawWordHex}</code>
                  </span>
                </li>
              )}
              {region.expected && (
                <li>
                  <span>Current hypothesis predicts: {region.expected}</span>
                </li>
              )}
              {region.technicalNotes.map((note) => (
                <li key={note}>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div class="step-nav">
          <button
            type="button"
            class="secondary"
            disabled={flow.stepIndex === 0}
            onClick={() => store.previousGuidedStep()}
          >
            Previous
          </button>
          {isLast ? (
            <button
              type="button"
              class="primary"
              disabled={!flow.observationsReady}
              onClick={() => store.submitGuidedObservations()}
            >
              Record observations
            </button>
          ) : (
            <button
              type="button"
              class="primary"
              onClick={() => store.nextGuidedStep()}
            >
              Continue
            </button>
          )}
        </div>
        <ol class="step-progress" aria-label="Question progress">
          {flow.steps.map((entry, index) => (
            <li
              key={entry.spec.id}
              class={
                index === flow.stepIndex
                  ? "active"
                  : entry.answered
                    ? "done"
                    : ""
              }
              aria-current={index === flow.stepIndex ? "step" : undefined}
            >
              <span class="visually-hidden">
                {entry.spec.prompt}
                {entry.answered ? " — answered" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
