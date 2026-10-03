import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { AdvisoryKnowledge } from "../../components/AdvisoryKnowledge";
import { StatusBadge } from "../../components/StatusBadge";
import { UnavailableAction } from "../../components/UnavailableAction";
export function CandidateSection({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  return (
    <section>
      <div class="section-heading">
        <h2>Protocol candidates</h2>
        <p>
          Session evidence and safe actions, with numeric match details kept
          secondary.
        </p>
      </div>
      <AdvisoryKnowledge snapshot={snapshot} store={store} />
      <div class="candidate-grid">
        {snapshot.candidates.map((candidate) => (
          <article key={candidate.id} class="candidate-card">
            <div>
              <h3>{candidate.family}</h3>
              <StatusBadge tone={candidate.evidence.tone}>
                {candidate.evidence.label}
              </StatusBadge>
            </div>
            <p>{candidate.summary}</p>
            {candidate.canIdentify ? (
              <button class="primary" onClick={() => store.setView("diagnose")}>
                Open display setup
              </button>
            ) : candidate.evidence.basis === "candidate" ? (
              <p class="notice">
                No verified read-only discriminator available.
              </p>
            ) : null}
            <details>
              <summary>Match details</summary>
              <p>Score: {candidate.score}</p>
              <ul>
                {candidate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {candidate.contradictions.map((reason) => (
                  <li key={reason}>Contradiction: {reason}</li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
export function ToolSection({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  return (
    <section>
      <div class="section-heading">
        <h2>Family probes & tests</h2>
        <p>Constrained semantic workflows; raw transport is not exposed.</p>
      </div>
      <div class="tool-grid">
        {snapshot.diagnosticTools.map((tool) => (
          <article key={tool.id} class="tool-card">
            <span class={`tool-kind ${tool.kind}`}>{tool.kind}</span>
            <h3>{tool.label}</h3>
            <p>{tool.explanation}</p>
            <UnavailableAction
              class="secondary"
              available={tool.available && snapshot.busy === null}
              reason={
                snapshot.busy ??
                tool.unavailableReason ??
                "This tool is unavailable."
              }
              onClick={() =>
                tool.kind === "identify"
                  ? store.setView("diagnose")
                  : void store.runDiagnostic(tool.id)
              }
            >
              {tool.kind === "identify" ? "Open display setup" : "Run"}
            </UnavailableAction>
          </article>
        ))}
      </div>
    </section>
  );
}
