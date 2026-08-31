import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, MatrixStore } from "../store";
import { FramePreview } from "./FramePreview";
import { StatusBadge } from "./StatusBadge";

/**
 * Guided hardware-validation dialog: exact consequence + preview first, an
 * explicit "Run test" confirmation, then structured questions about what the
 * physical panel actually shows.
 */
export function ValidationDialog({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  const flow = snapshot.validationFlow;
  const [confirmChecked, setConfirmChecked] = useState(false);
  if (!flow) return <></>;
  const answered = flow.questions.every((question) => flow.answers[question.id]);
  return <div class="dialog-backdrop"><section class="report-dialog validation-dialog" role="dialog" aria-modal="true" aria-labelledby="validation-title" onClick={(event) => event.stopPropagation()}>
    <header><div><p class="eyebrow">GUIDED HARDWARE VALIDATION · EXPERIMENTAL · PERSISTENT</p><h1 id="validation-title">{flow.label}</h1></div><button class="close" aria-label="Close validation" onClick={() => store.closeValidation()}>×</button></header>
    <div class="validation-body">
      {flow.stage === "confirm" && <>
        <p class="notice warning">{flow.consequence}</p>
        <div class="validation-previews">{flow.preview.map((frame, index) => <div><strong>{flow.preview.length > 1 ? `Frame ${index + 1}` : "Diagnostic image"}</strong><FramePreview frame={frame}/></div>)}</div>
        {flow.planSummary && <dl class="state-grid">
          <div><dt>Packets</dt><dd>{flow.planSummary.packetCount} (1 announce + {flow.planSummary.chunkCount} chunks)</dd></div>
          <div><dt>Program</dt><dd>{flow.planSummary.programBytes} bytes uncompressed</dd></div>
          <div><dt>CRC32</dt><dd>{flow.planSummary.crc32}</dd></div>
          <div><dt>Pacing</dt><dd>{flow.planSummary.pacingMs} ms between packets</dd></div>
        </dl>}
        <label class="confirm-check"><input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked((event.currentTarget as HTMLInputElement).checked)}/><span>I understand this replaces the stored display content and that automatic restoration is not verified.</span></label>
        <div class="inline-form">
          <button class="primary" disabled={!confirmChecked || snapshot.busy !== null} onClick={() => void store.confirmValidationTransfer()}>Run test</button>
          <button class="secondary" onClick={() => store.closeValidation()}>Cancel</button>
        </div>
      </>}
      {flow.stage === "questions" && <>
        <p>The diagnostic content was transferred ({flow.transactionIds.length} transaction recorded). Look at the physical panel and answer each question. Your answers become structured session evidence.</p>
        <div class="validation-previews">{flow.preview.map((frame, index) => <div><strong>{flow.preview.length > 1 ? `Expected frame ${index + 1}` : "Expected image"}</strong><FramePreview frame={frame}/></div>)}</div>
        <ol class="validation-questions">{flow.questions.map((question) => { const answer = flow.answers[question.id]; return <li>
          <p>{question.prompt}</p>
          <div class="answer-buttons">
            {(["yes", "no", "unsure"] as const).map((value) => <button class={answer?.answer === value ? `active ${value}` : ""} onClick={() => store.setValidationAnswer(question.id, value)}>{value === "yes" ? "Yes" : value === "no" ? "No" : "Unsure"}</button>)}
          </div>
        </li>; })}</ol>
        <div class="inline-form">
          <button class="primary" disabled={!answered} onClick={() => store.submitValidationAnswers()}>Record observations</button>
          <button class="secondary" onClick={() => store.closeValidation()}>Discard</button>
        </div>
      </>}
      {flow.stage === "done" && flow.result && <>
        <StatusBadge tone={flow.result.status === "passed" ? "good" : flow.result.status === "failed" ? "bad" : "warn"}>{flow.result.status.toUpperCase()}</StatusBadge>
        <ul class="observation-list">{flow.result.findings.map((finding) => <li><span>{finding}</span></li>)}</ul>
        <p>{flow.result.status === "passed"
          ? "This capability passed on the physical session. The result is session evidence; project/profile metadata is only changed through an explicit review of the report."
          : "The result is recorded as session evidence. Use Share report to copy the exact packets and observations before retrying."}</p>
        <div class="inline-form">
          <button class="primary" onClick={() => { store.closeValidation(); store.openReport(); }}>Copy report</button>
          <button class="secondary" onClick={() => store.closeValidation()}>Close</button>
        </div>
      </>}
    </div>
  </section></div>;
}

/** Confirmation dialog for ordinary persistent content sends. */
export function PendingSendDialog({ snapshot, store }: { readonly snapshot: AppSnapshot; readonly store: MatrixStore }): JSX.Element {
  const pending = snapshot.pendingSend;
  const [confirmChecked, setConfirmChecked] = useState(false);
  if (!pending) return <></>;
  return <div class="dialog-backdrop"><section class="report-dialog validation-dialog" role="dialog" aria-modal="true" aria-labelledby="send-title" onClick={(event) => event.stopPropagation()}>
    <header><div><p class="eyebrow">PERSISTENT STORED-PROGRAM WRITE</p><h1 id="send-title">{pending.label}</h1></div><button class="close" aria-label="Cancel send" onClick={() => store.cancelPendingSend()}>×</button></header>
    <div class="validation-body">
      <p class="notice warning">{pending.consequence}</p>
      {pending.preview && <FramePreview frame={pending.preview}/>}
      <dl class="state-grid">
        <div><dt>Packets</dt><dd>{pending.packetCount} (1 announce + {pending.chunkCount} chunks)</dd></div>
        <div><dt>Program</dt><dd>{pending.programBytes} bytes uncompressed</dd></div>
      </dl>
      <label class="confirm-check"><input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked((event.currentTarget as HTMLInputElement).checked)}/><span>I understand this permanently replaces the stored display content.</span></label>
      <div class="inline-form">
        <button class="primary" disabled={!confirmChecked || snapshot.busy !== null} onClick={() => void store.confirmPendingSend()}>Send to display</button>
        <button class="secondary" onClick={() => store.cancelPendingSend()}>Cancel</button>
      </div>
    </div>
  </section></div>;
}
