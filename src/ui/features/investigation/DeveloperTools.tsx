import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { StatusBadge } from "../../components/StatusBadge";
import { UnavailableAction } from "../../components/UnavailableAction";
export function DeveloperTools({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  return (
    <section>
      <p class="fineprint">
        Deep packet/GATT tooling. Nothing here is required for the guided
        workflow.
      </p>
      <button class="secondary" onClick={() => store.setView("develop")}>
        Open protocol workbench
      </button>
      <ul class="test-list">
        {snapshot.diagnosticTools.map((tool) => (
          <li key={tool.id}>
            <div class="test-line">
              <div>
                <strong>{tool.label}</strong>
                <small>
                  {tool.kind} · {tool.validation}
                </small>
              </div>
              <UnavailableAction
                class="secondary small"
                available={tool.available && snapshot.busy === null}
                reason={
                  snapshot.busy ??
                  tool.unavailableReason ??
                  "This tool is unavailable."
                }
                onClick={() => void store.runDiagnostic(tool.id)}
              >
                Run
              </UnavailableAction>
            </div>
            <p class="fineprint">{tool.purpose}</p>
          </li>
        ))}
      </ul>
      {snapshot.diagnosticRuns.length > 0 && (
        <div class="run-list">
          {[...snapshot.diagnosticRuns].reverse().map((run) => (
            <details
              key={run.id}
              class={`run ${run.status}`}
              open={run.status === "restore-failed"}
            >
              <summary>
                <span>{run.purpose}</span>
                <StatusBadge tone={run.status === "passed" ? "good" : "bad"}>
                  {run.status}
                </StatusBadge>
              </summary>
              {run.status === "restore-failed" && (
                <p class="restore-failure">
                  RESTORE FAILED — check the physical display before continuing.
                </p>
              )}
              <ol>
                {run.steps.map((step) => (
                  <li key={step.id} class={step.status}>
                    <strong>{step.label}</strong>
                    <span>{step.summary}</span>
                  </li>
                ))}
              </ol>
              {run.error && <p class="notice error">{run.error}</p>}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
