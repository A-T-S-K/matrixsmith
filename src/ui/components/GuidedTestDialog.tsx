import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, GuidedFlowState, MatrixStore } from "../store";
import { FramePreview } from "./FramePreview";
import { StatusBadge } from "./StatusBadge";
import { formatDuration } from "../../investigation/observations";
import type { ObservationFieldSpec, ObservationValue } from "../../investigation/observations";

/**
 * One guided hardware test as a linear ABOUT → RUN → OBSERVE → RESULT
 * mini-flow. Everything renders generically from the driver's test
 * definition; no per-test JSX cases exist here.
 */
export function GuidedTestDialog({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  const flow = snapshot.guidedFlow;
  if (!flow) return <></>;
  return <div class="dialog-backdrop"><section class="report-dialog validation-dialog guided-dialog" role="dialog" aria-modal="true" aria-labelledby="guided-title" onClick={(event) => event.stopPropagation()}>
    <header>
      <div>
        <p class="eyebrow">GUIDED TEST · {flow.category.toUpperCase()} · {stageLabel(flow.stage)}</p>
        <h1 id="guided-title">{flow.title}</h1>
        <ol class="stage-steps" aria-label="Test progress">{(["about", "running", "observe", "result"] as const).map((stage, index) => <li class={flow.stage === stage ? "active" : stageIndex(flow.stage) > index ? "done" : ""}>{stageLabel(stage)}</li>)}</ol>
      </div>
      {flow.stage !== "running" && <button
        class="close"
        aria-label={flow.stage === "observe" ? "Stop observation and save as incomplete" : "Close test"}
        title={flow.stage === "observe" ? "The content was already transmitted; closing records this test as incomplete evidence." : ""}
        onClick={() => store.closeGuidedTest()}
      >×</button>}
    </header>
    <div class="validation-body">
      {flow.stage === "about" && <AboutStage flow={flow} snapshot={snapshot} store={store}/>}
      {flow.stage === "running" && <RunningStage flow={flow}/>}
      {flow.stage === "observe" && <ObserveStage flow={flow} store={store}/>}
      {flow.stage === "result" && <ResultStage flow={flow} snapshot={snapshot} store={store}/>}
    </div>
  </section></div>;
}

function stillLabel(phase: import("../../investigation/tests").TimelinePhase, phaseElapsedMs: number | null): string {
  if (phase.minStillSeconds !== undefined && phaseElapsedMs !== null && phaseElapsedMs >= phase.minStillSeconds * 1000) {
    return `Still completely static at ${phase.minStillSeconds} seconds`;
  }
  return phase.stillLabel ?? "Stop watching";
}

function stageLabel(stage: GuidedFlowState["stage"]): string {
  return stage === "about" ? "About" : stage === "running" ? "Run" : stage === "observe" ? "Observe" : "Result";
}
function stageIndex(stage: GuidedFlowState["stage"]): number { return ["about", "running", "observe", "result"].indexOf(stage); }

function AboutStage({ flow, snapshot, store }: { flow: GuidedFlowState; snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const [confirmChecked, setConfirmChecked] = useState(false);
  return <>
    <p class="guided-question"><strong>{flow.about.question}</strong></p>
    <p>{flow.about.whyRelevant}</p>
    <dl class="state-grid about-grid">
      <div><dt>What MatrixSmith will do</dt><dd>{flow.about.whatMatrixSmithDoes}</dd></div>
      <div><dt>What changes on the display</dt><dd>{flow.about.whatChangesOnDevice}</dd></div>
      <div><dt>Observation time</dt><dd>{flow.about.estimatedObservationTime}</dd></div>
      <div><dt>Safety</dt><dd>{flow.risk}</dd></div>
    </dl>
    {flow.previews.length > 0 && <div class="validation-previews">{flow.previews.map((frame) => <div><strong>{flow.regions.length > 0 ? "Pattern positions (unknown values shown gray)" : "Diagnostic image"}</strong><FramePreview frame={frame}/></div>)}</div>}
    <details><summary>Possible outcomes and what each teaches</summary><ul class="observation-list">{flow.about.possibleOutcomes.map((outcome) => <li><span><strong>{outcome.outcome}:</strong> {outcome.learns}</span></li>)}</ul></details>
    <details><summary>Technical details</summary><ul class="observation-list">{flow.about.technicalDetails.map((detail) => <li><span>{detail}</span></li>)}{flow.planSummary && <li><span>Transmission: {flow.planSummary.packetCount} packets (1 announce + {flow.planSummary.chunkCount} chunks), {flow.planSummary.programBytes} bytes uncompressed, CRC32 {flow.planSummary.crc32}, {flow.planSummary.pacingMs} ms pacing.</span></li>}</ul></details>
    {flow.about.preTransferNote && <p class="notice warning">{flow.about.preTransferNote}</p>}
    <p class="notice warning">{flow.consequence}</p>
    <label class="confirm-check"><input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked((event.currentTarget as HTMLInputElement).checked)}/><span>I understand this replaces the stored display content and that automatic restoration is not verified.</span></label>
    <div class="inline-form">
      <button class="primary" disabled={!confirmChecked || snapshot.busy !== null} onClick={() => void store.confirmGuidedTransfer()}>Run test</button>
      <button class="secondary" onClick={() => store.closeGuidedTest()}>Cancel</button>
    </div>
  </>;
}

function RunningStage({ flow }: { flow: GuidedFlowState }): JSX.Element {
  return <>
    <p class="guided-progress"><span class="spinner" aria-hidden="true"/>{flow.transferProgress ?? "Preparing diagnostic…"}</p>
    <p class="fineprint">Content is being transferred to the display. This window stays open until the transfer completes — closing it would not cancel the Bluetooth upload.</p>
    <p class="fineprint">Larger programs can take several seconds to start rendering after the final packet.</p>
  </>;
}

function ObserveStage({ flow, store }: { flow: GuidedFlowState; store: MatrixStore }): JSX.Element {
  return <>
    <p>{flow.about.observeInstructions}</p>
    {flow.timerSpec && <div class="panel timer-panel">
      <p class="panel-kicker">STOPWATCH · started at the final accepted packet (T0)</p>
      <strong class="big-value">{flow.timerElapsedMs !== null ? formatDuration(flow.timerElapsedMs) : "--:--"}</strong>
      {!flow.timerStopped && flow.currentPhase && <>
        <p>{flow.currentPhase.prompt}</p>
        <div class="inline-form">
          <button class="primary" onClick={() => store.recordGuidedTimeline("event")}>{flow.currentPhase.eventLabel}</button>
          {flow.currentPhase.failLabel && <button class="secondary" onClick={() => store.recordGuidedTimeline("fail")}>{flow.currentPhase.failLabel}</button>}
          {flow.currentPhase.stillLabel && <button class="secondary" onClick={() => store.recordGuidedTimeline("still")}>
            {stillLabel(flow.currentPhase, flow.phaseElapsedMs)}
          </button>}
        </div>
        {flow.currentPhase.minStillSeconds !== undefined && flow.phaseElapsedMs !== null && flow.phaseElapsedMs < flow.currentPhase.minStillSeconds * 1000
          && <p class="fineprint">Stopping before {flow.currentPhase.minStillSeconds} seconds records the exact measured time; stability then stays unverified.</p>}
      </>}
      {flow.timerStopped && <p class="fineprint">Timeline recorded (measured by MatrixSmith, from the final accepted write).</p>}
    </div>}
    {flow.regions.length > 0 && <details open><summary>Pattern position diagram</summary>
      {flow.previews.map((frame) => <FramePreview frame={frame} label="Pattern positions"/>)}
      <ul class="observation-list">{flow.regions.map((region) => <li><span><code>{region.rawWordHex}</code> — {region.label} (columns {region.x + 1}–{region.x + region.width}, rows {region.y + 1}–{region.y + region.height}){region.expected ? ` · expected under the current RGB hypothesis: ${region.expected}` : " · no expectation — record exactly what you see"}</span></li>)}</ul>
    </details>}
    <ol class="validation-questions">{flow.observationSpecs.map((spec) => <ObservationField spec={spec} value={flow.values[spec.id]} store={store}/>)}</ol>
    <div class="inline-form">
      <button class="primary" disabled={!flow.observationsReady} onClick={() => store.submitGuidedObservations()}>Record observations</button>
      <button class="secondary" onClick={() => store.abandonGuidedTest()}>Stop observation and save as incomplete</button>
    </div>
    <p class="fineprint">The diagnostic content was already sent to the display; stopping records this test as incomplete evidence rather than discarding it.</p>
  </>;
}

function ObservationField({ spec, value, store }: { spec: ObservationFieldSpec; value: ObservationValue | undefined; store: MatrixStore }): JSX.Element {
  if (spec.kind === "boolean") {
    const current = value?.kind === "boolean" ? value.value : null;
    return <li><p>{spec.prompt}</p><div class="answer-buttons">{(["yes", "no", "unsure"] as const).map((option) => <button class={current === option ? `active ${option}` : ""} onClick={() => store.setGuidedObservation({ kind: "boolean", fieldId: spec.id, value: option })}>{option === "yes" ? "Yes" : option === "no" ? "No" : "Unsure"}</button>)}</div></li>;
  }
  if (spec.kind === "choice") {
    const current = value?.kind === "choice" ? value.optionId : null;
    const otherText = value?.kind === "choice" ? value.otherText ?? "" : "";
    return <li><p>{spec.prompt}</p><div class="answer-buttons choice-buttons">
      {spec.options.map((option) => <button class={current === option.id ? "active" : ""} onClick={() => store.setGuidedObservation({ kind: "choice", fieldId: spec.id, optionId: option.id })}>{option.label}</button>)}
      {spec.allowOther && <button class={current === "other" ? "active" : ""} onClick={() => store.setGuidedObservation({ kind: "choice", fieldId: spec.id, optionId: "other" })}>Other…</button>}
    </div>
    {current === "other" && <input placeholder="Describe what you see" value={otherText} onInput={(event) => store.setGuidedObservation({ kind: "choice", fieldId: spec.id, optionId: "other", otherText: (event.currentTarget as HTMLInputElement).value })}/>}
    </li>;
  }
  if (spec.kind === "duration") {
    return <li><p>{spec.prompt}</p><p class="fineprint">{value?.kind === "duration" ? `${formatDuration(value.milliseconds)} (${value.measuredBy === "matrixsmith-timer" ? "measured by MatrixSmith" : "estimate"})` : "Use the stopwatch above — MatrixSmith measures this so you never have to estimate later."}</p></li>;
  }
  if (spec.kind === "number") {
    const current = value?.kind === "number" ? String(value.value) : "";
    return <li><p>{spec.prompt}</p><input type="number" value={current} onInput={(event) => { const parsed = Number((event.currentTarget as HTMLInputElement).value); if (Number.isFinite(parsed)) store.setGuidedObservation({ kind: "number", fieldId: spec.id, value: parsed }); }}/>{spec.unit && <small> {spec.unit}</small>}</li>;
  }
  const text = value?.kind === "note" ? value.text : "";
  return <li><p>{spec.prompt} <small>(optional)</small></p><textarea rows={2} value={text} onInput={(event) => store.setGuidedObservation({ kind: "note", fieldId: spec.id, text: (event.currentTarget as HTMLTextAreaElement).value })}/></li>;
}

function ResultStage({ flow, snapshot, store }: { flow: GuidedFlowState; snapshot: AppSnapshot; store: MatrixStore }): JSX.Element {
  const result = flow.result;
  if (!result) return <></>;
  const tone = result.status === "passed" ? "good" : result.status === "failed" ? "bad" : "warn";
  return <>
    <div class="panel-title"><StatusBadge tone={tone}>{result.status.toUpperCase()}{result.status === "partial" ? " RESULT" : ""}</StatusBadge></div>
    <p class="guided-question"><strong>{result.summary}</strong></p>
    {result.established.length > 0 && <><h3>What this establishes</h3><ul class="observation-list">{result.established.map((item) => <li class="passed"><span>✓ {item}</span></li>)}</ul></>}
    {result.rejected.length > 0 && <><h3>What this rejects</h3><ul class="observation-list">{result.rejected.map((item) => <li class="failed"><span>✕ {item}</span></li>)}</ul></>}
    {result.unknowns.length > 0 && <><h3>What remains unknown</h3><ul class="observation-list">{result.unknowns.map((item) => <li><span>? {item}</span></li>)}</ul></>}
    {snapshot.rasterStrategyLabel && <p class="fineprint">Active static-image strategy this session: {snapshot.rasterStrategyLabel}.</p>}
    {flow.nextTest && <article class="recommended"><span class="recommended-icon">→</span><div><p class="panel-kicker">RECOMMENDED NEXT TEST</p><h2>{flow.nextTest.title}</h2><p>{flow.nextTest.why}</p><p class="fineprint">~{flow.nextTest.estimatedObservationTime}</p></div></article>}
    <div class="inline-form result-actions">
      {flow.nextTest && <button class="primary" onClick={() => store.continueToNextTest()}>Continue to next test</button>}
      <button class={flow.nextTest ? "secondary" : "primary"} onClick={() => void store.copyTestReport(flow.testId)}>Copy test report</button>
      <button class="quiet" onClick={() => { store.closeGuidedTest(); store.stopInvestigation(); }}>Stop testing for now</button>
    </div>
    <p class="fineprint">Stopping saves this investigation locally so you can resume later; the investigation report stays one tap away.</p>
  </>;
}
