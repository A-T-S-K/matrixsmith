import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { StatusBadge } from "../../components/StatusBadge";
import { UnavailableAction } from "../../components/UnavailableAction";
export function NextAction({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const next = snapshot.nextTest;
  // An unanswered measurement on the current milestone outranks the engine's
  // next suggestion. Advancing past a question nobody answered would read as
  // though the short measurement had counted.
  const retry = snapshot.coreProgress?.retryableTestId ?? null;
  if (retry)
    return <MeasureAgain snapshot={snapshot} store={store} testId={retry} />;
  if (next) {
    return (
      <section class="next-action" aria-labelledby="next-action-title">
        <p class="panel-kicker">NEXT</p>
        <h2 id="next-action-title">{next.title}</h2>
        <p>{next.description}</p>
        <details class="why-disclosure">
          <summary>Why this test</summary>
          <p>{next.why}</p>
        </details>
        <div class="next-action-cta">
          <UnavailableAction
            class="primary"
            available={snapshot.busy === null && snapshot.liveConnected}
            reason={
              snapshot.busy ?? "Connect the physical display to run tests."
            }
            onClick={() => store.startGuidedTest(next.testId)}
          >
            Run test
          </UnavailableAction>
          <small>
            {next.estimatedObservationTime}
            {next.risk === "persistent" ? " · replaces stored content" : ""}
          </small>
        </div>
      </section>
    );
  }
  return (
    <section class="next-action" aria-labelledby="next-action-title">
      <p class="panel-kicker">NEXT</p>
      <h2 id="next-action-title">{snapshot.recommended.title}</h2>
      <p>{snapshot.recommended.description}</p>
      <div class="next-action-cta">
        {snapshot.recommended.action === "identify" && (
          <button
            class="primary"
            onClick={() => void store.identify()}
            disabled={snapshot.busy !== null}
          >
            Run safe identification
          </button>
        )}
        {snapshot.recommended.action === "checks" && (
          <button
            class="primary"
            onClick={() => void store.refreshInfo()}
            disabled={snapshot.busy !== null}
          >
            Refresh device info
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * An experiment that ran out of observation time is not a dead end.
 *
 * The milestone is still open and the same measurement, watched for long
 * enough, would settle it — so the offer is to measure again, at the same
 * number, rather than a "nothing further is recommended" that strands the
 * user with the only test that could answer their question retired.
 */
export function MeasureAgain({
  snapshot,
  store,
  testId,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
  testId: string;
}): JSX.Element {
  const progress = snapshot.coreProgress;
  const step =
    progress?.steps.find((entry) => entry.id === progress.currentStepId) ??
    null;
  return (
    <section class="next-action" aria-labelledby="next-action-title">
      <p class="panel-kicker">
        {step && progress
          ? `TEST ${step.position} OF ${progress.total}`
          : "NEXT"}
      </p>
      <h2 id="next-action-title">Not enough observation time</h2>
      <p>
        The last measurement stopped before it had watched for long enough to
        answer this step. Nothing about the display was concluded from it.
      </p>
      <div class="next-action-cta">
        <UnavailableAction
          class="primary"
          available={snapshot.busy === null && snapshot.liveConnected}
          reason={snapshot.busy ?? "Connect the physical display to run tests."}
          onClick={() => store.measureAgain(testId)}
        >
          Measure again
        </UnavailableAction>
        <button class="secondary" onClick={() => store.stopInvestigation()}>
          Stop for now
        </button>
      </div>
    </section>
  );
}

/** A compact state summary — the claim-by-claim map stays a disclosure. */
export function WhatWeKnow({
  snapshot,
}: {
  snapshot: AppSnapshot;
}): JSX.Element {
  if (snapshot.claimGroups.length === 0) return <></>;
  const rows = snapshot.claimGroups.flatMap((group) => group.claims);
  const verified = rows.filter((claim) => claim.status === "verified").length;
  const rejected = rows.filter((claim) => claim.status === "rejected").length;
  const unresolved = rows.filter(
    (claim) => claim.status === "unresolved",
  ).length;
  const open = rows.filter(
    (claim) =>
      claim.status === "unknown" || claim.status === "source-supported",
  ).length;
  return (
    <section class="know-strip" aria-label="What we know so far">
      <ul>
        <li class="known">
          <span aria-hidden="true">✓</span>
          {verified} verified
        </li>
        {rejected > 0 && (
          <li class="ruled-out">
            <span aria-hidden="true">✕</span>
            {rejected} ruled out
          </li>
        )}
        {unresolved > 0 && (
          <li class="conflict">
            <span aria-hidden="true">!</span>
            {unresolved} unresolved
          </li>
        )}
        <li class="open">
          <span aria-hidden="true">?</span>
          {open} open
        </li>
      </ul>
      <p class="fineprint">
        {snapshot.rasterStrategyLabel ? (
          <>
            Static images work via{" "}
            <strong>{snapshot.rasterStrategyLabel}</strong>.
          </>
        ) : (
          <>
            No working way to show a still image yet — that is what these tests
            determine.
          </>
        )}
      </p>
    </section>
  );
}

export function RecentResult({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const latest = snapshot.investigation?.completedTests.at(-1);
  if (!latest) return <></>;
  return (
    <section class="recent-result">
      <div class="recent-head">
        <div>
          <p class="panel-kicker">LAST TEST</p>
          <h3>{latest.title}</h3>
        </div>
        <StatusBadge
          tone={
            latest.status === "passed"
              ? "good"
              : latest.status === "failed"
                ? "bad"
                : "warn"
          }
        >
          {latest.status}
        </StatusBadge>
      </div>
      <p>{latest.summary}</p>
      <div class="utility-row">
        <button
          class="text-action"
          onClick={() => void store.copyTestReport(latest.testId)}
        >
          Copy report
        </button>
        {snapshot.investigation?.status === "active" && (
          <button
            class="text-action quiet-action"
            onClick={() => store.stopInvestigation()}
          >
            Stop testing
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Previous work as a single line by default.
 *
 * The device-binding question is real — MatrixSmith genuinely cannot prove
 * two sessions saw the same physical unit — but it is a footnote, not the
 * headline, and the evidence-system vocabulary that used to state it belongs
 * in the details rather than on the primary screen.
 */
