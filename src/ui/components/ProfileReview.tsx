import { FileButton } from "./FileButton";
import { readBoundedText } from "../../application/file-input";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { HomeSnapshot, HomeStore } from "../pages/Home";

export function ProfileReview({
  snapshot,
  store,
}: {
  snapshot: HomeSnapshot;
  store: HomeStore;
}): JSX.Element {
  const review = snapshot.profileReview;
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (review) title.current?.focus();
  }, [review]);
  const document = review?.document;
  return (
    <>
      {review && (
        <section class="authorized" aria-labelledby="profile-review-title">
          <h2 id="profile-review-title" tabIndex={-1} ref={title}>
            Local profile review
          </h2>
          {review.error && (
            <p role="alert">
              {review.error} The current profiles and workspace are unchanged.
            </p>
          )}
          {document && (
            <>
              <h3>{document.label}</h3>
              <p>
                {document.namespace}:{document.id} · revision{" "}
                {document.revision} · document v{document.documentVersion}
              </p>
              <p>Implementation: {document.implementation}</p>
              <p>
                Matches the exact name “{document.matching.name}”, service{" "}
                {document.matching.serviceUuid}, characteristic{" "}
                {document.matching.characteristicUuid}, with READ + NOTIFY +
                WRITE WITHOUT RESPONSE.
              </p>
              <p>
                Dimensions: {document.dimensions.width}×
                {document.dimensions.height}.{" "}
                {document.contradictions.companyId === null
                  ? "Company information is unknown; no company condition applies."
                  : `A present company field conflicting with 0x${document.contradictions.companyId.toString(16).toUpperCase()} withdraws matching.`}{" "}
                Conflicting geometry or required properties withdraw matching.
                Missing information remains unknown.
              </p>
              <p>
                Brightness parameters: {document.parameters.brightness.min}–
                {document.parameters.brightness.max}. Template:{" "}
                {document.templates.join(", ")}.
              </p>
              {document.documentVersion === 2 && (
                <>
                  <p>
                    Candidate only · {document.candidate.history.status}.
                    Recommended route:{" "}
                    {document.candidate.recommendation ?? "unestablished"}.
                    Fixed RGB444 / 16-row / eight-column codec assumptions.
                  </p>
                  <p>
                    Name and shared GATT describe matching conditions; they
                    establish neither family identity nor physical-unit
                    equivalence. Manufacturer, firmware, model and chip remain
                    unknown.
                  </p>
                  <p>
                    Reload requires live family identification and all three
                    still checks: bootstrap, raw channels, then encoder.
                    Historical observations and route preference grant no
                    content permission. Loading lasts for this browser session.
                  </p>
                  <p role="status">
                    {snapshot.profileEvidenceStatus ??
                      "Evidence attachment is missing. The candidate remains inspectable; no historical evidence has been adopted."}
                  </p>
                  <FileButton
                    accept=".json,application/json"
                    disabled={false}
                    onFile={async (file) =>
                      store.inspectProfileEvidence?.(
                        await readBoundedText(file, "bundle"),
                      )
                    }
                  >
                    Inspect candidate evidence attachment
                  </FileButton>
                </>
              )}
              <details>
                <summary>Provenance and limitations</summary>
                <ul>
                  {document.sources.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                  {document.limitations.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </details>
              {review.problems.length ? (
                <div role="alert">
                  <p>Incompatible with the installed definitions:</p>
                  <ul>
                    {review.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>
                  Compatible with the installed implementation. Loading adds
                  this local definition and creates a fresh disconnected
                  workspace. Drafts are preserved; prepared work, current
                  evidence and confirmations do not carry over.
                </p>
              )}
              {snapshot.profileLoadReason && (
                <p role="status">{snapshot.profileLoadReason}</p>
              )}
              <button
                class="primary"
                disabled={Boolean(
                  review.problems.length || snapshot.profileLoadReason,
                )}
                onClick={() => store.loadLocalProfile?.()}
              >
                Load reviewed profile
              </button>
            </>
          )}
        </section>
      )}
      {Boolean(snapshot.loadedProfiles?.length) && (
        <section class="authorized">
          <h2>Loaded local profiles</h2>
          <p>
            Available until this browser session ends. Export and choose the
            file again in a fresh session to reload.
          </p>
          {snapshot.loadedProfiles!.map((profile, index) => (
            <div key={`${profile.namespace}:${profile.id}`}>
              <p>
                {profile.label} · {profile.namespace}:{profile.id} ·{" "}
                {profile.implementation}
              </p>
              <button onClick={() => store.exportLoadedProfile?.(index)}>
                Export {profile.label}
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
