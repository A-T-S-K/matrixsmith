import { useEffect, useRef, useState } from "preact/hooks";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";

export function CandidateReview({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}) {
  const review = snapshot.candidateReview;
  const heading = useRef<HTMLHeadingElement>(null);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  useEffect(() => {
    if (review) {
      setLabel(review.document.label);
      setName(review.document.matching.name);
      setId(review.document.id);
      heading.current?.focus();
    }
  }, [review?.document]);
  const applicable =
    snapshot.liveConnected &&
    snapshot.coreProgress?.title === "Verify one still-image route" &&
    snapshot.device?.protocol === "CoolLEDUX";
  if (!applicable && !review) return null;
  const document = review?.document;
  const unreviewedEdits = Boolean(
    document &&
    (label !== document.label ||
      name !== document.matching.name ||
      id !== document.id),
  );
  return (
    <section
      class="authorized candidate-review"
      aria-labelledby="candidate-review-title"
    >
      <h2 id="candidate-review-title" tabIndex={-1} ref={heading}>
        Candidate profile
      </h2>
      <button onClick={() => void store.createCandidateProfile()}>
        Create candidate profile
      </button>
      {document && (
        <>
          <p>
            {document.namespace}:{document.id} · revision {document.revision} ·{" "}
            {document.implementation}
          </p>
          <p>
            {document.dimensions.width}×{document.dimensions.height} ·{" "}
            {document.candidate.history.status === "locally-verified"
              ? "Locally verified on one target"
              : "Incomplete candidate; no completed still verification"}{" "}
            · recommended route:{" "}
            {document.candidate.recommendation ?? "unestablished"}.
          </p>
          <p>
            Fixed RGB444, 16-row stride, eight-column tiles. Raw channels and
            actual encoder verification are separate checks.
          </p>
          <p>
            Manufacturer, firmware, model and chip: unknown. Company condition:{" "}
            {document.contradictions.companyId === null
              ? "unknown"
              : `0x${document.contradictions.companyId.toString(16)}`}
            .
          </p>
          <p>
            Observed Bluetooth matching name: “{review!.observedMatchingName}”.
            This may be personalized or identifying. Review the public label and
            exact matching name before sharing. Shared FFF0/FFF1 and name
            establish neither family nor physical-unit identity.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void store.reviseCandidateProfile(label, name, id);
            }}
          >
            <label>
              Public label
              <input
                value={label}
                onInput={(event) => setLabel(event.currentTarget.value)}
                maxLength={512}
              />
            </label>
            <label>
              Bluetooth matching name
              <input
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
                maxLength={512}
              />
            </label>
            <label>
              Local profile ID
              <input
                value={id}
                onInput={(event) => setId(event.currentTarget.value)}
                maxLength={64}
              />
            </label>
            <button type="submit" disabled={review!.stale}>
              Apply reviewed labels and matching
            </button>
          </form>
          <p>
            Session-only loading. Reload disconnected, identify family live,
            compare matching and geometry, then repeat bootstrap → raw channels
            → encoder. Fresh evidence, experimental permission and exact
            persistent-send confirmation are required for text/images.
          </p>
          <p>
            Separate shareable V3 evidence is available, with specimen
            identifiers projected out and historical test relationships
            preserved. Full local archives remain a separate report option. This
            profile retains its reviewed matching name.
          </p>
          <details>
            <summary>Limitations and sources</summary>
            <ul>
              {[...document.limitations, ...document.sources].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
          {review!.stale && (
            <p role="alert">
              Display target, geometry, definition or evidence changed. Create
              and review a new candidate before exporting.
            </p>
          )}
          {review!.error && (
            <p role="alert">
              {review!.error} The prior valid candidate is preserved.
            </p>
          )}
          <div class="inline-form">
            <button
              disabled={review!.stale || unreviewedEdits}
              onClick={() => void store.exportCandidateProfile()}
            >
              Download candidate profile
            </button>
            <button
              disabled={review!.stale || unreviewedEdits}
              onClick={() => void store.exportCandidateProfile(true)}
            >
              Copy candidate profile
            </button>
            <button
              disabled={review!.stale || unreviewedEdits}
              onClick={() => void store.exportCandidateProfile(false, true)}
            >
              Download shareable candidate evidence
            </button>
          </div>
          <p>
            Export failures preserve this review. Retry Copy or Download after
            resolving the error.
          </p>
        </>
      )}
    </section>
  );
}
