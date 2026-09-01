import type { JSX } from "preact";
import type { GuidedFlowState, MatrixStore } from "../../store";
import { AnswerControls } from "./AnswerControls";

/**
 * A short observation with no spatial or temporal structure — a handful of
 * whole-panel questions. These stay on one screen because staging three
 * questions would add navigation without removing any recall burden.
 */
export function SimpleObservation({ flow, store }: { readonly flow: GuidedFlowState; readonly store: MatrixStore }): JSX.Element {
  return <>
    <ol class="validation-questions">{flow.steps.map((step) => <li>
      <p class="guided-question" id={`prompt-${step.spec.id}`}>{step.spec.prompt}</p>
      <div role="group" aria-labelledby={`prompt-${step.spec.id}`}>
        <AnswerControls spec={step.spec} value={flow.values[step.spec.id]} store={store}/>
      </div>
    </li>)}</ol>
    <div class="step-nav">
      <button type="button" class="primary" disabled={!flow.observationsReady} onClick={() => store.submitGuidedObservations()}>Record observations</button>
    </div>
  </>;
}
