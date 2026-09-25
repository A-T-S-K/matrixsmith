import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
export function PreviousInvestigation({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const stored = snapshot.storedInvestigation;
  if (!stored || snapshot.investigation?.completedTests.length) return <></>;
  const savedAt = new Date(stored.savedAt);
  return (
    <section class="previous-investigation">
      <div class="previous-line">
        <div>
          <strong>Previous investigation</strong>
          <small>
            {stored.testCount} test{stored.testCount === 1 ? "" : "s"} · saved{" "}
            {savedAt.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </small>
        </div>
        <button
          class="secondary small"
          onClick={() => store.resumeStoredInvestigation()}
        >
          Resume
        </button>
      </div>
      <details class="technical-disclosure">
        <summary>Details</summary>
        <p class="fineprint">
          {stored.deviceName ?? "Stored display"} · saved{" "}
          {savedAt.toLocaleString()}.
        </p>
        <p class="fineprint">
          {stored.sameAuthorizedDevice
            ? "This is the same display you authorized before, so its guided work continues where it left off."
            : stored.matchesProfile
              ? "This looks like the same kind of display. MatrixSmith cannot prove it is the same physical unit, so earlier results are rechecked when they matter."
              : "Device match not confirmed — this may be a different display. Earlier results are kept for reference and rechecked before they are relied on."}
        </p>
        {!stored.sameAuthorizedDevice && stored.experimentCount > 0 && (
          <p class="fineprint">
            Its {stored.experimentCount} recorded experiment
            {stored.experimentCount === 1 ? "" : "s"} stay
            {stored.experimentCount === 1 ? "s" : ""} with that session. Testing
            here starts a fresh record, because one display's results must not
            be attributed to another.
          </p>
        )}
        <button
          class="text-action quiet-action"
          onClick={() => store.forgetLocalHistory()}
        >
          Forget this history
        </button>
      </details>
    </section>
  );
}

export function TroubleshootEntry({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        class="text-action troubleshoot-link"
        onClick={() => setOpen(true)}
      >
        Troubleshoot another problem
      </button>
    );
  }
  return (
    <section class="troubleshoot-open">
      <p class="fineprint">
        What are you seeing? MatrixSmith turns the symptom into an investigation
        with the right first test.
      </p>
      <div class="symptom-grid">
        {snapshot.symptoms.map((symptom) => (
          <button
            key={symptom.id}
            class="symptom-card"
            onClick={() => {
              setOpen(false);
              store.startTroubleshoot(symptom.id);
            }}
          >
            {symptom.label}
          </button>
        ))}
      </div>
      <button class="text-action quiet-action" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </section>
  );
}

export function ReportActions({
  store,
}: {
  store: PresentationStore;
}): JSX.Element {
  return (
    <section>
      <p class="fineprint">
        Reports describe everything established so far, with the exact evidence
        behind each claim.
      </p>
      <div class="utility-row">
        <button
          class="secondary"
          onClick={() => void store.copyInvestigationReport()}
        >
          Copy investigation report
        </button>
        <button class="text-action" onClick={() => store.openReport()}>
          Other formats…
        </button>
      </div>
    </section>
  );
}
