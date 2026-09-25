import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { Dialog } from "../Dialog";

export function ReportDialog({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  if (!snapshot.reportOpen) return <></>;
  const options = snapshot.reportOptions;
  const toggle = (key: keyof typeof options, value: boolean | string): void =>
    store.setReportOptions({ ...options, [key]: value });
  const checks: readonly [keyof typeof options, string][] = [
    ["includeSummary", "Summary"],
    ["includeFingerprint", "Device fingerprint"],
    ["includeGatt", "GATT"],
    ["includeDriverResolution", "Driver resolution"],
    ["includeCapabilities", "Capabilities / support status"],
    ["includeDiagnosticRuns", "Diagnostic runs"],
    ["includeTransactions", "Transactions"],
    ["includeRawPacketHex", "Raw packet hex"],
    ["includeEvidence", "Evidence / unknowns / rejected hypotheses"],
    ["includeObservations", "Observations"],
    ["includeTextContent", "User text content in compiler evidence"],
    ["includeIdentifiers", "Browser/device identifiers"],
    ["includeRawTrace", "Full raw event trace"],
  ];
  const filename = `matrixsmith-report-${new Date().toISOString().slice(0, 10)}`;
  return (
    <Dialog
      labelledBy="report-title"
      onClose={() => store.closeReport()}
      closeOnBackdrop
    >
      <header>
        <div>
          <p class="eyebrow">SAFE TO SHARE BY DEFAULT</p>
          <h1 id="report-title">
            {snapshot.reportKind === "investigation"
              ? "Investigation report"
              : snapshot.reportKind === "forensic"
                ? "Forensic report"
                : "Device report"}
          </h1>
        </div>
        <button
          class="close"
          aria-label="Close report"
          onClick={() => store.closeReport()}
        >
          ×
        </button>
      </header>
      <div class="report-layout">
        <form class="report-options">
          <fieldset class="report-kinds">
            <legend>Report</legend>
            {snapshot.investigationReportAvailable && (
              <label>
                <input
                  type="radio"
                  name="report-kind"
                  checked={snapshot.reportKind === "investigation"}
                  onChange={() => store.setReportKind("investigation")}
                />
                <span>Investigation — what was tested and concluded</span>
              </label>
            )}
            <label>
              <input
                type="radio"
                name="report-kind"
                checked={snapshot.reportKind === "forensic"}
                onChange={() => store.setReportKind("forensic")}
              />
              <span>Forensic — every transaction and packet</span>
            </label>
            <label>
              <input
                type="radio"
                name="report-kind"
                checked={snapshot.reportKind === "device"}
                onChange={() => store.setReportKind("device")}
              />
              <span>Canonical device report</span>
            </label>
          </fieldset>
          <label>
            <strong>Goal / question</strong>
            <textarea
              rows={4}
              placeholder="What should a reviewer help determine?"
              value={options.goal}
              onInput={(event) => toggle("goal", event.currentTarget.value)}
            />
          </label>
          <fieldset
            class={snapshot.reportKind === "device" ? "" : "muted-options"}
          >
            <legend>
              Include
              {snapshot.reportKind !== "device" && (
                <small> — applies to the device report</small>
              )}
            </legend>
            {checks.map(([key, label]) => (
              <label
                key={key}
                class={
                  key === "includeIdentifiers" || key === "includeRawTrace"
                    ? "sensitive"
                    : ""
                }
              >
                <input
                  type="checkbox"
                  checked={Boolean(options[key])}
                  onChange={(event) => toggle(key, event.currentTarget.checked)}
                />
                <span>{label}</span>
                {key === "includeIdentifiers" && (
                  <small>May identify this browser/device</small>
                )}
              </label>
            ))}
          </fieldset>
          {options.includeIdentifiers && (
            <p class="notice warning">
              Identifying information is included by your choice. Review the
              preview before sharing.
            </p>
          )}
        </form>
        <div class="report-preview">
          <div class="preview-title">
            <strong>Markdown preview</strong>
            <span>
              {snapshot.reportMarkdown.length.toLocaleString()} characters
            </span>
          </div>
          <pre tabIndex={0} aria-label="Markdown report preview">
            {snapshot.reportMarkdown}
          </pre>
        </div>
      </div>
      <footer>
        <button
          class="primary"
          onClick={() => void store.copy(snapshot.reportMarkdown)}
        >
          Copy Markdown
        </button>
        <button
          class="secondary"
          onClick={() =>
            store.download(
              `${filename}.md`,
              snapshot.reportMarkdown,
              "text/markdown",
            )
          }
        >
          Download .md
        </button>
        <button
          class="secondary"
          onClick={() =>
            store.download(
              `${filename}-shareable-v3.json`,
              store.exportBundle("shareable"),
              "application/json",
            )
          }
        >
          Download shareable Bundle V3
        </button>
        <button
          class="secondary"
          onClick={() =>
            store.download(
              `${filename}-full-local-archive-v3.json`,
              store.exportBundle("full-local-archive"),
              "application/json",
            )
          }
        >
          Download full local archive (includes identifiers)
        </button>
      </footer>
    </Dialog>
  );
}
