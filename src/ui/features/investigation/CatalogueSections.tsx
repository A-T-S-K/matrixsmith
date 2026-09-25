import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { StatusBadge } from "../../components/StatusBadge";
import { EvidenceDisclosure } from "../../components/EvidenceDisclosure";
import { UnavailableAction } from "../../components/UnavailableAction";
export function SupportMap({
  snapshot,
}: {
  snapshot: AppSnapshot;
}): JSX.Element {
  if (snapshot.claimGroups.length === 0) return <></>;
  return (
    <section>
      <p class="fineprint">
        What is verified, what failed, and what remains unknown — derived from
        atomic claims, never from broad guesses.
      </p>
      {snapshot.claimGroups.map((group) => (
        <div class="claim-group" key={group.label}>
          <p class="panel-kicker">{group.label.toUpperCase()}</p>
          <div class="support-table">
            {group.claims.map((claim) => (
              <div class={`support-row claim-${claim.status}`} key={claim.id}>
                <span class="claim-glyph" aria-hidden="true">
                  {claim.glyph}
                </span>
                <strong>{claim.label}</strong>
                <StatusBadge
                  tone={
                    claim.status === "verified"
                      ? "good"
                      : claim.status === "rejected"
                        ? "bad"
                        : claim.status === "unresolved"
                          ? "warn"
                          : "neutral"
                  }
                >
                  {claim.status === "source-supported"
                    ? "source only"
                    : claim.status}
                </StatusBadge>
                <span>{claim.scopeLabel ?? ""}</span>
                <EvidenceDisclosure>
                  <p>{claim.evidence}</p>
                </EvidenceDisclosure>
              </div>
            ))}
          </div>
        </div>
      ))}
      {snapshot.rasterStrategyLabel && (
        <p class="fineprint">
          Validated static-image strategy this session:{" "}
          {snapshot.rasterStrategyLabel}.
        </p>
      )}
    </section>
  );
}

export function TestCatalogue({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  if (snapshot.guidedTests.length === 0)
    return (
      <p class="fineprint">No guided tests are available for this profile.</p>
    );
  const order = { core: 0, recommended: 1, advanced: 2, optional: 3 } as Record<
    string,
    number
  >;
  const tests = [...snapshot.guidedTests].sort(
    (a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9),
  );
  return (
    <ul class="test-list">
      {tests.map((test) => (
        <li key={test.id} class={test.available ? "" : "unavailable"}>
          <div class="test-line">
            <div>
              <strong>{test.title}</strong>
              <small>
                {test.category} · {test.estimatedObservationTime}
              </small>
            </div>
            {test.lastStatus && (
              <StatusBadge
                tone={
                  test.lastStatus === "passed"
                    ? "good"
                    : test.lastStatus === "failed"
                      ? "bad"
                      : "warn"
                }
              >
                {test.lastStatus}
              </StatusBadge>
            )}
            <UnavailableAction
              class="secondary small"
              available={test.available && snapshot.busy === null}
              reason={
                snapshot.busy ?? test.reason ?? "This test is unavailable."
              }
              onClick={() => store.startGuidedTest(test.id, "manual-selection")}
            >
              {test.lastStatus ? "Again" : "Start"}
            </UnavailableAction>
          </div>
          {!test.available && test.reason && (
            <p class="fineprint">{test.reason}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CompletedTests({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const investigation = snapshot.investigation;
  if (!investigation || investigation.completedTests.length === 0)
    return <p class="fineprint">No tests completed yet.</p>;
  return (
    <section>
      <p class="fineprint">
        {investigation.goalLabel} ·{" "}
        {investigation.status === "stopped"
          ? "stopped (saved locally)"
          : "active"}
      </p>
      <div class="run-list">
        {[...investigation.completedTests].reverse().map((test) => (
          <details
            key={`${test.testId}-${test.completedAt}`}
            class={`run ${test.status}`}
          >
            <summary>
              <span>{test.title}</span>
              <StatusBadge
                tone={
                  test.status === "passed"
                    ? "good"
                    : test.status === "failed"
                      ? "bad"
                      : "warn"
                }
              >
                {test.status}
              </StatusBadge>
              <small>
                {new Date(test.completedAt).toLocaleTimeString([], {
                  hour12: false,
                })}
              </small>
            </summary>
            <p>{test.summary}</p>
            {test.established.length > 0 && (
              <ol>
                {test.established.map((item) => (
                  <li key={item} class="passed">
                    <span>✓ {item}</span>
                  </li>
                ))}
              </ol>
            )}
            {test.rejected.length > 0 && (
              <ol>
                {test.rejected.map((item) => (
                  <li key={item} class="failed">
                    <span>✕ {item}</span>
                  </li>
                ))}
              </ol>
            )}
            {test.attempts && test.attempts.length > 1 && (
              <p class="fineprint">
                {test.attempts.length} timed attempts;{" "}
                {
                  test.attempts.filter(
                    (attempt) => attempt.validity === "valid",
                  ).length
                }{" "}
                valid.
              </p>
            )}
            <button
              class="text-action"
              onClick={() => void store.copyTestReport(test.testId)}
            >
              Copy report
            </button>
          </details>
        ))}
      </div>
      {investigation.status === "active" && (
        <button
          class="text-action quiet-action"
          onClick={() => store.stopInvestigation()}
        >
          Stop testing for now
        </button>
      )}
    </section>
  );
}

/** Protocol workbench access and read-only diagnostics. */
