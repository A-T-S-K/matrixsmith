import { readBoundedText } from "../../../application/file-input";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { StatusBadge } from "../../components/StatusBadge";
import { describeUploadAnalysis } from "../../../diagnostics/upload-analysis";
import { FileButton } from "../../components/FileButton";
import type { ProtocolTransaction } from "../../../diagnostics/transactions";
export function RawSection({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  return (
    <section>
      <div class="section-heading">
        <h2>Raw events</h2>
        <p>
          Advanced ground-truth trace. Decoding failures never remove raw
          notifications.
        </p>
      </div>
      <details class="raw-layer">
        <summary>
          Show full raw event trace ({snapshot.rawEvents.length} events)
        </summary>
        <ol>
          {[...snapshot.rawEvents].reverse().map((event) => {
            const hex = event.rawBytes
              ? [...event.rawBytes]
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join(" ")
                  .toUpperCase()
              : "";
            return (
              <li key={`${event.timestamp}-${event.type}`}>
                <time>{event.timestamp}</time>
                <strong>{event.type}</strong>
                <span>{JSON.stringify(event.metadata)}</span>
                {hex && (
                  <>
                    <code>{hex}</code>
                    <Copy value={hex} store={store} />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
export function EvidenceSection({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const [note, setNote] = useState("");
  return (
    <section>
      <div class="section-heading">
        <h2>Evidence / observations</h2>
        <p>
          Attach a lightweight note to this capture session. Electronically
          verifiable state is recorded automatically.
        </p>
      </div>
      <article class="panel">
        <div class="inline-form">
          <input
            value={note}
            placeholder="What did you observe?"
            onInput={(event) =>
              setNote((event.currentTarget as HTMLInputElement).value)
            }
          />
          <button
            class="primary"
            disabled={!note.trim()}
            onClick={() => {
              store.recordObservation(note);
              setNote("");
            }}
          >
            Add session note
          </button>
        </div>
        <ul class="observation-list">
          {snapshot.observations.map((o) => (
            <li key={o.id}>
              <time>{o.recordedAt}</time>
              <span>{o.summary}</span>
              <StatusBadge>{o.confidence}</StatusBadge>
            </li>
          ))}
        </ul>
      </article>
      <ImportPanel snapshot={snapshot} store={store} />
    </section>
  );
}
export function ImportPanel({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const [pasted, setPasted] = useState("");
  const summary = snapshot.lastImport;
  return (
    <article class="panel import-panel">
      <div class="panel-title">
        <div>
          <span class="panel-kicker">EXTERNAL EVIDENCE</span>
          <h2>Import external capture</h2>
        </div>
        <StatusBadge tone="good">Read-only</StatusBadge>
      </div>
      <p>
        Paste or open an nRF Connect text log. Packets are decoded with the
        installed drivers, correlated into transactions, and shown alongside
        live evidence. Imported captures never transmit.
      </p>
      <textarea
        rows={5}
        placeholder="Paste an nRF Connect log export here…"
        value={pasted}
        onInput={(event) =>
          setPasted((event.currentTarget as HTMLTextAreaElement).value)
        }
      />
      <div class="inline-form">
        <button
          class="primary"
          disabled={!pasted.trim() || snapshot.busy !== null}
          onClick={() => {
            store.importExternalCapture(pasted);
            setPasted("");
          }}
        >
          Import pasted log
        </button>
        <FileButton
          accept=".txt,.log,text/plain"
          onFile={async (file) =>
            store.importExternalCapture(await readBoundedText(file, "capture"))
          }
        >
          Open .txt/.log file →
        </FileButton>
      </div>
      {summary && (
        <div class="import-summary">
          <h3>Last import</h3>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{summary.provenance}</dd>
            </div>
            <div>
              <dt>Parsed device</dt>
              <dd>{summary.deviceName ?? "unknown"}</dd>
            </div>
            <div>
              <dt>BLE address</dt>
              <dd>
                {summary.bleAddress
                  ? `${summary.bleAddress} (kept out of shareable reports)`
                  : "not present"}
              </dd>
            </div>
            <div>
              <dt>GATT</dt>
              <dd>
                {summary.serviceCount} service(s), {summary.characteristicCount}{" "}
                characteristic(s)
              </dd>
            </div>
            <div>
              <dt>Transactions</dt>
              <dd>
                {summary.transactionCount} parsed, {summary.decodedCount}{" "}
                decoded by drivers
              </dd>
            </div>
            <div>
              <dt>Unparsed lines</dt>
              <dd>{summary.unparsedLineCount}</dd>
            </div>
          </dl>
          {summary.warnings.length > 0 && (
            <ul class="observation-list">
              {summary.warnings.map((warning) => (
                <li key={warning}>
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
          <div class="inline-form">
            <button class="secondary" onClick={() => store.openReport()}>
              Open report (Copy/Download Markdown &amp; JSON)
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
/** Layered receipt/timing summary for stored-program uploads: semantics first, raw bytes stay underneath. */
export function UploadAnalysis({
  transaction,
  chunkCount,
  store,
}: {
  transaction: ProtocolTransaction;
  chunkCount: number;
  store: PresentationStore;
}): JSX.Element {
  const analysis = store.controller.analyzeStoredUpload(
    transaction,
    chunkCount,
  );
  if (!analysis)
    return (
      <div class="decoded">
        <p>
          Receipt decoding is unavailable for this transaction; raw bytes remain
          preserved.
        </p>
      </div>
    );
  return (
    <div class="decoded">
      <div>
        <strong>Receipts &amp; measured timing</strong>
      </div>
      <ul class="observation-list">
        {describeUploadAnalysis(analysis).map((line) => (
          <li key={line}>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Copy({
  value,
  store,
}: {
  value: string;
  store: PresentationStore;
}): JSX.Element {
  return (
    <button
      class="copy"
      title="Copy"
      aria-label="Copy to clipboard"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void store.copy(value);
      }}
    >
      Copy
    </button>
  );
}

/**
 * Guided orchestration state, for diagnosing workflow bugs.
 *
 * Developer tooling only: the guided path never shows run ids or execution
 * fingerprints. From the outside a retry and a loop look identical — the same
 * picture reappears — so this shows the identities that actually distinguish
 * them.
 */
