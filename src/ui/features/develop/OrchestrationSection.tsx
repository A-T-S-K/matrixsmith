import type { JSX } from "preact";
import type { AppSnapshot } from "../../../presentation/store";
export function OrchestrationSection({
  snapshot,
}: {
  snapshot: AppSnapshot;
}): JSX.Element {
  const debug = snapshot.orchestration;
  return (
    <section>
      <div class="section-heading">
        <h2>Guided orchestration</h2>
        <p>
          Experiment, attempt, and transfer identities behind the guided
          workflow.
        </p>
      </div>
      <dl class="state-grid">
        <div>
          <dt>Investigation</dt>
          <dd>{debug.investigationId ?? "none"}</dd>
        </div>
        <div>
          <dt>Core step</dt>
          <dd>{debug.corePlanStepId ?? "none"}</dd>
        </div>
        <div>
          <dt>Cycle guard</dt>
          <dd>{debug.cycling ? "CYCLE DETECTED" : "clear"}</dd>
        </div>
        <div>
          <dt>Unclassified duplicates</dt>
          <dd>{debug.unclassifiedDuplicates}</dd>
        </div>
        {/* The belief the duplicate guard actually consults. "known-active"
          means this exact program is presumed on the panel; anything else
          means a guided diagnostic may legitimately be sent again. */}
        <div>
          <dt>Panel program</dt>
          <dd>
            {debug.panelProgram.certainty} · {debug.panelProgram.kind} ·{" "}
            {debug.panelProgram.label}
          </dd>
        </div>
        <div>
          <dt>Panel fingerprint</dt>
          <dd>
            {debug.panelProgram.fingerprintKey ? (
              <code>{debug.panelProgram.fingerprintKey}</code>
            ) : (
              "none"
            )}
          </dd>
        </div>
      </dl>
      <div class="section-heading">
        <h3>Experiments</h3>
      </div>
      {debug.experiments.length === 0 ? (
        <p class="empty">No guided experiments in this session.</p>
      ) : (
        <div class="run-list">
          {debug.experiments.map((run) => (
            <details key={run.experimentRunId} class="run">
              <summary>
                <span>{run.definitionId}</span>
                <small>
                  {run.status} · {run.resolution ?? "open"} ·{" "}
                  {run.attempts.length} attempt(s)
                </small>
              </summary>
              <dl class="state-grid">
                <div>
                  <dt>Run id</dt>
                  <dd>
                    <code>{run.experimentRunId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Core step</dt>
                  <dd>{run.corePlanStepId ?? "none"}</dd>
                </div>
                <div>
                  <dt>Execution fingerprint</dt>
                  <dd>
                    <code>{run.fingerprintKey}</code>
                  </dd>
                </div>
              </dl>
              <ol>
                {run.attempts.map((attempt) => (
                  <li key={attempt.attemptId}>
                    <strong>Attempt {attempt.attemptNumber}</strong>
                    <span>
                      {attempt.reason} · {attempt.validity}
                      {attempt.failureKind
                        ? ` · ${attempt.failureKind}`
                        : ""} · <code>{attempt.attemptId}</code>
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      )}
      <div class="section-heading">
        <h3>Transfers</h3>
      </div>
      {debug.transfers.length === 0 ? (
        <p class="empty">No guided transfers in this session.</p>
      ) : (
        <ol class="observation-list">
          {debug.transfers.map((transfer) => (
            <li key={transfer.transferId}>
              <span>
                {transfer.reason} · CRC {transfer.programCrc32 ?? "unknown"} ·
                attempt <code>{transfer.attemptId}</code> ·{" "}
                {transfer.transactionIds.length} transaction(s)
                {transfer.failureReason
                  ? ` · FAILED: ${transfer.failureReason}`
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div class="section-heading">
        <h3>Recommendation trail</h3>
      </div>
      {debug.recommendationTrail.length === 0 ? (
        <p class="empty">No recommendations taken yet.</p>
      ) : (
        <ol class="observation-list">
          {debug.recommendationTrail.map((entry) => (
            <li key={`${entry.testId}-${entry.at}`}>
              <span>
                {entry.testId}{" "}
                <small>
                  ({entry.origin ?? "automatic-recommendation"}; evidence at the
                  time: {entry.evidenceCount})
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
