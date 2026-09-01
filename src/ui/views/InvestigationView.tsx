import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, MatrixStore } from "../store";
import { StatusBadge } from "../components/StatusBadge";

/**
 * The guided investigation workspace with strong progressive disclosure.
 * The default surface answers, in order: what we are trying to determine
 * (current goal), what is already known (compact summary), what to do next
 * (ONE dominant recommendation), what happened last time (recent result),
 * and how to copy the report. The full test catalogue, the technical
 * support/claim map, previous tests, legacy validations, and the protocol
 * workbench are secondary expandable areas — present, never dominant.
 */
export function InvestigationView({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  return <section class="view">
    <div class="view-heading"><div><p class="eyebrow">GUIDED INVESTIGATION</p><h1>Investigate</h1>
      <p>{snapshot.investigation ? snapshot.investigation.goalLabel : "MatrixSmith picks the highest-information safe test, runs it, and asks you only what the panel physically shows."}</p></div>
      <div class="inline-form">
        <button class="secondary" onClick={() => void store.copyInvestigationReport()}>Copy investigation report</button>
        <button class="quiet" onClick={() => store.openReport()}>More report formats…</button>
      </div>
    </div>

    {snapshot.storedInvestigation && !snapshot.investigation?.completedTests.length && <article class="panel resume-panel">
      <div class="panel-title"><div><span class="panel-kicker">PREVIOUS INVESTIGATION</span><h2>{snapshot.storedInvestigation.deviceName ?? "Stored display"} · {snapshot.storedInvestigation.testCount} test(s)</h2></div><StatusBadge tone="neutral">{snapshot.storedInvestigation.matchesProfile ? "Matches this display" : "Different/unknown display"}</StatusBadge></div>
      <p class="fineprint">Saved {new Date(snapshot.storedInvestigation.savedAt).toLocaleString()}. Historical evidence is labeled as a previous local session; it informs recommendations but never bypasses current-session safety.</p>
      <div class="inline-form">
        <button class="secondary" onClick={() => store.resumeStoredInvestigation()}>Resume investigation</button>
        <button class="quiet" onClick={() => store.forgetLocalHistory()}>Forget local history</button>
      </div>
    </article>}

    <WhatWeKnow snapshot={snapshot}/>

    {snapshot.nextTest ? <article class="recommended">
      <span class="recommended-icon">→</span>
      <div>
        <p class="panel-kicker">RECOMMENDED NEXT TEST</p>
        <h2>{snapshot.nextTest.title}</h2>
        <p>{snapshot.nextTest.description}</p>
        <p><strong>Why:</strong> {snapshot.nextTest.why}</p>
        <p class="fineprint">~{snapshot.nextTest.estimatedObservationTime} · {snapshot.nextTest.risk === "persistent" ? "replaces stored display content" : snapshot.nextTest.risk}</p>
      </div>
      <button class="primary" disabled={snapshot.busy !== null || !snapshot.liveConnected} title={snapshot.liveConnected ? "" : "Connect the physical display to run tests."} onClick={() => store.startGuidedTest(snapshot.nextTest!.testId)}>Run next test</button>
    </article> : <article class="recommended"><span class="recommended-icon">→</span><div><p class="panel-kicker">RECOMMENDED NEXT ACTION</p><h2>{snapshot.recommended.title}</h2><p>{snapshot.recommended.description}</p></div>
      {snapshot.recommended.action === "identify" && <button class="primary" onClick={() => void store.identify()} disabled={snapshot.busy !== null}>Run safe identification</button>}
      {snapshot.recommended.action === "checks" && <button class="primary" onClick={() => void store.refreshInfo()} disabled={snapshot.busy !== null}>Refresh device info</button>}
    </article>}

    <RecentResult snapshot={snapshot} store={store}/>
    <TroubleshootEntry snapshot={snapshot} store={store}/>

    <details class="secondary-section"><summary>All guided tests</summary><TestCatalogue snapshot={snapshot} store={store}/></details>
    <details class="secondary-section"><summary>Technical support map</summary><SupportMap snapshot={snapshot}/></details>
    <details class="secondary-section"><summary>Previous tests{snapshot.investigation?.completedTests.length ? ` (${snapshot.investigation.completedTests.length})` : ""}</summary><CompletedTests snapshot={snapshot} store={store}/></details>
    <details class="secondary-section"><summary>Developer tools</summary><DeveloperTools snapshot={snapshot} store={store}/></details>
  </section>;
}

/** Compact "what we know" summary derived from the claim map. */
function WhatWeKnow({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  if (snapshot.claimGroups.length === 0) return <></>;
  const rows = snapshot.claimGroups.flatMap((group) => group.claims);
  const verified = rows.filter((claim) => claim.status === "verified");
  const rejected = rows.filter((claim) => claim.status === "rejected");
  const open = rows.filter((claim) => claim.status === "unresolved" || claim.status === "unknown" || claim.status === "source-supported");
  const strategy = rows.find((claim) => claim.id === "static.strategy");
  return <article class="panel what-we-know">
    <div class="panel-title"><div><span class="panel-kicker">WHAT WE KNOW</span></div></div>
    <p>
      <strong>{verified.length}</strong> capabilities verified · <strong>{rejected.length}</strong> ruled out · <strong>{open.length}</strong> open questions.
      {snapshot.rasterStrategyLabel
        ? <> Static images are usable via <strong>{snapshot.rasterStrategyLabel}</strong>.</>
        : strategy ? <> No usable static-image strategy yet — that is what the next tests determine.</> : null}
    </p>
    <p class="fineprint">The full claim-by-claim map is under “Technical support map” below.</p>
  </article>;
}

function RecentResult({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const latest = snapshot.investigation?.completedTests.at(-1);
  if (!latest) return <></>;
  return <article class="panel recent-result">
    <div class="panel-title"><div><span class="panel-kicker">LAST TEST</span><h2>{latest.title}</h2></div>
      <StatusBadge tone={latest.status === "passed" ? "good" : latest.status === "failed" ? "bad" : "warn"}>{latest.status}</StatusBadge></div>
    <p>{latest.summary}</p>
    <div class="inline-form">
      <button class="secondary" onClick={() => void store.copyTestReport(latest.testId)}>Copy test report</button>
      {snapshot.investigation?.status === "active" && <button class="quiet" onClick={() => store.stopInvestigation()}>Stop testing for now</button>}
    </div>
  </article>;
}

function SupportMap({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  if (snapshot.claimGroups.length === 0) return <></>;
  return <section>
    <div class="section-heading"><p>What is verified, what failed, and what remains unknown — derived from atomic claims, never from broad guesses.</p></div>
    <div class="diagnose-grid claim-grid">{snapshot.claimGroups.map((group) => <article class="panel">
      <div class="panel-title"><div><span class="panel-kicker">{group.label.toUpperCase()}</span></div></div>
      <div class="support-table">{group.claims.map((claim) => <div class={`support-row claim-${claim.status}`} title={claim.evidence}>
        <span class="claim-glyph" aria-hidden="true">{claim.glyph}</span>
        <strong>{claim.label}</strong>
        <StatusBadge tone={claim.status === "verified" ? "good" : claim.status === "rejected" ? "bad" : claim.status === "unresolved" ? "warn" : "neutral"}>{claim.status === "source-supported" ? "source only" : claim.status}</StatusBadge>
        <span>{claim.scopeLabel ?? ""}</span>
      </div>)}</div>
    </article>)}</div>
    {snapshot.rasterStrategyLabel && <p class="fineprint">Validated static-image strategy this session: {snapshot.rasterStrategyLabel}.</p>}
  </section>;
}

function TroubleshootEntry({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <section>
    {!open ? <button class="secondary" onClick={() => setOpen(true)}>Something's wrong with my display…</button>
      : <><p class="fineprint">Start from what you're seeing. MatrixSmith turns the symptom into an investigation with the right first test.</p>
        <div class="tool-grid symptom-grid">{snapshot.symptoms.map((symptom) => <button class="symptom-card" onClick={() => { setOpen(false); store.startTroubleshoot(symptom.id); }}>{symptom.label}</button>)}</div></>}
  </section>;
}

function TestCatalogue({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  if (snapshot.guidedTests.length === 0) return <p class="fineprint">No guided tests are available for this profile.</p>;
  const order = { core: 0, recommended: 1, advanced: 2, optional: 3 } as Record<string, number>;
  const tests = [...snapshot.guidedTests].sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9));
  return <section>
    <div class="section-heading"><p>Each test is a short About → Run → Observe → Result flow. You never need the protocol workbench to produce complete evidence.</p></div>
    <div class="tool-grid">{tests.map((test) => <article class="tool-card">
      <div><span class={`tool-kind ${test.category}`}>{test.category}</span>{test.lastStatus && <StatusBadge tone={test.lastStatus === "passed" ? "good" : test.lastStatus === "failed" ? "bad" : "warn"}>{test.lastStatus}</StatusBadge>}</div>
      <h3>{test.title}</h3>
      <p>{test.question}</p>
      <p class="fineprint">~{test.estimatedObservationTime}</p>
      <button class="secondary" disabled={!test.available || snapshot.busy !== null} title={test.reason ?? ""} onClick={() => store.startGuidedTest(test.id)}>{test.lastStatus ? "Run again" : "Start test"}</button>
      {!test.available && test.reason && <p class="fineprint">{test.reason}</p>}
    </article>)}</div>
  </section>;
}

function CompletedTests({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const investigation = snapshot.investigation;
  if (!investigation || investigation.completedTests.length === 0) return <p class="fineprint">No tests completed yet.</p>;
  return <section>
    <div class="section-heading"><p>{investigation.goalLabel} · {investigation.status === "stopped" ? "stopped (saved locally)" : "active"}</p>
      {investigation.status === "active" && <button class="quiet" onClick={() => store.stopInvestigation()}>Stop testing for now</button>}
    </div>
    <div class="run-list">{[...investigation.completedTests].reverse().map((test) => <details class={`run ${test.status}`}>
      <summary><span>{test.title}</span><StatusBadge tone={test.status === "passed" ? "good" : test.status === "failed" ? "bad" : "warn"}>{test.status}</StatusBadge><small>{new Date(test.completedAt).toLocaleTimeString([], { hour12: false })}</small></summary>
      <p>{test.summary}</p>
      {test.established.length > 0 && <ol>{test.established.map((item) => <li class="passed"><span>✓ {item}</span></li>)}</ol>}
      {test.rejected.length > 0 && <ol>{test.rejected.map((item) => <li class="failed"><span>✕ {item}</span></li>)}</ol>}
      <div class="inline-form"><button class="secondary" onClick={() => void store.copyTestReport(test.testId)}>Copy test report</button></div>
    </details>)}</div>
  </section>;
}

/** Protocol workbench access, read-only diagnostics, and the legacy validation workflows. */
function DeveloperTools({ snapshot, store }: { snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  return <section>
    <div class="section-heading"><p>Deep packet/GATT tooling and legacy checks. Nothing here is required for the guided workflow.</p></div>
    <div class="inline-form"><button class="secondary" onClick={() => store.setView("develop")}>Open protocol workbench</button></div>
    <div class="tool-grid">
      {snapshot.diagnosticTools.map((tool) => <article class="tool-card"><div><span class={`tool-kind ${tool.kind}`}>{tool.kind}</span><StatusBadge tone={tool.validation === "verified" ? "good" : "warn"}>{tool.validation}</StatusBadge></div><h3>{tool.label}</h3><p>{tool.purpose}</p><button class="secondary" disabled={!tool.available || snapshot.busy !== null} title={tool.unavailableReason} onClick={() => void store.runDiagnostic(tool.id)}>Run</button></article>)}
      {snapshot.validationWorkflows.map((workflow) => <article class="tool-card"><div><span class="tool-kind validate">legacy</span><StatusBadge tone="warn">{workflow.validation} · {workflow.persistence}</StatusBadge></div><h3>{workflow.label}</h3><p class="fineprint">Legacy validation — superseded by the guided tests above; kept for completeness. Its evidence follows the same trust boundaries.</p><p class="warning-copy">{workflow.consequence}</p><button class="secondary" disabled={!workflow.available || snapshot.busy !== null} title={workflow.unavailableReason ?? ""} onClick={() => store.startValidation(workflow.id)}>Start</button></article>)}
    </div>
    {snapshot.diagnosticRuns.length > 0 && <div class="run-list">{[...snapshot.diagnosticRuns].reverse().map((run) => <details class={`run ${run.status}`} open={run.status === "restore-failed"}><summary><span>{run.purpose}</span><StatusBadge tone={run.status === "passed" ? "good" : "bad"}>{run.status}</StatusBadge></summary>{run.status === "restore-failed" && <p class="restore-failure">RESTORE FAILED — check the physical display before continuing.</p>}<ol>{run.steps.map((step) => <li class={step.status}><strong>{step.label}</strong><span>{step.summary}</span></li>)}</ol>{run.error && <p class="notice error">{run.error}</p>}</details>)}</div>}
  </section>;
}
