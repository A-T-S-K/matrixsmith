import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, MatrixStore } from "../store";
import { StatusBadge } from "../components/StatusBadge";

/**
 * The guided investigation home.
 *
 * The screen answers one question first: WHAT SHOULD I DO NEXT? Everything
 * that used to compete with that answer — the product's description of
 * itself, three separate report buttons, a full-height history card, the
 * complete claim map, the whole test catalogue — is either gone or demoted
 * behind a disclosure. Reports follow context rather than sitting above the
 * primary action: there is nothing to report on before the first test runs.
 */
export function InvestigationView({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  const started = Boolean(snapshot.investigation?.completedTests.length);
  return <section class="view investigate">
    <h1 class="view-title">Investigate</h1>
    {snapshot.investigation && started && <p class="goal-line">{snapshot.investigation.goalLabel}</p>}

    <StoppedInvestigation snapshot={snapshot} store={store}/>
    {snapshot.cycleWarning && <p class="cycle-warning" role="status">
      MatrixSmith detected a recommendation loop and stopped advancing automatically. {snapshot.cycleWarning}
    </p>}
    {snapshot.coreProgress?.complete
      ? <CoreComplete snapshot={snapshot} store={store}/>
      : <NextAction snapshot={snapshot} store={store}/>}
    <CoreProgress snapshot={snapshot}/>
    <WhatWeKnow snapshot={snapshot}/>
    <RecentResult snapshot={snapshot} store={store}/>
    <PreviousInvestigation snapshot={snapshot} store={store}/>
    <TroubleshootEntry snapshot={snapshot} store={store}/>

    <details class="secondary-section"><summary>All guided tests{snapshot.guidedTests.length ? ` (${snapshot.guidedTests.length})` : ""}</summary><TestCatalogue snapshot={snapshot} store={store}/></details>
    <details class="secondary-section"><summary>Previous tests{snapshot.investigation?.completedTests.length ? ` (${snapshot.investigation.completedTests.length})` : ""}</summary><CompletedTests snapshot={snapshot} store={store}/></details>
    <details class="secondary-section"><summary>Technical support map</summary><SupportMap snapshot={snapshot}/></details>
    <details class="secondary-section"><summary>Reports</summary><ReportActions store={store}/></details>
    <details class="secondary-section"><summary>Developer tools</summary><DeveloperTools snapshot={snapshot} store={store}/></details>
  </section>;
}

/**
 * Compact, finite progress.
 *
 * The point is reassurance rather than detail: guided work is a short list of
 * milestones with an end, not an open-ended chain. Kept small deliberately —
 * it should answer "how much is left?" at a glance and then get out of the way.
 */
function CoreProgress({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  const progress = snapshot.coreProgress;
  if (!progress || progress.complete) return <></>;
  return <section class="core-progress" aria-label="Core characterization progress">
    <div class="core-progress-head">
      <strong>{progress.title}</strong>
      {/*
        The denominator is every slot in the plan and never moves. Skipped
        milestones are reported separately rather than deducted, so a branch
        closing reads as "one fewer to do", not as the plan shrinking.
      */}
      <small>
        {progress.resolved} of {progress.total} resolved
        {progress.skipped > 0 && <> · {progress.completed} completed, {progress.skipped} skipped</>}
      </small>
    </div>
    <div class="core-bar" aria-hidden="true">
      {progress.steps.map((step) => <span class={step.state}/>)}
    </div>
    <details class="technical-disclosure">
      <summary>Milestones</summary>
      <ul class="core-steps">
        {progress.steps.map((step) => <li class={step.state}>
          <span class="glyph" aria-hidden="true">{step.state === "complete" ? "✓" : step.state === "current" ? "→" : step.state === "skipped" ? "–" : "○"}</span>
          <span>
            {step.position}. {step.title}
            {step.state === "skipped" && <> — <em>skipped, not needed: {step.skipReason}</em></>}
          </span>
        </li>)}
      </ul>
    </details>
  </section>;
}

/**
 * Core work is finished, so the product says so and stops.
 *
 * Optional characterization is real work with real value, but feeding it
 * automatically is what made the process feel infinite. Continuing is a
 * deliberate choice.
 */
function CoreComplete({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const strategy = snapshot.rasterStrategyLabel;
  return <section class="core-complete" aria-labelledby="core-complete-title">
    <p class="panel-kicker">DONE</p>
    <h2 id="core-complete-title">Core characterization complete</h2>
    <p>{strategy
      ? <>This display can show still images via <strong>{strategy}</strong>.</>
      : <>No working way to show a still image was found on this display. The investigation report explains what was ruled out and what it would take.</>}</p>
    <div class="next-action-cta">
      <button class="primary" onClick={() => store.stopInvestigation()}>Finish</button>
      <button class="secondary" onClick={() => void store.copyInvestigationReport()}>Copy report</button>
    </div>
    {snapshot.nextTest && <p class="fineprint">Optional follow-up is available under “All guided tests” — {snapshot.nextTest.title}.</p>}
  </section>;
}

/**
 * A stopped investigation has an outcome worth taking away, so the report
 * stops being a secondary disclosure and becomes the action on offer. It stays
 * a strip rather than a card: the work is finished, and the next test is still
 * the thing the user is most likely to want.
 */
function StoppedInvestigation({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const investigation = snapshot.investigation;
  if (!investigation || investigation.status !== "stopped" || investigation.completedTests.length === 0) return <></>;
  return <section class="stopped-banner">
    <div>
      <strong>Investigation saved</strong>
      <small>{investigation.completedTests.length} test{investigation.completedTests.length === 1 ? "" : "s"} · kept on this device</small>
    </div>
    <button class="secondary small" onClick={() => void store.copyInvestigationReport()}>Copy report</button>
  </section>;
}

/** The one dominant action, with the reason it is next. */
function NextAction({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const next = snapshot.nextTest;
  // An unanswered measurement on the current milestone outranks the engine's
  // next suggestion. Advancing past a question nobody answered would read as
  // though the short measurement had counted.
  const retry = snapshot.coreProgress?.retryableTestId ?? null;
  if (retry) return <MeasureAgain snapshot={snapshot} store={store} testId={retry}/>;
  if (next) {
    return <section class="next-action" aria-labelledby="next-action-title">
      <p class="panel-kicker">NEXT</p>
      <h2 id="next-action-title">{next.title}</h2>
      <p>{next.description}</p>
      <details class="why-disclosure"><summary>Why this test</summary><p>{next.why}</p></details>
      <div class="next-action-cta">
        <button
          class="primary"
          disabled={snapshot.busy !== null || !snapshot.liveConnected}
          title={snapshot.liveConnected ? "" : "Connect the physical display to run tests."}
          onClick={() => store.startGuidedTest(next.testId)}
        >Run test</button>
        <small>{next.estimatedObservationTime}{next.risk === "persistent" ? " · replaces stored content" : ""}</small>
      </div>
    </section>;
  }
  return <section class="next-action" aria-labelledby="next-action-title">
    <p class="panel-kicker">NEXT</p>
    <h2 id="next-action-title">{snapshot.recommended.title}</h2>
    <p>{snapshot.recommended.description}</p>
    <div class="next-action-cta">
      {snapshot.recommended.action === "identify" && <button class="primary" onClick={() => void store.identify()} disabled={snapshot.busy !== null}>Run safe identification</button>}
      {snapshot.recommended.action === "checks" && <button class="primary" onClick={() => void store.refreshInfo()} disabled={snapshot.busy !== null}>Refresh device info</button>}
    </div>
  </section>;
}

/**
 * An experiment that ran out of observation time is not a dead end.
 *
 * The milestone is still open and the same measurement, watched for long
 * enough, would settle it — so the offer is to measure again, at the same
 * number, rather than a "nothing further is recommended" that strands the
 * user with the only test that could answer their question retired.
 */
function MeasureAgain({ snapshot, store, testId }: { snapshot: AppSnapshot; store: MatrixStore; testId: string }): JSX.Element {
  const progress = snapshot.coreProgress;
  const step = progress?.steps.find((entry) => entry.id === progress.currentStepId) ?? null;
  return <section class="next-action" aria-labelledby="next-action-title">
    <p class="panel-kicker">{step && progress ? `TEST ${step.position} OF ${progress.total}` : "NEXT"}</p>
    <h2 id="next-action-title">Not enough observation time</h2>
    <p>The last measurement stopped before it had watched for long enough to answer this step. Nothing about the display was concluded from it.</p>
    <div class="next-action-cta">
      <button
        class="primary"
        disabled={snapshot.busy !== null || !snapshot.liveConnected}
        title={snapshot.liveConnected ? "" : "Connect the physical display to run tests."}
        onClick={() => store.measureAgain(testId)}
      >Measure again</button>
      <button class="secondary" onClick={() => store.stopInvestigation()}>Stop for now</button>
    </div>
  </section>;
}

/** A compact state summary — the claim-by-claim map stays a disclosure. */
function WhatWeKnow({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  if (snapshot.claimGroups.length === 0) return <></>;
  const rows = snapshot.claimGroups.flatMap((group) => group.claims);
  const verified = rows.filter((claim) => claim.status === "verified").length;
  const rejected = rows.filter((claim) => claim.status === "rejected").length;
  const unresolved = rows.filter((claim) => claim.status === "unresolved").length;
  const open = rows.filter((claim) => claim.status === "unknown" || claim.status === "source-supported").length;
  return <section class="know-strip" aria-label="What we know so far">
    <ul>
      <li class="known"><span aria-hidden="true">✓</span>{verified} verified</li>
      {rejected > 0 && <li class="ruled-out"><span aria-hidden="true">✕</span>{rejected} ruled out</li>}
      {unresolved > 0 && <li class="conflict"><span aria-hidden="true">!</span>{unresolved} unresolved</li>}
      <li class="open"><span aria-hidden="true">?</span>{open} open</li>
    </ul>
    <p class="fineprint">{snapshot.rasterStrategyLabel
      ? <>Static images work via <strong>{snapshot.rasterStrategyLabel}</strong>.</>
      : <>No working way to show a still image yet — that is what these tests determine.</>}</p>
  </section>;
}

function RecentResult({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const latest = snapshot.investigation?.completedTests.at(-1);
  if (!latest) return <></>;
  return <section class="recent-result">
    <div class="recent-head">
      <div>
        <p class="panel-kicker">LAST TEST</p>
        <h3>{latest.title}</h3>
      </div>
      <StatusBadge tone={latest.status === "passed" ? "good" : latest.status === "failed" ? "bad" : "warn"}>{latest.status}</StatusBadge>
    </div>
    <p>{latest.summary}</p>
    <div class="utility-row">
      <button class="text-action" onClick={() => void store.copyTestReport(latest.testId)}>Copy report</button>
      {snapshot.investigation?.status === "active" && <button class="text-action quiet-action" onClick={() => store.stopInvestigation()}>Stop testing</button>}
    </div>
  </section>;
}

/**
 * Previous work as a single line by default.
 *
 * The device-binding question is real — MatrixSmith genuinely cannot prove
 * two sessions saw the same physical unit — but it is a footnote, not the
 * headline, and the evidence-system vocabulary that used to state it belongs
 * in the details rather than on the primary screen.
 */
function PreviousInvestigation({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const stored = snapshot.storedInvestigation;
  if (!stored || snapshot.investigation?.completedTests.length) return <></>;
  const savedAt = new Date(stored.savedAt);
  return <section class="previous-investigation">
    <div class="previous-line">
      <div>
        <strong>Previous investigation</strong>
        <small>{stored.testCount} test{stored.testCount === 1 ? "" : "s"} · saved {savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
      </div>
      <button class="secondary small" onClick={() => store.resumeStoredInvestigation()}>Resume</button>
    </div>
    <details class="technical-disclosure">
      <summary>Details</summary>
      <p class="fineprint">{stored.deviceName ?? "Stored display"} · saved {savedAt.toLocaleString()}.</p>
      <p class="fineprint">{stored.sameAuthorizedDevice
        ? "This is the same display you authorized before, so its guided work continues where it left off."
        : stored.matchesProfile
          ? "This looks like the same kind of display. MatrixSmith cannot prove it is the same physical unit, so earlier results are rechecked when they matter."
          : "Device match not confirmed — this may be a different display. Earlier results are kept for reference and rechecked before they are relied on."}</p>
      {!stored.sameAuthorizedDevice && stored.experimentCount > 0 && <p class="fineprint">
        Its {stored.experimentCount} recorded experiment{stored.experimentCount === 1 ? "" : "s"} stay{stored.experimentCount === 1 ? "s" : ""} with that session. Testing here starts a fresh record, because one display's results must not be attributed to another.
      </p>}
      <button class="text-action quiet-action" onClick={() => store.forgetLocalHistory()}>Forget this history</button>
    </details>
  </section>;
}

function TroubleshootEntry({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button class="text-action troubleshoot-link" onClick={() => setOpen(true)}>Troubleshoot another problem</button>;
  }
  return <section class="troubleshoot-open">
    <p class="fineprint">What are you seeing? MatrixSmith turns the symptom into an investigation with the right first test.</p>
    <div class="symptom-grid">{snapshot.symptoms.map((symptom) => <button class="symptom-card" onClick={() => { setOpen(false); store.startTroubleshoot(symptom.id); }}>{symptom.label}</button>)}</div>
    <button class="text-action quiet-action" onClick={() => setOpen(false)}>Cancel</button>
  </section>;
}

function ReportActions({ store }: { store: MatrixStore }): JSX.Element {
  return <section>
    <p class="fineprint">Reports describe everything established so far, with the exact evidence behind each claim.</p>
    <div class="utility-row">
      <button class="secondary" onClick={() => void store.copyInvestigationReport()}>Copy investigation report</button>
      <button class="text-action" onClick={() => store.openReport()}>Other formats…</button>
    </div>
  </section>;
}

function SupportMap({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  if (snapshot.claimGroups.length === 0) return <></>;
  return <section>
    <p class="fineprint">What is verified, what failed, and what remains unknown — derived from atomic claims, never from broad guesses.</p>
    {snapshot.claimGroups.map((group) => <div class="claim-group">
      <p class="panel-kicker">{group.label.toUpperCase()}</p>
      <div class="support-table">{group.claims.map((claim) => <div class={`support-row claim-${claim.status}`} title={claim.evidence}>
        <span class="claim-glyph" aria-hidden="true">{claim.glyph}</span>
        <strong>{claim.label}</strong>
        <StatusBadge tone={claim.status === "verified" ? "good" : claim.status === "rejected" ? "bad" : claim.status === "unresolved" ? "warn" : "neutral"}>{claim.status === "source-supported" ? "source only" : claim.status}</StatusBadge>
        <span>{claim.scopeLabel ?? ""}</span>
      </div>)}</div>
    </div>)}
    {snapshot.rasterStrategyLabel && <p class="fineprint">Validated static-image strategy this session: {snapshot.rasterStrategyLabel}.</p>}
  </section>;
}

function TestCatalogue({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  if (snapshot.guidedTests.length === 0) return <p class="fineprint">No guided tests are available for this profile.</p>;
  const order = { core: 0, recommended: 1, advanced: 2, optional: 3 } as Record<string, number>;
  const tests = [...snapshot.guidedTests].sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9));
  return <ul class="test-list">{tests.map((test) => <li class={test.available ? "" : "unavailable"}>
    <div class="test-line">
      <div>
        <strong>{test.title}</strong>
        <small>{test.category} · {test.estimatedObservationTime}</small>
      </div>
      {test.lastStatus && <StatusBadge tone={test.lastStatus === "passed" ? "good" : test.lastStatus === "failed" ? "bad" : "warn"}>{test.lastStatus}</StatusBadge>}
      <button class="secondary small" disabled={!test.available || snapshot.busy !== null} title={test.reason ?? ""} onClick={() => store.startGuidedTest(test.id)}>{test.lastStatus ? "Again" : "Start"}</button>
    </div>
    {!test.available && test.reason && <p class="fineprint">{test.reason}</p>}
  </li>)}</ul>;
}

function CompletedTests({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const investigation = snapshot.investigation;
  if (!investigation || investigation.completedTests.length === 0) return <p class="fineprint">No tests completed yet.</p>;
  return <section>
    <p class="fineprint">{investigation.goalLabel} · {investigation.status === "stopped" ? "stopped (saved locally)" : "active"}</p>
    <div class="run-list">{[...investigation.completedTests].reverse().map((test) => <details class={`run ${test.status}`}>
      <summary><span>{test.title}</span><StatusBadge tone={test.status === "passed" ? "good" : test.status === "failed" ? "bad" : "warn"}>{test.status}</StatusBadge><small>{new Date(test.completedAt).toLocaleTimeString([], { hour12: false })}</small></summary>
      <p>{test.summary}</p>
      {test.established.length > 0 && <ol>{test.established.map((item) => <li class="passed"><span>✓ {item}</span></li>)}</ol>}
      {test.rejected.length > 0 && <ol>{test.rejected.map((item) => <li class="failed"><span>✕ {item}</span></li>)}</ol>}
      {test.attempts && test.attempts.length > 1 && <p class="fineprint">{test.attempts.length} timed attempts; {test.attempts.filter((attempt) => attempt.validity === "valid").length} valid.</p>}
      <button class="text-action" onClick={() => void store.copyTestReport(test.testId)}>Copy report</button>
    </details>)}</div>
    {investigation.status === "active" && <button class="text-action quiet-action" onClick={() => store.stopInvestigation()}>Stop testing for now</button>}
  </section>;
}

/** Protocol workbench access, read-only diagnostics, and legacy validations. */
function DeveloperTools({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  return <section>
    <p class="fineprint">Deep packet/GATT tooling and legacy checks. Nothing here is required for the guided workflow.</p>
    <button class="secondary" onClick={() => store.setView("develop")}>Open protocol workbench</button>
    <ul class="test-list">
      {snapshot.diagnosticTools.map((tool) => <li><div class="test-line">
        <div><strong>{tool.label}</strong><small>{tool.kind} · {tool.validation}</small></div>
        <button class="secondary small" disabled={!tool.available || snapshot.busy !== null} title={tool.unavailableReason} onClick={() => void store.runDiagnostic(tool.id)}>Run</button>
      </div><p class="fineprint">{tool.purpose}</p></li>)}
      {snapshot.validationWorkflows.map((workflow) => <li><div class="test-line">
        <div><strong>{workflow.label}</strong><small>legacy · {workflow.persistence}</small></div>
        <button class="secondary small" disabled={!workflow.available || snapshot.busy !== null} title={workflow.unavailableReason ?? ""} onClick={() => store.startValidation(workflow.id)}>Start</button>
      </div><p class="fineprint">Superseded by the guided tests; kept for completeness. {workflow.consequence}</p></li>)}
    </ul>
    {snapshot.diagnosticRuns.length > 0 && <div class="run-list">{[...snapshot.diagnosticRuns].reverse().map((run) => <details class={`run ${run.status}`} open={run.status === "restore-failed"}>
      <summary><span>{run.purpose}</span><StatusBadge tone={run.status === "passed" ? "good" : "bad"}>{run.status}</StatusBadge></summary>
      {run.status === "restore-failed" && <p class="restore-failure">RESTORE FAILED — check the physical display before continuing.</p>}
      <ol>{run.steps.map((step) => <li class={step.status}><strong>{step.label}</strong><span>{step.summary}</span></li>)}</ol>
      {run.error && <p class="notice error">{run.error}</p>}
    </details>)}</div>}
  </section>;
}
