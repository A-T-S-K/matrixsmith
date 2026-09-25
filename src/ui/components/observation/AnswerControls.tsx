import type { JSX } from "preact";
import type { PresentationStore } from "../../../presentation/store";
import { formatDuration } from "../../../investigation/observations";
import type {
  ObservationFieldSpec,
  ObservationValue,
} from "../../../investigation/observations";

/**
 * The answer widget for one observation field. Deliberately small: these are
 * physical observations, so the choices are large tap targets rather than
 * form inputs, and "Unsure" is always a legitimate answer — a guess recorded
 * as certainty is worse evidence than an admitted uncertainty.
 */
export function AnswerControls({
  spec,
  value,
  store,
  autoAdvance,
}: {
  readonly spec: ObservationFieldSpec;
  readonly value: ObservationValue | undefined;
  readonly store: PresentationStore;
  /** Move to the next staged question once a definitive answer is given. */
  readonly autoAdvance?: () => void;
}): JSX.Element {
  if (spec.kind === "boolean") {
    const current = value?.kind === "boolean" ? value.value : null;
    return (
      <div class="answer-buttons">
        {(["yes", "no", "unsure"] as const).map((option) => (
          <button
            key={option}
            type="button"
            class={current === option ? `active ${option}` : ""}
            aria-pressed={current === option}
            onClick={() => {
              store.setGuidedObservation({
                kind: "boolean",
                fieldId: spec.id,
                value: option,
              });
              autoAdvance?.();
            }}
          >
            {option === "yes" ? "Yes" : option === "no" ? "No" : "Unsure"}
          </button>
        ))}
      </div>
    );
  }
  if (spec.kind === "choice") {
    const current = value?.kind === "choice" ? value.optionId : null;
    const otherText = value?.kind === "choice" ? (value.otherText ?? "") : "";
    return (
      <>
        <div class="answer-buttons choice-buttons">
          {spec.options.map((option) => (
            <button
              key={option}
              type="button"
              class={current === option.id ? "active" : ""}
              aria-pressed={current === option.id}
              onClick={() => {
                store.setGuidedObservation({
                  kind: "choice",
                  fieldId: spec.id,
                  optionId: option.id,
                });
                autoAdvance?.();
              }}
            >
              {option.label}
            </button>
          ))}
          {spec.allowOther && (
            <button
              type="button"
              class={current === "other" ? "active" : ""}
              aria-pressed={current === "other"}
              onClick={() =>
                store.setGuidedObservation({
                  kind: "choice",
                  fieldId: spec.id,
                  optionId: "other",
                })
              }
            >
              Something else…
            </button>
          )}
        </div>
        {current === "other" && (
          <input
            class="other-input"
            placeholder="Describe what you see"
            aria-label="Describe what you see"
            value={otherText}
            onInput={(event) =>
              store.setGuidedObservation({
                kind: "choice",
                fieldId: spec.id,
                optionId: "other",
                otherText: (event.currentTarget as HTMLInputElement).value,
              })
            }
          />
        )}
      </>
    );
  }
  if (spec.kind === "duration") {
    return (
      <p class="fineprint">
        {value?.kind === "duration"
          ? `${formatDuration(value.milliseconds)} (${value.measuredBy === "matrixsmith-timer" ? "from your mark, timed by MatrixSmith" : "estimate"})`
          : "Recorded from the timed observation — nothing to enter here."}
      </p>
    );
  }
  if (spec.kind === "number") {
    const current = value?.kind === "number" ? String(value.value) : "";
    return (
      <p>
        <input
          type="number"
          value={current}
          aria-label={spec.prompt}
          onInput={(event) => {
            const parsed = Number(
              (event.currentTarget as HTMLInputElement).value,
            );
            if (Number.isFinite(parsed))
              store.setGuidedObservation({
                kind: "number",
                fieldId: spec.id,
                value: parsed,
              });
          }}
        />
        {spec.unit && <small> {spec.unit}</small>}
      </p>
    );
  }
  const text = value?.kind === "note" ? value.text : "";
  return (
    <textarea
      rows={2}
      value={text}
      aria-label={spec.prompt}
      placeholder="Optional"
      onInput={(event) =>
        store.setGuidedObservation({
          kind: "note",
          fieldId: spec.id,
          text: (event.currentTarget as HTMLTextAreaElement).value,
        })
      }
    />
  );
}
