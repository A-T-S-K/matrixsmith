import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { HomeSnapshot, HomeStore } from "../pages/Home";

function exportDocument(
  document: NonNullable<HomeSnapshot["loadedProfiles"]>[number],
): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(document, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.id}.profile.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
                {document.dimensions.height}. A present company field
                conflicting with 0x
                {document.contradictions.companyId.toString(16).toUpperCase()},
                geometry mismatch or property mismatch withdraws the exact
                match. Missing information remains unknown.
              </p>
              <p>
                Brightness parameters: {document.parameters.brightness.min}–
                {document.parameters.brightness.max}. Template:{" "}
                {document.templates.join(", ")}.
              </p>
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
                  this source-only definition and creates a fresh disconnected
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
          {snapshot.loadedProfiles!.map((profile) => (
            <div key={`${profile.namespace}:${profile.id}`}>
              <p>
                {profile.label} · {profile.namespace}:{profile.id} ·{" "}
                {profile.implementation}
              </p>
              <button onClick={() => exportDocument(profile)}>
                Export {profile.label}
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
